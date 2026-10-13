/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Fresh module instances, so one test's page session never reaches the next. */
async function load() {
  vi.resetModules()
  const gate = await import('../src/client/index.ts')
  const { session } = await import('../src/client/auth/services/session.ts')
  return { ...gate, session }
}

/** A token as the Aeven API signs it; only the payload is read here. */
function token(userId: string, expiresInSeconds: number): string {
  const claims = { userId, exp: Math.floor(Date.now() / 1000) + expiresInSeconds }
  return `header.${btoa(JSON.stringify(claims))}.signature`
}

/** The answer a reader who has chosen a name gets. */
const profile = { userId: 'u-1', email: 'a@b.c', displayName: 'Ollie', displayNameSet: true }

describe('restoring the session at boot', () => {
  beforeEach(() => {
    ;(globalThis as { __AVN_AEVEN__?: unknown }).__AVN_AEVEN__ = { apiUrl: 'http://api.test' }
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { __AVN_AEVEN__?: unknown }).__AVN_AEVEN__
    delete (globalThis as { __AVN_AEVEN_READER__?: unknown }).__AVN_AEVEN_READER__
  })

  it('keeps the profile it read, so a later load that cannot ask still names the reader', async () => {
    const { restoreSession } = await load()
    window.localStorage.setItem('userId', 'u-1')
    window.localStorage.setItem('appBearers', JSON.stringify({ 'u-1': token('u-1', 7200) }))
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(profile)))

    expect(await restoreSession()).toEqual({ state: 'authenticated', userId: 'u-1' })
    expect(JSON.parse(window.localStorage.getItem('aevenProfile') ?? 'null') as unknown)
      .toMatchObject({ userId: 'u-1', displayName: 'Ollie' })
  })

  it('boots the application when Aeven cannot be reached, because the Host still identifies the reader', async () => {
    const { restoreSession, session } = await load()
    window.localStorage.setItem('aevenProfile', JSON.stringify(profile))
    // The Host verifies the year-long refresh cookie against its own copy of
    // the secret, so an Aeven outage leaves local providers reachable.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

    expect(await restoreSession()).toEqual({ state: 'authenticated', userId: 'u-1' })
    expect(session.userSignedIn).toBe(true)
    expect(session.displayName).toBe('Ollie')
    // The account menu reads the reader from the page, not from Aeven.
    expect((globalThis as { __AVN_AEVEN_READER__?: { userId: string } })
      .__AVN_AEVEN_READER__?.userId).toBe('u-1')
  })

  it('boots the application when Aeven answers 5xx, which says nothing about the session', async () => {
    const { restoreSession } = await load()
    window.localStorage.setItem('aevenProfile', JSON.stringify(profile))
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'db-error' }, { status: 500 })))

    expect(await restoreSession()).toEqual({ state: 'authenticated', userId: 'u-1' })
  })

  it('signs the reader out when Aeven refuses the credential, whatever is kept', async () => {
    const { restoreSession, session } = await load()
    window.localStorage.setItem('aevenProfile', JSON.stringify(profile))
    // 400 and 401 from /refresh-token leave nothing to retry with; only Aeven's
    // own refusal decides that the session ended.
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'no-token' }, { status: 401 })))

    expect(await restoreSession()).toEqual({ state: 'unauthenticated' })
    expect(session.userSignedIn).toBe(false)
    expect((globalThis as { __AVN_AEVEN_READER__?: unknown }).__AVN_AEVEN_READER__).toBeUndefined()
  })

  it('presents the sign-in screen when nothing was ever kept', async () => {
    const { restoreSession } = await load()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    // A first visit during an outage has no session to keep; the reader signs
    // in when Aeven returns.
    expect(await restoreSession()).toEqual({ state: 'unauthenticated' })
  })

  it('ignores a kept profile that will not parse or names nobody', async () => {
    const { restoreSession } = await load()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    window.localStorage.setItem('aevenProfile', 'not json')
    expect(await restoreSession()).toEqual({ state: 'unauthenticated' })
    window.localStorage.setItem('aevenProfile', JSON.stringify({ userId: '' }))
    expect(await restoreSession()).toEqual({ state: 'unauthenticated' })
  })

  it('discards the kept profile on sign-out, so an outage cannot restore it', async () => {
    const { signOut } = await load()
    window.localStorage.setItem('aevenProfile', JSON.stringify(profile))
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true })))

    await signOut()
    expect(window.localStorage.getItem('aevenProfile')).toBeNull()
  })

  it('asks for a name when the API holds none for the reader', async () => {
    const { restoreSession } = await load()
    window.localStorage.setItem('userId', 'u-1')
    window.localStorage.setItem('appBearers', JSON.stringify({ 'u-1': token('u-1', 7200) }))
    // An account that never chose one answers no flag at all; a derived name
    // answers false. Both are the naming step's state.
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ userId: 'u-1', displayName: 'u-1' })))

    expect(await restoreSession()).toEqual({ state: 'unnamed', userId: 'u-1' })

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      userId: 'u-1', displayName: 'Ollie', displayNameSet: false,
    })))
    expect(await restoreSession()).toEqual({ state: 'unnamed', userId: 'u-1' })
  })

  it('reads the kept profile by the same rule, so a named reader boots through an outage', async () => {
    const { restoreSession } = await load()
    window.localStorage.setItem('aevenProfile', JSON.stringify({ userId: 'u-1', displayName: 'Ollie' }))
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

    // A profile kept before this client knew the flag cannot say the reader
    // chose a name, and the step they would land on needs the API to save one.
    expect(await restoreSession()).toEqual({ state: 'unnamed', userId: 'u-1' })
  })

  it('boots a reader who chose a name even when the API cannot be reached', async () => {
    const { restoreSession } = await load()
    window.localStorage.setItem('aevenProfile', JSON.stringify(profile))
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

    expect(await restoreSession()).toEqual({ state: 'authenticated', userId: 'u-1' })
  })

  it('boots nobody from the kept profile once the Host refused the page', async () => {
    const { restoreSession, session } = await load()
    const watch = await import('../src/client/auth/services/watch.ts')
    window.localStorage.setItem('aevenProfile', JSON.stringify(profile))
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    // The Host refused a request this document presented nothing for: it
    // authenticated neither a bearer nor the refresh cookie, so the kept profile
    // names a reader whose every call would be unauthenticated.
    watch.noteHostRefusal()

    expect(await restoreSession()).toEqual({ state: 'unauthenticated' })
    expect(session.userSignedIn).toBe(false)
  })

  it('authenticates nobody when no Aeven API is configured', async () => {
    const { restoreSession } = await load()
    delete (globalThis as { __AVN_AEVEN__?: unknown }).__AVN_AEVEN__
    expect(await restoreSession()).toEqual({ state: 'disabled' })
  })
})
