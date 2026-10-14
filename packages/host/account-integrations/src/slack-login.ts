/**
 * Slack's authorization-code + PKCE login for one workspace.
 *
 * A Slack app that enables PKCE is a public client: the exchange sends `code_verifier` and no
 * client secret, and a refresh carries only the client id. The listener binds the configured
 * port because Slack matches the registered redirect exactly, so a busy port fails with that
 * fact instead of drifting to a port the application did not register.
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { SLACK_AUTH_TEST_URL, SLACK_AUTHORIZE_URL, SLACK_CALLBACK_PATH, SLACK_REVOKE_URL, SLACK_TOKEN_URL, type SlackWorkspace } from './slack.ts'

/** Why a Slack login did not complete. */
export type SlackLoginFailure = 'port' | 'state' | 'denied' | 'approval' | 'exchange' | 'response' | 'unauthorized' | 'timeout' | 'cancelled'

/** A Slack login refusal; `reason` is a fixed code, and `message` is Slack's own error code or this module's sentence. */
export class SlackLoginError extends Error {
  /**
   * @param reason - the fixed failure code.
   * @param message - Slack's error code, or a sentence naming what this Host observed.
   */
  constructor(readonly reason: SlackLoginFailure, message: string) {
    super(message)
    this.name = 'SlackLoginError'
  }
}

/** One Slack user token and the refresh credential issued with it. */
export interface SlackToken {
  accessToken: string
  /** Present when Slack issued a rotating token; a PKCE app's refresh tokens expire after 30 days without use. */
  refreshToken?: string
  /** Epoch milliseconds; absent for a token Slack does not expire. */
  expiresAt?: number
  /** User scopes Slack granted. */
  scopes: readonly string[]
}

/** Endpoints one login talks to; production uses Slack's, and a test points them at a fixture server. */
export interface SlackEndpoints {
  authorize: string
  token: string
  authTest: string
  revoke: string
}

/** Settings of one workspace login. */
export interface SlackLoginOptions {
  /** The deployment's Slack app client id, which is public. */
  clientId: string
  /** Callback port the application registered; 0 binds an ephemeral port, which only a test may do. */
  port: number
  /** User scopes to request, all of which the application must also declare. */
  scopes: readonly string[]
  /** Budget of the whole login, of the exchange, and of the workspace read. */
  timeoutMs: number
  /** Endpoint overrides; absent uses Slack's own. Only a test passes these. */
  endpoints?: Partial<SlackEndpoints>
}

/** One login in flight. */
export interface SlackLogin {
  /** Consent URL the reader opens. */
  url: string
  /** Redirect URI Slack was given, which its callback must arrive at. */
  redirectUri: string
  /** Settles with the token and the workspace it belongs to, or rejects with a {@link SlackLoginError}. */
  completion: Promise<{ token: SlackToken; workspace: SlackWorkspace }>
  /** Stop the login: the listener closes and the completion rejects as cancelled. */
  cancel: () => void
}

/** Slack error codes that mean an administrator has not approved the app for the workspace. */
const APPROVAL_ERRORS = new Set(['app_not_admin_approved', 'no_approved_scopes_requested', 'no_approved_scopes'])

/** Slack error codes that mean the consent itself is no longer usable. */
const CONSENT_ERRORS = new Set(['invalid_code', 'bad_redirect_uri', 'invalid_client_id', 'invalid_refresh_token', 'oauth_authorization_url_mismatch'])

