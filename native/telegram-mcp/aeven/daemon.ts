/**
 * Aeven-managed Telegram daemon: the upstream MCP server over loopback HTTP,
 * plus the account control endpoints the connector and Settings drive.
 *
 * The daemon binds `127.0.0.1` only and requires `TELEGRAM_MCP_TOKEN` on every
 * request. It announces its bound address as one JSON line on stdout — the
 * connector picks a free port, so the address is only known after binding.
 */

import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { readField, TelegramLoginFlow, type TelegramLoginPort, type TelegramLoginView } from './auth.ts'

/** Largest accepted request body; the control routes carry a phone number, a code, a password, or nothing. */
const MAX_BODY_BYTES = 64 * 1024

/** What the daemon needs to serve one account. */
export interface DaemonOptions {
  /** Bearer token every request must present, generated per process by the connector. */
  token: string
  /** Sign-in operations behind the control endpoints. */
  login: TelegramLoginPort
  /** Builds the MCP server whose tools are served at `/mcp`; called once per MCP session. */
  server: () => McpServer
  /** Loopback port; the default 0 binds a port the operating system chooses. */
  port?: number
}

/** A running daemon. */
export interface DaemonHandle {
  /** Bound loopback address, `127.0.0.1:<port>`. */
  address: string
  /** Stop listening, close the MCP session, and release the sign-in client. */
  close(): Promise<void>
}

/** A request body above the cap; reported as 413 rather than as the daemon's generic failure. */
class BodyTooLarge extends Error {}

/** Whether the request carries the daemon's bearer token, compared without leaking its length or content. */
function authorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const presented = Buffer.from(header.slice('Bearer '.length))
  const expected = Buffer.from(token)
  return presented.length === expected.length && timingSafeEqual(presented, expected)
}

/** Read a JSON request body, rejecting anything above the cap or outside JSON. */
async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = chunk as Buffer
    bytes += buffer.byteLength
    if (bytes > MAX_BODY_BYTES) throw new BodyTooLarge('request body exceeds the accepted size')
    chunks.push(buffer)
  }
  if (bytes === 0) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Start the daemon on loopback.
 * @param options - token, sign-in operations, MCP server factory, and port.
 * @returns the bound address and a closer.
 */
export async function startDaemon(options: DaemonOptions): Promise<DaemonHandle> {
  const flow = new TelegramLoginFlow(options.login)
  /**
   * Open MCP sessions by session id. Every conversation that mounts the account initializes its own
   * session, and a session's transport accepts exactly one initialization, so each gets its own
   * transport and server over the daemon's one Telegram client.
   */
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; mcp: McpServer }>()
  const openSession = async (): Promise<StreamableHTTPServerTransport> => {
    const mcp = options.server()
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => { sessions.set(id, { transport, mcp }) },
    })
    transport.onclose = () => {
      if (transport.sessionId !== undefined) sessions.delete(transport.sessionId)
      void mcp.close().catch(() => {
        // The session is already gone; nothing else holds this server.
      })
    }
    await mcp.connect(transport)
    return transport
  }

  const send = (response: ServerResponse, status: number, body: unknown): void => {
    const payload = JSON.stringify(body)
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(payload), 'Referrer-Policy': 'no-referrer',
    }).end(payload)
  }

  const server = createHttpServer((request, response) => {
    void (async (): Promise<void> => {
      try {
        if (!authorized(request, options.token)) {
          send(response, 401, { error: 'unauthorized' })
          return
        }
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const method = request.method ?? 'GET'
        if (url.pathname === '/mcp') {
          const header = request.headers['mcp-session-id']
          const session = typeof header === 'string' ? sessions.get(header)?.transport : undefined
          if (method === 'POST') {
            const body = await readJsonBody(request)
            if (session !== undefined) {
              await session.handleRequest(request, response, body)
              return
            }
            // A request for an unknown session answers 404, which tells the client to initialize again.
            if (typeof header === 'string') { send(response, 404, { error: 'session-not-found' }); return }
            if (!isInitializeRequest(body)) { send(response, 400, { error: 'session-required' }); return }
            await (await openSession()).handleRequest(request, response, body)
            return
          }
          if (method === 'GET' || method === 'DELETE') {
            if (session === undefined) { send(response, 404, { error: 'session-not-found' }); return }
            await session.handleRequest(request, response)
            return
          }
          send(response, 405, { error: 'method-not-allowed' })
          return
        }
        if (method === 'GET' && url.pathname === '/status') {
          send(response, 200, await flow.status(url.searchParams.get('verify') === '1'))
          return
        }
        if (method === 'POST' && url.pathname === '/login/start') {
          const phone = readField(await readJsonBody(request), 'phone')
          if (phone === undefined) { send(response, 400, { error: 'phone-required' }); return }
          send(response, 200, await flow.start(phone))
          return
        }
        if (method === 'POST' && url.pathname === '/login/qr') {
          send(response, 200, await flow.startQr())
          return
        }
        if (method === 'POST' && url.pathname === '/login/code') {
          const code = readField(await readJsonBody(request), 'code')
          if (code === undefined) { send(response, 400, { error: 'code-required' }); return }
          send(response, 200, flow.code(code))
          return
        }
        if (method === 'POST' && url.pathname === '/login/password') {
          const password = readField(await readJsonBody(request), 'password')
          if (password === undefined) { send(response, 400, { error: 'password-required' }); return }
          send(response, 200, flow.password(password))
          return
        }
        if (method === 'POST' && url.pathname === '/logout') {
          await flow.logout()
          send(response, 200, { state: 'login' } satisfies TelegramLoginView)
          return
        }
        // A control path that exists answers 405; anything else is not a route.
        if (['/status', '/login/start', '/login/qr', '/login/code', '/login/password', '/logout'].includes(url.pathname)) {
          send(response, 405, { error: 'method-not-allowed' })
          return
        }
        send(response, 404, { error: 'not-found' })
      } catch (error) {
        // Request bodies, transport failures, and provider errors carry no detail worth returning.
        if (response.headersSent) { response.end(); return }
        if (error instanceof BodyTooLarge) send(response, 413, { error: 'body-too-large' })
        else send(response, 500, { error: 'internal' })
      }
    })()
  })

  await new Promise<void>((ready, fail) => {
    server.once('error', fail)
    server.listen(options.port ?? 0, '127.0.0.1', () => { ready() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('telegram daemon bound no TCP address')

  let closed: Promise<void> | undefined
  return {
    address: `127.0.0.1:${String(address.port)}`,
    close: async (): Promise<void> => {
      closed ??= (async (): Promise<void> => {
        await Promise.all([...sessions.values()].map(async ({ transport, mcp }) => {
          await transport.close().catch(() => {
            // The MCP session may already be gone; the listener still has to close.
          })
          await mcp.close().catch(() => {
            // Closing the server twice is not an error for the caller.
          })
        }))
        sessions.clear()
        await new Promise<void>((done) => { server.close(() => { done() }) })
        await options.login.dispose?.()
      })()
      await closed
    },
  }
}
