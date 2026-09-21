/**
 * Headless sign-in mechanics: redirect parsing, the referer page, the loopback
 * listener, and the exchange's failure reporting.
 *
 * The exchange's success path needs a real single-use challenge, which only the
 * deployment can mint, so it is exercised against a running API by
 * `scripts/verify-sign-in.ts` rather than from a unit test.
 */

import { describe, expect, it } from 'vitest'
import {
  callbackFrom,
  exchangeCallbackPair,
  loopbackOrigin,
  signInPage,
  startCallbackListener,
} from '../src/sign-in.ts'

describe('callback parsing', () => {
  it('reads the session and challenge from the redirect', () => {
    expect(callbackFrom('/oauth-result/session-abc/challenge-xyz')).toEqual({
      sessionId: 'session-abc',
      challenge: 'challenge-xyz',
    })
  })

  it('ignores a query string', () => {
    expect(callbackFrom('/oauth-result/s1/c1?ignored=1')).toEqual({ sessionId: 's1', challenge: 'c1' })
  })

  it('reports a refused sign-in as no callback rather than as a pair', () => {
    // The provider error path redirects to the same prefix with one segment.
    expect(callbackFrom('/oauth-result/error')).toBeUndefined()
  })

  it('rejects an unrelated path and a bare prefix', () => {
    expect(callbackFrom('/')).toBeUndefined()
    expect(callbackFrom('/oauth-result')).toBeUndefined()
    expect(callbackFrom('/oauth-result/a/b/c')).toBeUndefined()
    expect(callbackFrom('/other/a/b')).toBeUndefined()
  })

  it('honours a configured result path', () => {
    expect(callbackFrom('/custom/s/c', '/custom')).toEqual({ sessionId: 's', challenge: 'c' })
    expect(callbackFrom('/oauth-result/s/c', '/custom')).toBeUndefined()
  })
})

describe('the page that starts the flow', () => {
  it('navigates to the provider route', () => {
    const page = signInPage('http://localhost:9000/oauth/google')
    expect(page).toContain('http://localhost:9000/oauth/google')
    expect(page).toContain('location.replace(')
  })

  it('escapes the URL inside the refresh meta tag', () => {
    // A query string is the realistic case; an unescaped ampersand would end the
    // attribute and the browser would follow a truncated route.
    const page = signInPage('http://localhost:9000/oauth/x?a=1&b=2')
    expect(page).toContain('a=1&amp;b=2')
  })
})

describe('the loopback listener', () => {
  it('serves the sign-in page, accepts one callback, and closes', async () => {
    const listener = startCallbackListener({
      providerUrl: 'http://localhost:9000/oauth/google',
      timeoutMs: 5_000,
    })
    let origin = ''
    try {
      origin = await listener.origin
      expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

      const page = await fetch(origin)
      expect(page.status).toBe(200)
      expect(await page.text()).toContain('/oauth/google')

      expect((await fetch(`${origin}/nope`)).status).toBe(404)
      expect((await fetch(`${origin}/oauth-result`)).status).toBe(404)

      const callback = listener.callback
      const answered = await fetch(`${origin}/oauth-result/sess-1/chal-1`)
      expect(answered.status).toBe(200)
      await expect(callback).resolves.toEqual({ sessionId: 'sess-1', challenge: 'chal-1' })

      // The listener is closed on the first callback, so the port is released
      // even though the caller still holds the handle.
      await expect(fetch(`${origin}/oauth-result/sess-2/chal-2`)).rejects.toThrow()
    } finally {
      listener.close()
    }
  })

  it('reports a refused sign-in instead of resolving with a pair', async () => {
    const listener = startCallbackListener({
      providerUrl: 'http://localhost:9000/oauth/google',
      timeoutMs: 150,
    })
    try {
      const origin = await listener.origin
      const outcome = listener.callback.then(
        () => 'resolved',
        (error: unknown) => (error as Error).message,
      )
      const refused = await fetch(`${origin}/oauth-result/error`)
      // The error redirect is not a pair, so the listener answers 404 rather than
      // accepting a partial callback as one; the wait is what reports the refusal.
      expect(refused.status).toBe(404)
      expect(await outcome).toMatch(/not completed in time/)
    } finally {
      listener.close()
    }
  })

  it('gives up when nobody completes the sign-in', async () => {
    const listener = startCallbackListener({
      providerUrl: 'http://localhost:9000/oauth/google',
      timeoutMs: 50,
    })
    try {
      await listener.origin
      await expect(listener.callback).rejects.toThrow(/not completed in time/)
    } finally {
      listener.close()
    }
  })
})

describe('the exchange', () => {
  it('reports an HTTP refusal without inventing a token', async () => {
    const server = startCallbackListener({
      providerUrl: 'http://localhost:9000/oauth/google',
      timeoutMs: 5_000,
    })
    try {
      // No API answers this origin, so the transport fails; the point is that a
      // refusal is an error rather than a silent empty credential.
      await expect(exchangeCallbackPair({
        apiUrl: loopbackOrigin(1),
        callback: { sessionId: 's', challenge: 'c' },
      })).rejects.toThrow()
    } finally {
      server.close()
    }
  })
})