/** Page the reader's browser shows once Slack redirects back. The text is this Host's own. */
function resultPage(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Aeven</title><p>${message}</p>`
}

/** A URL-safe random value, the alphabet PKCE verifiers and state values use. */
function randomValue(bytes = 24): string {
  return randomBytes(bytes).toString('base64url')
}

/** PKCE verifier and its S256 challenge, the only hash Slack accepts. */
function pkce(): { verifier: string; challenge: string } {
  const verifier = randomValue(32)
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

/**
 * The endpoints one login and its follow-up calls use: Slack's own, with whatever a test overrides.
 * @param overrides - partial endpoints; absent values fall back to Slack's.
 * @returns the complete set of endpoints.
 */
function resolveEndpoints(overrides: Partial<SlackEndpoints> | undefined): SlackEndpoints {
  return {
    authorize: overrides?.authorize ?? SLACK_AUTHORIZE_URL,
    token: overrides?.token ?? SLACK_TOKEN_URL,
    authTest: overrides?.authTest ?? SLACK_AUTH_TEST_URL,
    revoke: overrides?.revoke ?? SLACK_REVOKE_URL,
  }
}

/** The failure an aborted request carries, which the code that aborted it chose. */
function abortReason(signal: AbortSignal): Error {
  /* v8 ignore next -- every abort in this module carries a reason; a bare abort is not reachable. */
  return signal.reason instanceof Error ? signal.reason : new SlackLoginError('cancelled', 'sign-in was cancelled')
}

/** One JSON answer from Slack, accepted only when Slack itself reported success. */
async function slackJson(response: Response, failure: SlackLoginFailure): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json().catch(() => undefined)
  if (typeof parsed !== 'object' || parsed === null) throw new SlackLoginError('response', `Slack answered with no JSON (${response.status})`)
  const body = parsed as { ok?: unknown; error?: unknown }
  if (body.ok !== true) {
    const code = typeof body.error === 'string' ? body.error : `http-${response.status}`
    throw new SlackLoginError(APPROVAL_ERRORS.has(code) ? 'approval' : failure, code)
  }
  return body
}

/** POST one form to Slack. */
async function postForm(
  url: string,
  form: Record<string, string>,
  options: { timeoutMs: number; bearer?: string; signal?: AbortSignal },
): Promise<Response> {
  const signals = [AbortSignal.timeout(options.timeoutMs), ...options.signal === undefined ? [] : [options.signal]]
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...options.bearer === undefined ? {} : { Authorization: `Bearer ${options.bearer}` },
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.any(signals),
      redirect: 'error',
    })
  } catch {
    // A cancelled or timed-out request reaches neither a provider answer nor an error code.
    if (options.signal?.aborted === true) throw abortReason(options.signal)
    throw new SlackLoginError('timeout', `Slack could not be reached within ${options.timeoutMs} ms`)
  }
}

/** Read the token, its refresh credential, and the scopes Slack granted out of one successful exchange. */
function tokenFrom(body: Record<string, unknown>): SlackToken {
  const accessToken = typeof body.access_token === 'string' ? body.access_token : undefined
  if (accessToken === undefined || accessToken === '') throw new SlackLoginError('response', 'Slack returned no access token')
  const user = typeof body.authed_user === 'object' && body.authed_user !== null ? body.authed_user as Record<string, unknown> : {}
  const granted = typeof user.scope === 'string' && user.scope !== '' ? user.scope : typeof body.scope === 'string' ? body.scope : ''
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : undefined
  return {
    accessToken,
    ...typeof body.refresh_token === 'string' && body.refresh_token !== '' ? { refreshToken: body.refresh_token } : {},
    ...expiresIn === undefined ? {} : { expiresAt: Date.now() + expiresIn * 1000 },
    scopes: granted.split(',').map(scope => scope.trim()).filter(scope => scope !== ''),
  }
}

/**
 * Name the workspace and account a freshly issued token belongs to.
 * @param accessToken - the user token Slack just issued.
 * @param options - endpoint, budget, and cancellation.
 * @returns the team and account Slack reports.
 * @throws {SlackLoginError} `unauthorized` when Slack refuses the token itself.
 */
async function readWorkspace(
  accessToken: string,
  options: { url: string; timeoutMs: number; signal: AbortSignal },
): Promise<SlackWorkspace> {
  const response = await postForm(options.url, {}, { timeoutMs: options.timeoutMs, bearer: accessToken, signal: options.signal })
  const body = await slackJson(response, 'unauthorized')
  const teamId = typeof body.team_id === 'string' ? body.team_id : undefined
  const userId = typeof body.user_id === 'string' ? body.user_id : undefined
  if (teamId === undefined || userId === undefined) throw new SlackLoginError('response', 'Slack reported no workspace or account')
  const domain = workspaceDomain(typeof body.url === 'string' ? body.url : undefined)
  return {
    teamId, userId,
    teamName: typeof body.team === 'string' && body.team !== '' ? body.team : teamId,
    userName: typeof body.user === 'string' && body.user !== '' ? body.user : userId,
    ...domain === undefined ? {} : { domain },
  }
}

/** The workspace domain inside the workspace URL Slack reports, when it reports a usable one. */
function workspaceDomain(url: string | undefined): string | undefined {
  if (url === undefined) return undefined
  try {
    const domain = new URL(url).hostname.replace(/\.slack\.com$/, '')
    return domain === '' ? undefined : domain
  } catch {
    // A workspace URL Slack did not format as one carries no domain worth showing.
    return undefined
  }
}

/** A bound loopback listener that settles with the authorization code Slack redirected. */
interface Loopback {
  port: number
  /** Settles with the code, or rejects when Slack reported a refusal. */
  code: Promise<string>
  close: () => Promise<void>
}

/**
 * The failure one listen error reports, naming the configured port when something already holds it.
 * @param port - the configured callback port.
 * @param error - the error the listener reported.
 * @returns the refusal a login rejects with.
 */
function listenFailure(port: number, error: NodeJS.ErrnoException): SlackLoginError {
  // A configured port on the loopback interface is either free or already held; the other listen
  // failure needs a privileged port or an absent interface, neither of which this Host configures.
  /* v8 ignore next 2 */
  if (error.code === 'EADDRINUSE') return new SlackLoginError('port', `the Slack callback port ${port} is already in use`)
  /* v8 ignore next -- the same unreachable listen failure, whose code an errno-style error always carries. */
  return new SlackLoginError('port', `the Slack callback listener could not start: ${error.code ?? error.message}`)
}

/**
 * Bind the loopback redirect and wait for Slack's callback.
 * @param port - configured port, or 0 for an ephemeral one.
 * @param state - the state value the callback must carry back.
 * @param signal - cancellation of the whole login.
 * @returns the bound listener and the pending code.
 * @throws {SlackLoginError} `port` when the port is unavailable.
 */
async function listenForSlackCallback(port: number, state: string, signal: AbortSignal): Promise<Loopback> {
  const server = createServer()
  let settle!: (code: string) => void
  let fail!: (error: Error) => void
  const code = new Promise<string>((resolve, reject) => {
    settle = resolve
    fail = reject
  })
  const answer = (response: ServerResponse, status: number, message: string): void => {
    response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }).end(resultPage(message))
  }
  server.on('request', (request, response) => {
    /* v8 ignore next -- an HTTP/1.1 request always carries a target */
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== SLACK_CALLBACK_PATH) {
      answer(response, 404, 'This is not the address Aeven is waiting for.')
      return
    }
    if (url.searchParams.get('state') !== state) {
      answer(response, 400, 'This sign-in did not come from the window Aeven opened. Close it and start again.')
      fail(new SlackLoginError('state', 'the Slack callback carried a mismatched state'))
      return
    }
    const error = url.searchParams.get('error')
    if (error !== null) {
      answer(response, 200, 'Sign-in was not completed. You can close this window.')
      fail(new SlackLoginError(error === 'access_denied' ? 'denied' : 'exchange', error))
      return
    }
    const returned = url.searchParams.get('code')
    if (returned === null || returned === '') {
      answer(response, 400, 'Slack returned no authorization code. Close this window and start again.')
      fail(new SlackLoginError('response', 'the Slack callback carried no code'))
      return
    }
    answer(response, 200, 'Slack is connected. You can close this window and return to Aeven.')
    settle(returned)
  })
  const abort = (): void => {
    fail(abortReason(signal))
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        reject(listenFailure(port, error))
      })
      server.listen(port, '127.0.0.1', resolve)
    })
  } catch (error) {
    signal.removeEventListener('abort', abort)
    server.close()
    throw error
  }
  /* v8 ignore next -- a listening server always reports an object address */
  const bound = (server.address() as AddressInfo).port
  return {
    port: bound,
    code,
    close: async () => {
      signal.removeEventListener('abort', abort)
      // A browser that keeps its connection open would otherwise hold the close until it times out.
      await new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() })
    },
  }
}

/**
 * Start one workspace login: bind the redirect, build the consent URL, and settle when Slack
 * calls back with a code this Host exchanges for a user token.
 *
 * The consent URL is returned before the reader consents, so the caller opens it and awaits
 * {@link SlackLogin.completion}.
 * @param options - client id, callback port, scopes, budget, and endpoint overrides.
 * @returns the consent URL and the pending completion.
 * @throws {SlackLoginError} `port` when the configured callback port cannot be bound.
 */
export async function startSlackLogin(options: SlackLoginOptions): Promise<SlackLogin> {
  const endpoints = resolveEndpoints(options.endpoints)
  const { verifier, challenge } = pkce()
  const state = randomValue(16)
  const controller = new AbortController()
  const listener = await listenForSlackCallback(options.port, state, controller.signal)
  const redirectUri = `http://127.0.0.1:${listener.port}${SLACK_CALLBACK_PATH}`
  const url = new URL(endpoints.authorize)
  // `oauth/v2_user/authorize` issues a user token, so it reads the requested scopes from
  // `scope`. Sending them in `user_scope`, as the bot-token `oauth/v2/authorize` expects,
  // makes Slack refuse the consent with "Invalid permissions requested / No scopes requested".
  url.search = new URLSearchParams({
    client_id: options.clientId, scope: options.scopes.join(','), redirect_uri: redirectUri,
    state, code_challenge: challenge, code_challenge_method: 'S256',
  }).toString()
  const timer = setTimeout(() => {
    controller.abort(new SlackLoginError('timeout', 'the Slack sign-in was not completed in time'))
  }, options.timeoutMs)
  const completion = (async () => {
    try {
      const code = await listener.code
      const response = await postForm(endpoints.token, {
        client_id: options.clientId, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code',
      }, { timeoutMs: options.timeoutMs, signal: controller.signal })
      const token = tokenFrom(await slackJson(response, 'exchange'))
      const workspace = await readWorkspace(token.accessToken, {
        url: endpoints.authTest, timeoutMs: options.timeoutMs, signal: controller.signal,
      })
      return { token, workspace }
    } finally {
      clearTimeout(timer)
      await listener.close()
    }
  })()
  return {
    url: url.toString(),
    redirectUri,
    completion,
    cancel: () => {
      controller.abort(new SlackLoginError('cancelled', 'sign-in was cancelled'))
    },
  }
}

