/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** A token as the Aeven API signs it; only the payload is read here. */
function token(userId: string, expiresInSeconds: number, nonce = ''): string {
  const claims = { userId, exp: Math.floor(Date.now() / 1000) + expiresInSeconds, nonce }
  return `header.${btoa(JSON.stringify(claims))}.signature`
}

/** Fresh module instances, so the in-flight renewal and the leaving flag start clear. */
async function load() {
  vi.resetModules()
  const tokens = await import('../src/client/auth/services/tokens.ts')
  const watch = await import('../src/client/auth/services/watch.ts')
  const gate = await import('../src/client/index.ts')
  const { session } = await import('../src/client/auth/services/session.ts')
  return { ...tokens, ...watch, ...gate, session }
}

/** Replace page navigation, which jsdom does not implement. */
function stubNavigation(pathname: string) {
  const assign = vi.fn()
  vi.spyOn(window, 'location', 'get').mockReturnValue({ pathname, assign } as unknown as Location)
  return assign
}

const held = (): Record<string, string> =>
  JSON.parse(window.localStorage.getItem('appBearers') ?? '{}') as Record<string, string>

/** Watches started by a test, stopped after it so no listener reaches the next. */
const stops: (() => void)[] = []

describe('renewing the Aeven session', () => {
  beforeEach(() => {
    ;(globalThis as { __AVN_AEVEN__?: unknown }).__AVN_AEVEN__ = { apiUrl: 'http://api.test' }
    window.localStorage.clear()
  })
  afterEach(() => {
    for (const stop of stops.splice(0)) stop()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete (globalThis as { __AVN_AEVEN__?: unknown }).__AVN_AEVEN__
  })

  it('exchanges the refresh cookie once for concurrent callers, because the API rotates it', async () => {
    const { currentBearer } = await load()
    const fresh = token('u-1', 7200)
    let release!: () => void
    const answered = new Promise<void>((resolve) => { release = resolve })
    const fetchMock = vi.fn(async () => {
      await answered
      return Response.json({ userId: 'u-1', accessToken: fresh })
    })
    vi.stubGlobal('fetch', fetchMock)

    const callers = [currentBearer(), currentBearer(), currentBearer()]
    release()
    // A second exchange would present the cookie the first one replaced, and
    // the API answers that with 401 and a cleared cookie.
    expect(await Promise.all(callers)).toEqual([fresh, fresh, fresh])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('adopts a token another tab stored while this one waited for the lock', async () => {
    const { currentBearer } = await load()
    const fromOtherTab = token('u-1', 7200)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('navigator', {
      locks: {
        request: async (_name: string, step: () => Promise<string>) => {
          window.localStorage.setItem('userId', 'u-1')
          window.localStorage.setItem('appBearers', JSON.stringify({ 'u-1': fromOtherTab }))
          return step()
        },
      },
    })

    expect(await currentBearer()).toBe(fromOtherTab)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renews instead of returning a token the Host refused', async () => {
    const { currentBearer } = await load()
    const refused = token('u-1', 7200, 'old')
    const fresh = token('u-1', 7200, 'new')
    window.localStorage.setItem('userId', 'u-1')
    window.localStorage.setItem('appBearers', JSON.stringify({ 'u-1': refused }))
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ userId: 'u-1', accessToken: fresh })))

    expect(await currentBearer()).toBe(refused)
    expect(await currentBearer(refused)).toBe(fresh)
  })

  it('discards the held bearer and reports the end of the session when the API refuses the cookie', async () => {
    const { sessionBearer, session, onSessionEnded } = await load()
    const assign = stubNavigation('/sessions/abc')
    const ended = vi.fn()
    const stop = onSessionEnded(ended)
    window.localStorage.setItem('userId', 'u-1')
    const refused = token('u-1', 7200)
    window.localStorage.setItem('appBearers', JSON.stringify({ 'u-1': refused }))
    session.userId = 'u-1'
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'invalid-refresh-token' }, { status: 401 })))

    expect(await sessionBearer(refused)).toBeUndefined()
    // The bearer would still verify locally; a gate that found it would boot
    // straight back into the refusal.
    expect(held()).toEqual({})
    expect(ended).toHaveBeenCalledOnce()
    // The address belongs to whoever owns the page: the kernel presents the
    // sign-in screen in the document the reader is in, and records where they
    // were as the referrer when it does.
    expect(assign).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('authReferrer')).toBeNull()

    await sessionBearer(refused)
    expect(ended).toHaveBeenCalledOnce()
    stop()
  })

  it('keeps the session when the renewal fails for a reason that says nothing about it', async () => {
    const { sessionBearer } = await load()
    const assign = stubNavigation('/')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'db-error' }, { status: 500 })))
    expect(await sessionBearer()).toBeUndefined()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    expect(await sessionBearer()).toBeUndefined()
    expect(assign).not.toHaveBeenCalled()
  })

  it('retries a Host 401 once with a renewed bearer', async () => {
    const { installAuthenticatedTransport } = await load()
    vi.useFakeTimers()
    const refused = token('u-1', 7200, 'old')
    const fresh = token('u-1', 7200, 'new')
    window.localStorage.setItem('userId', 'u-1')
    window.localStorage.setItem('appBearers', JSON.stringify({ 'u-1': refused }))
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ userId: 'u-1', accessToken: fresh })))
    const presented: (string | null)[] = []
    const host = vi.fn(async (_input: URL, init: RequestInit) => {
      const authorization = new Headers(init.headers).get('authorization')
      presented.push(authorization)
      return new Response(null, { status: authorization === `Bearer ${fresh}` ? 200 : 401 })
    })
    const scope = globalThis as { __AVN_TRANSPORT__?: { fetch?: typeof host } }
    scope.__AVN_TRANSPORT__ = { fetch: host }
    try {
      stops.push(installAuthenticatedTransport())
      const response = await scope.__AVN_TRANSPORT__.fetch?.(new URL('http://host.test/api/x'), { method: 'POST', body: '{}' })
      expect(response?.status).toBe(200)
      expect(presented).toEqual([`Bearer ${refused}`, `Bearer ${fresh}`])
    } finally {
      delete scope.__AVN_TRANSPORT__
      vi.useRealTimers()
    }
  })

  it('reports the end of the session when another tab signs out', async () => {
    const { watchSession, session, onSessionEnded } = await load()
    const assign = stubNavigation('/')
    const ended = vi.fn()
    const stop = onSessionEnded(ended)
    window.localStorage.setItem('userId', 'u-1')
    window.localStorage.setItem('appBearers', JSON.stringify({ 'u-1': token('u-1', 7200) }))
    vi.stubGlobal('fetch', vi.fn())
    vi.useFakeTimers()
    try {
      stops.push(watchSession())
      await vi.waitFor(() => { expect(session.userId).toBe('u-1') })
      window.localStorage.setItem('appBearers', '{}')
      window.dispatchEvent(new StorageEvent('storage', { key: 'appBearers' }))
      expect(ended).toHaveBeenCalledOnce()
      expect(assign).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      stop()
    }
  })

  it('ignores storage changes that leave this reader signed in', async () => {
    const { watchSession, session } = await load()
    const assign = stubNavigation('/')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 500 })))
    vi.useFakeTimers()
    try {
      stops.push(watchSession())
      window.dispatchEvent(new StorageEvent('storage', { key: 'appBearers' }))
      session.userId = 'u-1'
      window.localStorage.setItem('appBearers', JSON.stringify({ 'u-1': token('u-1', 7200) }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'userId' }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'appBearers' }))
      expect(assign).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('checks again after a transient failure, on becoming visible, and when the network returns', async () => {
    vi.useFakeTimers()
    try {
      const { watchSession } = await load()
      const fetchMock = vi.fn(async () => Response.json({ error: 'db-error' }, { status: 500 }))
      vi.stubGlobal('fetch', fetchMock)

      stops.push(watchSession())
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(fetchMock).toHaveBeenCalledTimes(2)

      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).toHaveBeenCalledTimes(3)
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops renewing once the page is leaving', async () => {
    vi.useFakeTimers()
    try {
      const { watchSession } = await load()
      stubNavigation('/')
      const fetchMock = vi.fn(async () => Response.json({ error: 'no-token' }, { status: 400 }))
      vi.stubGlobal('fetch', fetchMock)
      stops.push(watchSession())
      await vi.advanceTimersByTimeAsync(3_600_000)
      expect(fetchMock).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('renews shortly before the held token expires', async () => {
    vi.useFakeTimers()
    try {
      const { watchSession } = await load()
      window.localStorage.setItem('userId', 'u-1')
      window.localStorage.setItem('appBearers', JSON.stringify({ 'u-1': token('u-1', 600, 'old') }))
      const fetchMock = vi.fn(async () => Response.json({ userId: 'u-1', accessToken: token('u-1', 7200, 'new') }))
      vi.stubGlobal('fetch', fetchMock)

      stops.push(watchSession())
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).not.toHaveBeenCalled()
      // The token stops being worth sending two minutes before its expiry.
      await vi.advanceTimersByTimeAsync(480_000)
      expect(fetchMock).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
