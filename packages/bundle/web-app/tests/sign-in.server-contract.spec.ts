/**
 * The two fallbacks the loopback listener keeps for `http.Server`'s own
 * contract: a request whose `IncomingMessage.url` is omitted, and an
 * `address()` of null on the listening callback.
 *
 * Neither arises from a real socket — Node's parser fills `url` for every
 * request it hands to the server, and its listening event does not fire once the
 * handle is closed — so each is driven through the server's documented `request`
 * event and through a bound server that reports no address. Binding, the served
 * page, and the released port stay the real thing.
 */

import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { startCallbackListener } from '../src/sign-in.ts'

/** The server this module just created, and what its `address()` must report. */
const bound = vi.hoisted(() => ({
  server: undefined as Server | undefined,
  reportsPort: true,
}))

vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http')>()
  return {
    ...actual,
    createServer: (listener?: (request: IncomingMessage, response: ServerResponse) => void) => {
      const server = actual.createServer(listener)
      bound.server = server
      // A server that is not listening reports no address, which is the answer
      // the listener's own callback has to fail the wait on.
      if (!bound.reportsPort) server.address = () => null
      return server
    },
  }
})

describe('the listener under the server contract', () => {
  it('serves the sign-in page to a request that carries no URL', async () => {
    const listener = startCallbackListener({
      providerUrl: 'http://localhost:9000/oauth/google',
      timeoutMs: 5_000,
    })
    try {
      await listener.origin

      const written: Array<{ status: number; headers: unknown }> = []
      let body = ''
      const response = {
        writeHead: (status: number, headers?: unknown) => {
          written.push({ status, headers })
          return response
        },
        end: (payload?: string) => { body = payload ?? '' },
      } as unknown as ServerResponse

      // `IncomingMessage.url` is undefined until Node's parser assigns it.
      bound.server?.emit('request', { url: undefined } as unknown as IncomingMessage, response)

      expect(written).toEqual([{ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }])
      expect(body).toContain('location.replace("http://localhost:9000/oauth/google")')
    } finally {
      listener.close()
    }
  })

  it('fails the wait when the listener bound no port', async () => {
    bound.reportsPort = false
    try {
      const listener = startCallbackListener({
        providerUrl: 'http://localhost:9000/oauth/google',
        timeoutMs: 5_000,
      })
      const failure = await listener.callback.then(
        () => undefined,
        (error: unknown) => error as Error,
      )
      expect(failure?.message).toBe('avn: the sign-in listener did not bind a port')
      // The listener closed itself, so the port it did bind is released even
      // though no origin was ever published for it.
      expect(bound.server?.listening).toBe(false)
      listener.close()
    } finally {
      bound.reportsPort = true
    }
  })
})
