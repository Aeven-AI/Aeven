/** @vitest-environment jsdom */
/**
 * Provider sign-in through a window of its own.
 *
 * What this covers is the window's two own facts — where it is opened, and
 * whether this document is one — plus the wait that tells a page the reader
 * finished elsewhere: a session appears, or it has not yet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  awaitProviderSession, isProviderLanding, openProviderSignIn,
} from '../src/client/auth/services/oauth.ts'

/** The grant a session read refreshes in through; only its arrival is read. */
const GRANT = { userId: 'u-1', accessToken: 'header.eyJ1c2VySWQiOiJ1LTEiLCJleHAiOjk5OTk5OTk5OTl9.sig' }

/** The profile the API answers once the reader is signed in and named. */
const PROFILE = { userId: 'u-1', displayName: 'Ollie', displayNameSet: true }

/**
 * Answer the two routes a session read reaches.
 * @param state - mutable holder: `reachable: false` refuses the read, `signedIn` answers a session.
 */
function scriptedApi(state: { signedIn: boolean; reachable?: boolean }): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (state.reachable === false) throw new TypeError('network down')
    if (!state.signedIn) return new Response(null, { status: 401 })
    const url = input instanceof URL ? input.href : input
    return new URL(url as string).pathname === '/refresh-token' ? Response.json(GRANT) : Response.json(PROFILE)
  }))
}

/** Install an opener, or restore the null one jsdom leaves. */
function withOpener(opener: object | null): void {
  Object.defineProperty(window, 'opener', { value: opener, configurable: true, writable: true })
}

beforeEach(() => {
  ;(globalThis as { __AVN_AEVEN__?: unknown }).__AVN_AEVEN__ = { apiUrl: 'http://api.test' }
  window.localStorage.clear()
  withOpener(null)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (globalThis as { __AVN_AEVEN__?: unknown }).__AVN_AEVEN__
})

describe('the provider window', () => {
  it('is opened at the provider URL, named so a second press reuses the one window', () => {
    const open = vi.fn(() => null)
    vi.stubGlobal('open', open)

    openProviderSignIn('https://provider.test/sign-in')

    expect(open).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledWith(
      'https://provider.test/sign-in', 'aeven-provider-signin', 'popup=yes,width=520,height=760',
    )
  })

  it('is this document only when another document opened it', () => {
    expect(isProviderLanding()).toBe(false)
    withOpener({})
    expect(isProviderLanding()).toBe(true)
  })
})

describe('waiting for a sign-in the reader finishes in another window', () => {
  it('returns as soon as the session is there', async () => {
    scriptedApi({ signedIn: true })
    await expect(awaitProviderSession()).resolves.toBeUndefined()
  })

  it('waits while the API answers no session, then takes the one that arrives', async () => {
    vi.useFakeTimers()
    const state = { signedIn: false }
    scriptedApi(state)

    const waiting = awaitProviderSession()
    let settled = false
    void waiting.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(2500)
    // The reader is still in the provider's window: the screen stays as it is.
    expect(settled).toBe(false)

    state.signedIn = true
    await vi.advanceTimersByTimeAsync(1000)
    await expect(waiting).resolves.toBeUndefined()
  })

  it('keeps waiting when the API cannot be reached, rather than reading that as finished', async () => {
    vi.useFakeTimers()
    const state = { signedIn: true, reachable: false }
    scriptedApi(state)

    const waiting = awaitProviderSession()
    await vi.advanceTimersByTimeAsync(2000)

    state.reachable = true
    await vi.advanceTimersByTimeAsync(1000)
    await expect(waiting).resolves.toBeUndefined()
  })
})
