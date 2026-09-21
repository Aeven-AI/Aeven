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
 * @returns resolves once this document has a session.
 */
export async function awaitProviderSession(): Promise<void> {
  while (!await hasSession()) {
    await new Promise((resolve) => { setTimeout(resolve, SESSION_POLL_MS) })
  }
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