/**
 * Exchange a refresh token for a current user token. Slack's PKCE refresh carries the client id
 * and no secret.
 * @param options - client id, the stored refresh token, budget, and endpoint overrides.
 * @returns the refreshed token, whose scopes Slack repeats.
 * @throws {SlackLoginError} `exchange` when Slack refuses the refresh token.
 */
export async function refreshSlackToken(
  options: { clientId: string; refreshToken: string; timeoutMs: number; endpoints?: Partial<SlackEndpoints> },
): Promise<SlackToken> {
  const response = await postForm(resolveEndpoints(options.endpoints).token, {
    client_id: options.clientId, refresh_token: options.refreshToken, grant_type: 'refresh_token',
  }, { timeoutMs: options.timeoutMs })
  return tokenFrom(await slackJson(response, 'exchange'))
}

/**
 * Revoke one user token at Slack, so disconnecting a workspace also ends its access there.
 * @param options - the stored access token, budget, and endpoint overrides.
 * @returns nothing; a token Slack has already revoked counts as revoked.
 * @throws {SlackLoginError} `exchange` when Slack refused for another reason.
 */
export async function revokeSlackToken(
  options: { accessToken: string; timeoutMs: number; endpoints?: Partial<SlackEndpoints> },
): Promise<void> {
  const response = await postForm(resolveEndpoints(options.endpoints).revoke, { token: options.accessToken }, {
    timeoutMs: options.timeoutMs, bearer: options.accessToken,
  })
  const body = await response.json().catch(() => undefined) as { ok?: unknown; error?: unknown } | undefined
  if (body?.ok === true || body?.error === 'token_revoked' || body?.error === 'invalid_auth') return
  throw new SlackLoginError('exchange', typeof body?.error === 'string' ? body.error : `http-${response.status}`)
}

