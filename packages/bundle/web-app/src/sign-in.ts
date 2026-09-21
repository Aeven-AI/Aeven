/**
 * Headless sign-in: a one-time browser round trip that leaves a durable
 * credential behind.
 *
 * An `avn` process with no browser attached has no Aeven session to relay, so
 * its agent turns have nothing to present to `/v1`. Rather than a stored API
 * key, which is a different kind of credential from the one a signed-in reader
 * has, this performs the sign-in the reader would perform anyway and keeps what
 * the exchange returns.
 *
 * The shape is the loopback redirect a code editor's extension host uses,
 * because the deployment already supports that shape: `OAuthRedirectTarget`
 * accepts a return to any loopback origin on any port, and the provider
 * callback redirects to `<that origin>/oauth-result/<sessionId>/<challenge>`.
 * So this listens on a loopback port, opens the provider URL, and holds the
 * redirect until it arrives.
 *
 * What it keeps is the **refresh token**, not the access token. The access
 * token lives two hours and is replaced on every rotation, which is what made a
 * copied one go stale; the refresh token is what the deployment issues for a
 * long-lived client and what `/v1` accepts as a bearer. Keeping it is therefore
 * what makes this sign-in one-time rather than a credential to re-acquire.
 * @module @aeven/web-app/sign-in
 */

import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/** The path a provider callback is returned to, matching the deployment's default. */
export const OAUTH_RESULT_PATH = '/oauth-result'

/** Provider route names this deployment exposes, as `config.oauth` names them. */
export type SignInProvider = 'google' | 'apple' | 'x'

/** How long to hold the listener open for the reader to finish signing in. */
export const DEFAULT_SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000

/** The pair a successful sign-in must exchange; both arrive in the redirect. */
export interface SignInCallback {
  /** The session the provider sign-in created. */
  readonly sessionId: string
  /** Single-use challenge proving this callback is the one that asked. */
  readonly challenge: string
}

/** What the deployment answers `/check-oauth-token` with. */
export interface SignInGrant {
  readonly userId: string
  readonly accessToken: string
  readonly refreshToken: string
}

/** Everything the flow needs from the deployment. */
export interface SignInOptions {
  /** Origin of the Aeven API, such as `http://localhost:9000`. */
  readonly apiUrl: string
  /** Provider to sign in with. */
  readonly provider: SignInProvider
  /** Opens the reader's browser; injected so tests need no browser. */
  readonly openBrowser: (url: string) => Promise<unknown>
  /** Port to listen on; `0` (the default) lets the OS choose a free one. */
  readonly port?: number
  /** Milliseconds to wait for the callback before giving up. */
  readonly timeoutMs?: number
}

/** The credential reference an inference client presents; mirrors `llm-aeven`'s default. */
export const INFERENCE_CREDENTIAL_REF = 'AEVEN_TOKEN'

/**
 * The loopback origin the provider callback must return to.
 *
 * Loopback rather than the machine's hostname because the deployment's allow
 * rule is exactly that: any loopback origin, on any port. Naming anything else
 * would need the operator to widen `OAUTH_CLIENT_ORIGINS` for a flow that only
 * ever runs on this machine.
 * @param port - the listener's bound port.
 * @returns the origin to send as the requesting app.
 */
export function loopbackOrigin(port: number): string {
  return `http://127.0.0.1:${String(port)}`
}

/**
 * Read the session and challenge out of a provider redirect.
 *
 * The callback appends them as path segments, so `/oauth-result/error` is a
 * refused sign-in rather than a pair, and is reported as such instead of being
 * mistaken for one.
 * @param path - the request path, with or without a query string.
 * @param resultPath - the configured result path prefix.
 * @returns the pair, or undefined when this is not a successful callback.
 */
export function callbackFrom(path: string, resultPath: string = OAUTH_RESULT_PATH): SignInCallback | undefined {
  const [withoutQuery = ''] = path.split('?')
  const segments = withoutQuery.split('/').filter(segment => segment.length > 0)
  const prefix = resultPath.split('/').filter(segment => segment.length > 0)
  if (segments.length !== prefix.length + 2) return undefined
  if (!prefix.every((segment, index) => segments[index] === segment)) return undefined
  const sessionId = segments[prefix.length]
  const challenge = segments[prefix.length + 1]
  if (sessionId === undefined || challenge === undefined) return undefined
  if (sessionId === 'error' || sessionId.length === 0 || challenge.length === 0) return undefined
  return { sessionId, challenge }
}

/**
 * Trade the callback pair for the session's tokens.
 *
 * The route is public: the challenge is single-use and expires, and it is the
 * challenge — not the caller — that proves this is the sign-in that asked.
 * @param options - the API origin and the pair to exchange.
 * @returns the granted tokens.
 * @throws when the deployment refuses the pair.
 */
