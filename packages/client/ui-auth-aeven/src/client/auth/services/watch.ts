/**
 * Keeping a booted page's Aeven session alive, and leaving when it ends.
 *
 * The gate restores the session once, before the plugin graph boots. This
 * renews the access token before it lapses — each renewal also rotates the
 * year-long refresh token, so a page left open never signs out — and, when the
 * API refuses the session or another tab replaces it with a different account,
 * discards this document's session and tells whoever owns the page. The boot
 * kernel is that owner: it disposes the plugin tree and runs its gate again, so
 * the reader reaches the sign-in screen — or the account the browser now holds
 * — in the document they are in.
 * @module
 */

import { isIdentityChange, isSessionRefusal } from './errors.ts'
import { session, storage } from './session.ts'
import { bearerRenewalTime, bearerToken, currentBearer, deleteBearerToken } from './tokens.ts'

/** Delay before retrying a renewal that failed without the API refusing it. */
const TRANSIENT_RETRY_MILLISECONDS = 30_000

/** Longest delay `setTimeout` honours; a longer one fires immediately. */
const MAX_TIMER_MILLISECONDS = 2 ** 31 - 1

let leaving = false

/** Whether the Host refused a request this document presented nothing for. */
let refused = false

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
 * Whether this document is between sessions, so it may present no credential.
 *
 * True from the moment its session ended until the gate it asked for boots the
 * next one.
 * @returns true while a request made now would carry no session of this page's.
 */
export function pageIsLeaving(): boolean {
  return leaving
}

/**
 * Whether the Host has refused this document's session since its last gate run.
 *
 * A refusal with nothing presented is the one answer that proves the refresh
 * cookie no longer identifies this browser, so the next gate must not rebuild a
 * signed-in application out of the kept profile.
 * @returns true when the kept profile may not restore a reader.
 */
export function hostRefusedSession(): boolean {
  return refused
}

/** Record that the Host refused a request this document presented no bearer for. */
export function noteHostRefusal(): void {
  refused = true
}

/**
 * End this document's session and tell its owner to run the gate again.
 * @param discardBearerOf - account whose stored bearer the end discards, or null
 * to keep every stored bearer.
 */
function endPageSession(discardBearerOf: string | null): void {
  if (leaving) return
  leaving = true
  if (discardBearerOf !== null) deleteBearerToken(discardBearerOf)
  session.reset()
  for (const listener of [...sessionEnded]) listener()
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
  endPageSession(session.userId)
}

/**
 * End this document's session because the browser now holds another account.
 *
 * No stored bearer is discarded: the account that replaced this page's is
 * signed in, and its session belongs to the tab that established it. The gate
 * that follows restores that account, so the reader, the navigation and the
 * Sessions on screen are the ones the browser's credential reaches.
 */
function replacePageAccount(): void {
  endPageSession(null)
}

/**
 * Whether the account the browser stores is the one this document restored.
 *
 * Every document of one origin shares `userId` and `appBearers`, so a sign-in in
 * one tab changes what the others would present.
 * @returns true when the page restored that account, or restored none yet.
 */
function storedAccountIsPages(): boolean {
  const stored = storage.getItem('userId')
  return stored === null || session.userId === null || stored === session.userId
}

/**
 * The token to present, ending this document's session when it is no longer the
 * session the browser holds.
 * @param rejected - a token the Host refused, forcing a renewal.
 * @returns the token, or undefined when none could be obtained.
 */
export async function sessionBearer(rejected?: string): Promise<string | undefined> {
  if (!storedAccountIsPages()) {
    replacePageAccount()
    return undefined
  }
  try {
    return await currentBearer(rejected)
  } catch (error) {
    if (isIdentityChange(error)) replacePageAccount()
    else if (isSessionRefusal(error)) leaveForSignIn()
    // A transport failure leaves the session intact; the request goes out
    // without a bearer and the Host authenticates it by the refresh cookie.
    return undefined
  }
}

/**
 * Renew the token before it lapses for as long as the page lives.
 *
 * Timers stall while a machine sleeps, so becoming visible and regaining the
 * network check again. A bearer removed by another tab's sign-out ends this
 * tab's session too. Every token this page holds that the Host has not been
 * handed yet goes to `handOver` at once: the Host presents the caller's token
 * to Aeven on the caller's behalf (the model route), and only learns a renewed
 * one from a request that carries it.
 * @param handOver - sends a token the Host has not seen to the Host.
 * @returns disposer cancelling the renewal timer and removing the listeners.
 */
export function watchSession(handOver: (token: string) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let handedOver: string | undefined
  // Watching a session is what says this page is not leaving one: a reader who
  // signs in again after an ended session is renewed, not left standing. The
  // refusal latch belongs to the pass that recorded it, so the gate this watch
  // follows reads it exactly once.
  leaving = false
  refused = false

  const schedule = (delay: number): void => {
    clearTimeout(timer)
    timer = setTimeout(() => { void check() }, Math.min(Math.max(delay, 0), MAX_TIMER_MILLISECONDS))
  }

  const check = async (): Promise<void> => {
    const token = await sessionBearer()
    if (leaving || stopped) return
    if (token !== undefined && token !== handedOver) {
      handedOver = token
      handOver(token)
    }
    const renewal = token === undefined ? undefined : bearerRenewalTime(token)
    schedule(renewal === undefined ? TRANSIENT_RETRY_MILLISECONDS : renewal - Date.now())
  }

  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') void check()
  }
  const onOnline = (): void => { void check() }
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== 'appBearers' && event.key !== 'userId') return
    if (session.userId === null) return
    // A stored account id that is no longer this page's is another tab's
    // sign-in. This document ends its session and runs its gate again rather
    // than reading the reader's own Sessions as another account.
    if (!storedAccountIsPages()) {
      replacePageAccount()
      return
    }
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
