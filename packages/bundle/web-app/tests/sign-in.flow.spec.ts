/**
 * Sign-in against a stand-in for the deployment: what the exchange makes of the
 * route's replies, the listener's bind failure, and the whole `signIn()` round
 * trip.
 *
 * The listener is the real loopback one this module binds, driven with real
 * `fetch` calls; only the deployment's `/check-oauth-token` route and the
 * browser opener are doubles, so neither a browser nor a running API is needed.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { exchangeCallbackPair, loopbackOrigin, signIn, startCallbackListener } from '../src/sign-in.ts'

/** One request the stand-in route received. */
interface ReceivedRequest {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

/** What the stand-in route answers one request with. */
interface ApiReply {
  readonly status: number
  readonly body?: unknown
}

/**
 * Run `run` against a stand-in for the deployment's `POST /check-oauth-token`.
 *
 * The route records every request it receives and answers it with `answer(...)`,
 * so a test pins both what the exchange sends and what it makes of the reply. It
 * binds port 0 on loopback, drops every connection it served, and closes itself
 * even when `run` throws.
 * @param answer - the reply for a received request.
 * @param run - receives the stand-in's API origin and the requests it received.
 * @returns whatever `run` returns.
 */
async function withFakeApi<T>(
  answer: (request: ReceivedRequest) => ApiReply,
  run: (apiUrl: string, requests: ReceivedRequest[]) => Promise<T>,
): Promise<T> {
  const requests: ReceivedRequest[] = []
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let raw = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { raw += chunk })
    request.on('end', () => {
      const received: ReceivedRequest = {
        method: request.method ?? '',
        path: request.url ?? '',
        body: raw === '' ? undefined : JSON.parse(raw) as unknown,
      }
      requests.push(received)
      const reply = answer(received)
      response.writeHead(reply.status, { 'Content-Type': 'application/json' })
      response.end(reply.body === undefined ? '' : JSON.stringify(reply.body))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    return await run(loopbackOrigin((server.address() as AddressInfo).port), requests)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  }
}

/** The grant a successful sign-in exchanges the callback pair for. */
const GRANT = { userId: 'user-7', accessToken: 'access-7', refreshToken: 'refresh-7' } as const

/**
 * Whether the origin still accepts a connection.
 *
 * A fresh socket rather than `fetch`: the browser's own connection to the
 * listener is a keep-alive one, which a closed listener keeps serving, so only a
 * new connection shows that the port is released.
 * @param origin - the loopback origin to connect to.
 * @returns true when the connection is refused.
 */
async function refusesConnections(origin: string): Promise<boolean> {
  const port = Number(new URL(origin).port)
  return await new Promise<boolean>((resolve) => {
    const socket = connect(port, '127.0.0.1')
    socket.once('connect', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => { resolve(true) })
  })
}

describe('the exchange', () => {
  it('posts the pair to the deployment route and keeps the grant it answers', async () => {
    await withFakeApi(() => ({ status: 200, body: GRANT }), async (apiUrl, requests) => {
      await expect(exchangeCallbackPair({ apiUrl, callback: { sessionId: 'sess-1', challenge: 'chal-1' } }))
        .resolves.toEqual({ userId: 'user-7', accessToken: 'access-7', refreshToken: 'refresh-7' })
      expect(requests).toEqual([{
        method: 'POST',
        path: '/check-oauth-token',
        body: { session: 'sess-1', challenge: 'chal-1' },
      }])
    })
  })

  it('reports the status the deployment refused the pair with', async () => {
    await withFakeApi(() => ({ status: 401, body: { error: 'unknown challenge' } }), async (apiUrl) => {
      await expect(exchangeCallbackPair({ apiUrl, callback: { sessionId: 's', challenge: 'c' } }))
        .rejects.toThrow('avn: the sign-in could not be exchanged (HTTP 401)')
    })
  })

  it('keeps a grant without an access token, since the refresh token is the credential', async () => {
    await withFakeApi(() => ({ status: 200, body: { userId: 'user-8', refreshToken: 'refresh-8' } }), async (apiUrl) => {
      await expect(exchangeCallbackPair({ apiUrl, callback: { sessionId: 's', challenge: 'c' } }))
        .resolves.toEqual({ userId: 'user-8', accessToken: '', refreshToken: 'refresh-8' })
    })
  })

  it.each([
    ['a refresh token that is not a string', { userId: 'user-9', refreshToken: 42 }],
    ['an empty refresh token', { userId: 'user-9', refreshToken: '' }],
    ['a user id that is not a string', { userId: null, refreshToken: 'refresh-9' }],
    ['an empty user id', { userId: '', refreshToken: 'refresh-9' }],
  ] as const)('refuses a grant with %s', async (_refused, granted) => {
    await withFakeApi(() => ({ status: 200, body: granted }), async (apiUrl) => {
      await expect(exchangeCallbackPair({ apiUrl, callback: { sessionId: 's', challenge: 'c' } }))
        .rejects.toThrow('avn: the sign-in answered without a refresh token')
    })
  })
})

describe('the loopback listener', () => {
  it('fails the wait with the bind error when the port it was told to use is taken', async () => {
    const held: Server = createServer()
    await new Promise<void>((resolve) => { held.listen(0, '127.0.0.1', () => { resolve() }) })
    const listener = startCallbackListener({
      providerUrl: 'http://localhost:9000/oauth/google',
      port: (held.address() as AddressInfo).port,
      timeoutMs: 5_000,
    })
    try {
      const failure = await listener.callback.then(
        () => undefined,
        (error: unknown) => error as NodeJS.ErrnoException,
      )
      expect(failure?.code).toBe('EADDRINUSE')
      expect(failure?.message).toContain(String((held.address() as AddressInfo).port))
    } finally {
      listener.close()
      await new Promise<void>((resolve) => { held.close(() => { resolve() }) })
    }
  })
})

describe('the whole sign-in', () => {
  it('rejects instead of waiting forever when the listener cannot bind', async () => {
    const held: Server = createServer()
    await new Promise<void>((resolve) => { held.listen(0, '127.0.0.1', () => { resolve() }) })
    try {
      // The origin is awaited before the callback, so a bind failure that
      // rejected only the callback would leave this waiting on a listener that
      // never came up. Racing a timer is what distinguishes the two.
      const outcome = await Promise.race([
        signIn({
          apiUrl: 'http://localhost:9000',
          provider: 'google',
          port: (held.address() as AddressInfo).port,
          openBrowser: async () => {},
        }).then(
          () => 'settled',
          (error: unknown) => (error as NodeJS.ErrnoException).code,
        ),
        new Promise<string>((resolve) => { setTimeout(() => { resolve('timed-out') }, 2_000) }),
      ])
      expect(outcome).toBe('EADDRINUSE')
    } finally {
      await new Promise<void>((resolve) => { held.close(() => { resolve() }) })
    }
  })

  it('opens the browser at the listener and returns the credential to store', async () => {
    await withFakeApi(() => ({ status: 200, body: GRANT }), async (apiUrl, requests) => {
      const opened: string[] = []
      const signedIn = await signIn({
        apiUrl,
        provider: 'google',
        openBrowser: async (url) => {
          opened.push(url)
          // The browser loads the loopback page, which negotiates it to the
          // provider, and the provider returns the pair to that same origin.
          const page = await fetch(url)
          expect(page.status).toBe(200)
          expect(await page.text()).toContain('/oauth/google')
          expect((await fetch(`${url}/oauth-result/sess-7/chal-7`)).status).toBe(200)
        },
      })

      expect(signedIn).toEqual({
        userId: 'user-7',
        credentialRef: 'AEVEN_TOKEN',
        refreshToken: 'refresh-7',
      })
      expect(opened).toHaveLength(1)
      expect(requests).toEqual([{
        method: 'POST',
        path: '/check-oauth-token',
        body: { session: 'sess-7', challenge: 'chal-7' },
      }])
      // A completed sign-in hands the credential back and holds no port.
      expect(await refusesConnections(opened[0]!)).toBe(true)
    })
  })

  it('gives up when the browser never returns the callback, and releases the port', async () => {
    await withFakeApi(() => ({ status: 200, body: GRANT }), async (apiUrl) => {
      let origin = ''
      await expect(signIn({
        apiUrl,
        provider: 'x',
        port: 0,
        timeoutMs: 100,
        openBrowser: async (url) => { origin = url },
      })).rejects.toThrow('avn: the sign-in was not completed in time')

      expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      expect(await refusesConnections(origin)).toBe(true)
    })
  })

  it('reports a browser that cannot be opened, and releases the port', async () => {
    await withFakeApi(() => ({ status: 200, body: GRANT }), async (apiUrl) => {
      let origin = ''
      await expect(signIn({
        apiUrl,
        provider: 'apple',
        openBrowser: (url) => {
          origin = url
          return Promise.reject(new Error('avn: no browser on this machine'))
        },
      })).rejects.toThrow('avn: no browser on this machine')

      expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      expect(await refusesConnections(origin)).toBe(true)
    })
  })

  it('reports the deployment refusing the exchange, and normalizes the API origin', async () => {
    await withFakeApi(() => ({ status: 403, body: { error: 'refused' } }), async (apiUrl, requests) => {
      let origin = ''
      await expect(signIn({
        apiUrl: `${apiUrl}/`,
        provider: 'google',
        openBrowser: async (url) => {
          origin = url
          await fetch(`${url}/oauth-result/sess-3/chal-3`)
        },
      })).rejects.toThrow('avn: the sign-in could not be exchanged (HTTP 403)')

      expect(requests).toEqual([{
        method: 'POST',
        path: '/check-oauth-token',
        body: { session: 'sess-3', challenge: 'chal-3' },
      }])
      expect(await refusesConnections(origin)).toBe(true)
    })
  })
})