export async function exchangeCallbackPair(options: {
  readonly apiUrl: string
  readonly callback: SignInCallback
}): Promise<SignInGrant> {
  const response = await fetch(`${options.apiUrl.replace(/\/+$/, '')}/check-oauth-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: options.callback.sessionId, challenge: options.callback.challenge }),
  })
  if (!response.ok) {
    throw new Error(`avn: the sign-in could not be exchanged (HTTP ${String(response.status)})`)
  }
  const grant = await response.json() as Partial<SignInGrant>
  if (typeof grant.refreshToken !== 'string' || grant.refreshToken.length === 0
    || typeof grant.userId !== 'string' || grant.userId.length === 0) {
    throw new Error('avn: the sign-in answered without a refresh token')
  }
  return {
    userId: grant.userId,
    accessToken: typeof grant.accessToken === 'string' ? grant.accessToken : '',
    refreshToken: grant.refreshToken,
  }
}

/**
 * The page the reader's browser loads to start the sign-in.
 *
 * The listener cannot simply open the provider URL. The deployment decides where
 * to return the callback from the **`Referer`** of the request that starts the
 * flow (`requestOrigin` in the API's `OAuthRedirectTarget`), so a top-level
 * navigation away from nothing names no origin and the callback falls back to
 * the deployment's configured client. Loading this page first makes the referer
 * this listener's own origin, which is also a loopback origin the deployment
 * already accepts.
 * @param providerUrl - the deployment's provider route.
 * @returns an HTML document that negotiates the browser to the provider.
 */
export function signInPage(providerUrl: string): string {
  const target = JSON.stringify(providerUrl)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Signing in</title>
<meta http-equiv="refresh" content="0; url=${providerUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">
</head>
<body>
<p>Continuing to sign in…</p>
<script>location.replace(${target})</script>
</body>
</html>
`
}

/**
 * Serve one provider callback on a loopback port.
 *
 * The origin is available before the callback arrives, because the sign-in page
 * has to be loaded while the listener is already up. `close()` is idempotent and
 * the listener closes itself on the first callback, so a failed sign-in leaves
 * no port held.
 * @param options - provider URL to negotiate to, port, result path, and wait budget.
 * @returns the bound origin and the callback it will carry.
 */
export function startCallbackListener(options: {
  readonly providerUrl: string
  readonly resultPath?: string
  readonly port?: number
  readonly timeoutMs?: number
}): {
  readonly origin: Promise<string>
  readonly callback: Promise<SignInCallback>
  readonly close: () => void
} {
  const resultPath = options.resultPath ?? OAUTH_RESULT_PATH
  const timeoutMs = options.timeoutMs ?? DEFAULT_SIGN_IN_TIMEOUT_MS
  const page = signInPage(options.providerUrl)

  let settleCallback: (value: SignInCallback) => void
  let failCallback: (error: Error) => void
  let settleOrigin: (value: string) => void

  const callback = new Promise<SignInCallback>((resolve, reject) => {
    settleCallback = resolve
    failCallback = reject
  })
  const origin = new Promise<string>((resolve) => { settleOrigin = resolve })

  let done = false
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const path = request.url ?? '/'
    const parsed = callbackFrom(path, resultPath)
    if (parsed !== undefined) {
      // Answered before the listener closes, so the reader's browser sees the
      // confirmation page rather than a dropped connection.
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Signed in. You can close this window.')
      close()
      settleCallback(parsed)
      return
    }
    if (path.split('?')[0] === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(page)
      return
    }
    response.writeHead(404).end()
  })

  const close = (): void => {
    if (done) return
    done = true
    clearTimeout(timer)
    server.close()
  }

  const timer = setTimeout(() => {
    close()
    failCallback(new Error('avn: the sign-in was not completed in time'))
  }, timeoutMs)

  server.on('error', (error: Error) => {
    close()
    failCallback(error)
  })
  server.listen(options.port ?? 0, '127.0.0.1', () => {
    const address = server.address() as AddressInfo | null
    if (address === null) {
      close()
      failCallback(new Error('avn: the sign-in listener did not bind a port'))
      return
    }
    settleOrigin(loopbackOrigin(address.port))
  })

  return { origin, callback, close }
}

/**
 * Perform the whole sign-in and return the credential to store.
 *
 * The listener is up before the browser opens, and the page it serves becomes
 * the referer the deployment reads to decide where to return the callback. The
 * origin is therefore this listener's, without the operator widening any allow
 * list: loopback origins are accepted on any port.
 * @param options - the API origin, provider, and browser opener.
 * @returns the credential to store and the account it belongs to.
 */
export async function signIn(options: SignInOptions): Promise<{
  readonly userId: string
  readonly credentialRef: string
  readonly refreshToken: string
}> {
  const apiUrl = options.apiUrl.replace(/\/+$/, '')
  const listener = startCallbackListener({
    providerUrl: `${apiUrl}/oauth/${options.provider}`,
    ...options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs },
    ...options.port === undefined ? {} : { port: options.port },
  })
  try {
    await options.openBrowser(await listener.origin)
    const answered = await listener.callback
    const grant = await exchangeCallbackPair({ apiUrl, callback: answered })
    return { userId: grant.userId, credentialRef: INFERENCE_CREDENTIAL_REF, refreshToken: grant.refreshToken }
  } finally {
    listener.close()
  }
}