/**
 * Whether Slack still accepts a stored user token.
 * @param options - the stored access token, budget, and endpoint overrides.
 * @returns false when Slack no longer accepts the token; true when it names the workspace back.
 * @throws {SlackLoginError} when Slack could not be asked, which is not a verdict about the token.
 */
export async function probeSlackToken(
  options: { accessToken: string; timeoutMs: number; endpoints?: Partial<SlackEndpoints> },
): Promise<boolean> {
  try {
    const response = await postForm(resolveEndpoints(options.endpoints).authTest, {}, {
      timeoutMs: options.timeoutMs, bearer: options.accessToken,
    })
    await slackJson(response, 'unauthorized')
    return true
  } catch (error) {
    if (error instanceof SlackLoginError && error.reason === 'unauthorized') return false
    throw error
  }
}

/**
 * Whether a login failure means the stored consent is gone rather than that this attempt failed,
 * which is what turns a workspace row into one the reader has to connect again.
 * @param error - a failure a login or a refresh rejected with.
 * @returns true when the token or the consent Slack knew is no longer usable.
 */
export function isSlackConsentFailure(error: unknown): boolean {
  if (!(error instanceof SlackLoginError)) return false
  return error.reason === 'unauthorized' || (error.reason === 'exchange' && CONSENT_ERRORS.has(error.message))
}
