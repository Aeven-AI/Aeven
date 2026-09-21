/**
 * Keeping a booted page's Aeven session alive, and leaving when it ends.
 *
 * The gate restores the session once, before the plugin graph boots. This
 * renews the access token before it lapses — each renewal also rotates the
 * year-long refresh token, so a page left open never signs out — and, when the
 * API refuses the session, discards it and tells whoever owns the page. The
 * boot kernel is that owner: it disposes the plugin tree and runs its gate
 * again, so the reader reaches the sign-in screen in the document they are in.
 * @module
 */

import { isSessionRefusal } from './errors.ts'
import { session } from './session.ts'
import { bearerRenewalTime, bearerToken, currentBearer, deleteBearerToken } from './tokens.ts'

/** Delay before retrying a renewal that failed without the API refusing it. */
const TRANSIENT_RETRY_MILLISECONDS = 30_000

/** Longest delay `setTimeout` honours; a longer one fires immediately. */
const MAX_TIMER_MILLISECONDS = 2 ** 31 - 1

let leaving = false

/** Listeners told that this document's session ended, in the order they were added. */
const sessionEnded = new Set<() => void>()

/**
 * Follow the end of this document's session.
 * @param listener - called once the session has ended and been discarded.
 * @returns disposer removing the listener.
 */
export function onSessionEnded(listener: () => void): () => void {
  sessionEnded.add(listener)
  return () => { sessionEnded.delete(listener) }
}

/**
 * Discard the ended session and tell the page owner to present the sign-in screen.
 *
 * The held bearer is deleted first: it may still verify locally, and a gate that
 * found it would boot the application again straight into the same refusal. The
 * address is left where it is — whoever owns the page moves it, and the gate
 * records the reader's own path as the referrer when it does.
 */
export function leaveForSignIn(): void {
  if (leaving) return
  leaving = true
  deleteBearerToken(session.userId)
  session.reset()
  for (const listener of [...sessionEnded]) listener()
}

/**
 * The token to present, leaving for the sign-in screen when the session has ended.
 * @param rejected - a token the Host refused, forcing a renewal.
 * @returns the token, or undefined when none could be obtained.
 */
export async function sessionBearer(rejected?: string): Promise<string | undefined> {
  try {
    return await currentBearer(rejected)
  } catch (error) {
    if (isSessionRefusal(error)) leaveForSignIn()
    // A transport failure leaves the session intact; the request goes out
    // without a bearer and the next call or the renewal timer tries again.
    return undefined
  }
}

/**
 * Renew the token before it lapses for as long as the page lives.
 *
 * Timers stall while a machine sleeps, so becoming visible and regaining the
 * network check again. A bearer removed by another tab's sign-out ends this
 * tab's session too.
 * @returns disposer cancelling the renewal timer and removing the listeners.
 */
export function watchSession(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  // Watching a session is what says this page is not leaving one: a reader who
  // signs in again after an ended session is renewed, not left standing.
  leaving = false

  const schedule = (delay: number): void => {
    clearTimeout(timer)
    timer = setTimeout(() => { void check() }, Math.min(Math.max(delay, 0), MAX_TIMER_MILLISECONDS))
  }

  const check = async (): Promise<void> => {
    const token = await sessionBearer()
    if (leaving || stopped) return
    const renewal = token === undefined ? undefined : bearerRenewalTime(token)
    schedule(renewal === undefined ? TRANSIENT_RETRY_MILLISECONDS : renewal - Date.now())
  }

  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') void check()
  }
  const onOnline = (): void => { void check() }
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== 'appBearers' || session.userId === null) return
    if (bearerToken(session.userId) === undefined) leaveForSignIn()
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('online', onOnline)
  window.addEventListener('storage', onStorage)
  void check()

  return () => {
    stopped = true
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('storage', onStorage)
  }
}
