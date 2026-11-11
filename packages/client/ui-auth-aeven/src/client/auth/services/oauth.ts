/**
 * Provider sign-in through a window of its own.
 *
 * A deployment that states the `window` flow reaches a provider without moving
 * the page the reader asked for: the provider's consent screen and its landing
 * live in a window opened here, and this document stays where it is. What the
 * two share is the session, so this waits for one to appear rather than passing
 * a result between documents — the landing window exchanges the provider's
 * answer itself, exactly as a redirected document does, and closes.
 * @module
 */

import { getProfile } from './api.ts'

/** How long this document waits between reads of the session. */
const SESSION_POLL_MS = 1000

/**
 * How long this document may hold focus during a provider sign-in before the
 * reader counts as back without finishing. Longer than the desktop shell needs
 * to collect and exchange a finished sign-in, which it starts the moment the
 * reader switches back.
 */
const RETURN_FOCUS_MS = 750

/**
 * How long this document may keep focus after the press before the provider's
 * page counts as never opened; a browser that starts cold takes a while to come up.
 */
const OPEN_FOCUS_MS = 5000

/** How often the focus is sampled while a provider sign-in is out. */
const FOCUS_SAMPLE_MS = 250

/**
 * Window event an embedding shell dispatches once it has established the
 * session a provider sign-in produced outside this page, as the desktop shell
 * does after its default-browser sign-in; the wait reads the session at once.
 */
export const PROVIDER_SIGNED_IN_EVENT = 'aeven:provider-signed-in'

/**
 * Window event an embedding shell dispatches when a provider sign-in it ran
 * ended without a session: it timed out or failed.
 */
export const PROVIDER_SIGN_IN_ENDED_EVENT = 'aeven:provider-sign-in-ended'

/** Window features for a provider's consent form. */
const PROVIDER_WINDOW_FEATURES = 'popup=yes,width=520,height=760'

/**
 * Open the provider in a window of its own.
 *
 * The window is named, so a reader who presses a second provider button
 * replaces the first window instead of stacking another behind it.
 * @param url - the provider's sign-in URL as the deployment states it.
 */
export function openProviderSignIn(url: string): void {
  window.open(url, 'aeven-provider-signin', PROVIDER_WINDOW_FEATURES)
}

/**
 * Whether this document is the landing window of a provider sign-in.
 *
 * A window this application opened has an opener; a tab the reader navigated
 * themselves does not. The landing reports itself by closing, so the
 * distinction only decides who closes whom.
 * @returns true when another document opened this one.
 */
export function isProviderLanding(): boolean {
  return window.opener !== null
}

/**
 * Wait for the reader to finish a provider sign-in in another window.
 *
 * The session is the signal: the landing exchanges the provider's answer into
 * this origin's session, which is the session every other sign-in path leaves
 * behind, so this document reads it the same way. A reader who closes the
 * window without finishing leaves the wait armed, which is the same unfinished
 * state the boot gate models: the sign-in screen stays, and the button is
 * theirs to press again.
 *
 * A shell that reports {@link PROVIDER_SIGNED_IN_EVENT} has established the
 * session already, so the wait ends on the report without reading it; the boot
 * gate reads the session next and returns to this screen if there is none.
 * @param signal - abandons the wait, as when a newer sign-in replaces it.
 * @returns true once this document has a session or a shell reported one, false when abandoned.
 */
export async function awaitProviderSession(signal: AbortSignal): Promise<boolean> {
  let reported = false
  const onReported = (): void => { reported = true }
  window.addEventListener(PROVIDER_SIGNED_IN_EVENT, onReported)
  try {
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- the abort and sign-in listeners can run during either await.
    while (!signal.aborted && !reported && !await hasSession()) {
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- the sign-in listener can run while hasSession is pending.
      if (reported) return !signal.aborted
      await new Promise<void>((resolve) => {
        const wake = (): void => {
          clearTimeout(timer)
          window.removeEventListener(PROVIDER_SIGNED_IN_EVENT, wake)
          signal.removeEventListener('abort', wake)
          resolve()
        }
        const timer = setTimeout(wake, SESSION_POLL_MS)
        window.addEventListener(PROVIDER_SIGNED_IN_EVENT, wake)
        signal.addEventListener('abort', wake)
      })
    }
    return !signal.aborted
  } finally {
    window.removeEventListener(PROVIDER_SIGNED_IN_EVENT, onReported)
  }
}

/**
 * Report a reader who came back to this document without finishing a provider
 * sign-in: closed the provider's page, clicked away from it, or never saw it
 * open. This document holding focus for {@link RETURN_FOCUS_MS} on end after
 * losing it, or for {@link OPEN_FOCUS_MS} without ever losing it, is the sign; a
 * finished sign-in in the desktop shell ends the wait before then.
 * @param onReturned - called once when the reader counts as back.
 * @param signal - stops watching.
 */
export function watchProviderReturn(onReturned: () => void, signal: AbortSignal): void {
  let focusedSince: number | undefined = Date.now()
  let left = false
  const timer = setInterval(() => {
    if (!document.hasFocus()) {
      focusedSince = undefined
      left = true
      return
    }
    focusedSince ??= Date.now()
    if (Date.now() - focusedSince < (left ? RETURN_FOCUS_MS : OPEN_FOCUS_MS)) return
    clearInterval(timer)
    onReturned()
  }, FOCUS_SAMPLE_MS)
  signal.addEventListener('abort', () => { clearInterval(timer) }, { once: true })
}

