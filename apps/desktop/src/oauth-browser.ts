/**
 * Provider sign-in in the reader's default browser.
 *
 * Providers refuse sign-in inside an embedded window (Google answers "This
 * browser or app may not be secure"), so the shell opens the provider route on
 * the Aeven site in the system browser and does not see the browser again. It
 * draws a verifier, puts only its SHA-256 on the start URL
 * (`?app=desktop&nonce=<hash>`), and collects the finished sign-in from the
 * site's `/oauth/desktop/claim` with the verifier. The browser ends on the
 * site's signed-in page; reading the start URL or the browser history yields
 * the hash, which collects nothing.
 */

import { createHash, randomBytes } from 'node:crypto'

/** How long a sign-in is collected before the shell gives up; the site keeps a result as long. */
const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000

/** Pause between two collection attempts while the reader is still at the provider. */
const CLAIM_INTERVAL_MS = 1000

/** Stops the one sign-in in flight; a newer one replaces it. */
let cancelActive: (() => void) | undefined

/**
 * The provider route as the desktop shell opens it.
 * @param providerUrl - the provider route the Host reported.
 * @param nonce - the SHA-256 of the verifier, base64url.
 * @returns the URL to open in the default browser.
 */
export function providerStartUrl(providerUrl: string, nonce: string): string {
  const url = new URL(providerUrl)
  url.searchParams.set('app', 'desktop')
  url.searchParams.set('nonce', nonce)
  return url.href
}

/**
 * The `/oauth-result/...` path one collection answer finishes the sign-in with.
 * @param status - the claim response status.
 * @param body - the parsed claim response body.
 * @returns the landing path, or undefined while the sign-in is unfinished.
 * @throws when the site refuses the claim.
 */
export function claimedLanding(status: number, body: unknown): string | undefined {
  if (status === 202) return undefined
  if (status !== 200 || typeof body !== 'object' || body === null) {
    throw new Error(`avn desktop: the sign-in could not be collected (HTTP ${String(status)})`)
  }
  const { session, challenge } = body as { session?: unknown; challenge?: unknown }
  if (typeof session === 'string' && typeof challenge === 'string') {
    return `/oauth-result/${encodeURIComponent(session)}/${encodeURIComponent(challenge)}`
  }
  return '/oauth-result/error'
}

/**
 * Make one collection attempt.
 *
 * A network failure or a server error is an attempt that found nothing, so a
 * dropped connection or a gateway restart while the reader is at the provider
 * does not end the sign-in; only the site's refusal does.
 * @param fetcher - sends the request.
 * @param claimUrl - the site's collection route.
 * @param verifier - the secret whose hash started the sign-in.
 * @param signal - aborts the attempt when the sign-in is cancelled.
 * @returns the landing path, or undefined while nothing was collected.
 */
async function collect(fetcher: typeof fetch, claimUrl: string, verifier: string, signal: AbortSignal): Promise<string | undefined> {
  let response: Response
  try {
    response = await fetcher(claimUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ verifier }),
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw error
    return undefined
  }
  if (response.status >= 500) return undefined
  return claimedLanding(response.status, response.status === 200 ? await response.json() : undefined)
}

/**
 * Run one provider sign-in in the default browser.
 * @param options.providerUrl - the provider route the Host reported.
 * @param options.openExternal - opens a URL in the reader's default browser.
 * @param options.land - receives the `/oauth-result/...` path the finished sign-in collected.
 * @param options.fetcher - sends the collection request.
 * @returns resolves once the sign-in landed, failed, timed out, or was replaced by a newer one.
 */
export async function startBrowserSignIn(options: {
  readonly providerUrl: string
  readonly openExternal: (url: string) => Promise<void>
  readonly land: (path: string) => void
  readonly fetcher?: typeof fetch
}): Promise<void> {
  cancelActive?.()
  const controller = new AbortController()
  const cancel = (): void => { controller.abort() }
  cancelActive = cancel
  const timer = setTimeout(cancel, SIGN_IN_TIMEOUT_MS)
  const fetcher = options.fetcher ?? fetch
  const verifier = randomBytes(32).toString('base64url')
  const nonce = createHash('sha256').update(verifier).digest('base64url')
  const claimUrl = new URL('/oauth/desktop/claim', options.providerUrl).href
  try {
    await options.openExternal(providerStartUrl(options.providerUrl, nonce))
    while (!controller.signal.aborted) {
      const landing = await collect(fetcher, claimUrl, verifier, controller.signal)
      if (landing !== undefined) {
        options.land(landing)
        return
      }
      await new Promise<void>((resolve) => {
        const pause = setTimeout(resolve, CLAIM_INTERVAL_MS)
        controller.signal.addEventListener('abort', () => { clearTimeout(pause); resolve() }, { once: true })
      })
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error
  } finally {
    clearTimeout(timer)
    if (cancelActive === cancel) cancelActive = undefined
  }
}