/** How long a waiting page asks for a handed-off sign-in; the server keeps one for ten minutes. */
const HANDOFF_WAIT_MS = 10 * 60 * 1000

/**
 * How long one claim request may take. A phone freezes a background page's
 * requests, so a request in flight when the reader left can hang past their return.
 */
const CLAIM_TIMEOUT_MS = 5000

/** The server route a waiting page collects a handed-off sign-in from. */
const HANDOFF_CLAIM_PATH = '/oauth/desktop/claim'

/** A redirect-flow provider start that can also finish in another browser. */
export interface ProviderHandoff {
  /** The provider's sign-in URL, carrying `app=web` and the verifier's hash. */
  readonly url: string
  /** Where the page collects the result. */
  readonly claimUrl: string
  /** The secret whose hash the start URL carries; it collects the result. */
  readonly verifier: string
}

/** A sign-in another browser finished for this page. */
export type HandedOffSignIn =
  | { readonly session: string; readonly challenge: string }
  | { readonly error: true }

/**
 * Prepare a provider start for a page that stays open while an installed app
 * takes the provider page over.
 *
 * On a phone the X app opens for x.com and finishes in whatever browser it
 * prefers, which holds none of this page's session. The start carries the
 * SHA-256 of a verifier drawn here; the server stores a sign-in finished in
 * another browser under it, and {@link awaitHandedOffSignIn} collects it. A
 * sign-in that finishes in this browser redirects as usual and never reaches
 * the store.
 * @param url - the provider's sign-in URL as the deployment states it.
 * @returns the start URL, the claim URL on the same server, and the verifier.
 */
export async function prepareProviderHandoff(url: string): Promise<ProviderHandoff> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const nonce = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  const start = new URL(url)
  start.searchParams.set('app', 'web')
  start.searchParams.set('nonce', nonce)
  return { url: start.href, claimUrl: new URL(HANDOFF_CLAIM_PATH, start).href, verifier }
}

/**
 * Wait for a sign-in another browser finished for this page.
 *
 * The page asks once a second, and at once when it becomes visible or takes
 * focus again, so a reader returning from the provider's app meets the result
 * before {@link watchProviderReturn} counts them as back without finishing.
 * @param handoff - the start {@link prepareProviderHandoff} returned.
 * @param signal - abandons the wait.
 * @returns the stored result, or undefined when abandoned or after the server's ten minutes.
 */
export async function awaitHandedOffSignIn(handoff: ProviderHandoff, signal: AbortSignal): Promise<HandedOffSignIn | undefined> {
  const deadline = Date.now() + HANDOFF_WAIT_MS
  while (!signal.aborted && Date.now() < deadline) {
    const result = await claimHandoff(handoff)
    if (result !== undefined) return result
    await new Promise<void>((resolve) => {
      const wake = (): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', wake)
        document.removeEventListener('visibilitychange', onVisible)
        window.removeEventListener('focus', wake)
        resolve()
      }
      const onVisible = (): void => {
        if (document.visibilityState === 'visible') wake()
      }
      const timer = setTimeout(wake, SESSION_POLL_MS)
      signal.addEventListener('abort', wake)
      document.addEventListener('visibilitychange', onVisible)
      window.addEventListener('focus', wake)
    })
  }
  return undefined
}

/**
 * Ask the server once for a handed-off sign-in.
 * @param handoff - the start whose verifier collects the result.
 * @returns the result once stored, undefined while pending or unreachable.
 */
async function claimHandoff(handoff: ProviderHandoff): Promise<HandedOffSignIn | undefined> {
  const timeout = new AbortController()
  const timer = setTimeout(() => { timeout.abort() }, CLAIM_TIMEOUT_MS)
  try {
    const response = await fetch(handoff.claimUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verifier: handoff.verifier }),
      signal: timeout.signal,
    })
    if (response.status !== 200) return undefined
    const body = await response.json() as { session?: unknown; challenge?: unknown }
    if (typeof body.session === 'string' && typeof body.challenge === 'string') {
      return { session: body.session, challenge: body.challenge }
    }
    return { error: true }
  } catch {
    // An unreachable server or a timed-out request says nothing about a sign-in
    // still in progress; the next read asks again.
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Encode bytes as unpadded base64url.
 * @param bytes - the bytes to encode.
 * @returns the encoded text.
 */
function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/**
 * Follow the end of a provider sign-in that produced no session.
 * @param listener - called each time an embedding shell reports one.
 * @returns disposer removing the listener.
 */
export function onProviderSignInEnded(listener: () => void): () => void {
  window.addEventListener(PROVIDER_SIGN_IN_ENDED_EVENT, listener)
  return () => { window.removeEventListener(PROVIDER_SIGN_IN_ENDED_EVENT, listener) }
}

/**
 * Read whether this document has a session, through the profile the API answers.
 * @returns true when the API answers a profile.
 */
async function hasSession(): Promise<boolean> {
  try {
    await getProfile()
    return true
  } catch {
    // A refused read or an unreachable API says nothing about a session the
    // reader is still finishing; the next read asks again.
    return false
  }
}
