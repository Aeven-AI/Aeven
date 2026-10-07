/** Test scaffolding shared by the discord-mcp suites: a stubbed fetch and an in-memory MCP session. */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createDiscordServer, type DiscordEnvironment } from '../aeven/main.ts'

/** Loopback API base the suites point the client at, so no request can reach Discord. */
export const TEST_BASE = 'http://127.0.0.1:8765/v10'

/** The guild every suite serves. */
export const TEST_GUILD = '1490000000000000000'

/** Environment a suite starts from. */
export const TEST_ENV: DiscordEnvironment = {
  DISCORD_BOT_TOKEN: 'spec-bot-token',
  DISCORD_GUILD_ID: TEST_GUILD,
  DISCORD_GUILD_NAME: 'Spec Server',
  DISCORD_API_BASE: TEST_BASE,
}

/** One request a stubbed fetch received. */
export interface RecordedRequest {
  /** Absolute request URL. */
  url: string
  /** HTTP verb. */
  method: string
  /** Request headers, as the client set them. */
  headers: Record<string, string>
  /** Request body: a string for a JSON request, a `FormData` for a multipart one. */
  body: unknown
}

/** A fetch stub: the requests it received and the way to remove it. */
export interface FetchStub {
  /** Requests received so far, including the one currently being answered. */
  requests: RecordedRequest[]
  /** Restore the original `globalThis.fetch`. */
  restore: () => void
}

/**
 * Replace `globalThis.fetch` for one test.
 * @param respond - builds each answer from the request it receives.
 * @returns the recorded requests and the restore function.
 */
export function stubFetch(respond: (request: RecordedRequest) => Response | Promise<Response>): FetchStub {
  const original = globalThis.fetch
  const requests: RecordedRequest[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request: RecordedRequest = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    }
    requests.push(request)
    return await respond(request)
  }) as typeof fetch
  return { requests, restore: () => { globalThis.fetch = original } }
}

/**
 * A JSON answer for a fetch stub.
 * @param body - the value to serialize.
 * @param status - HTTP status to answer with.
 * @returns the response.
 */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/**
 * A refusal whose body carries text no error may echo.
 * @param status - HTTP status to answer with.
 * @returns the response.
 */
export function refusal(status: number): Response {
  return new Response(JSON.stringify({ message: 'BODY_SENTINEL', code: 50013 }), { status })
}

/** A session of the built server and the client speaking to it. */
export interface Session {
  /** The connected client. */
  client: Client
  /** The server those tools came from. */
  server: McpServer
}

/**
 * Connect a server to an in-memory client.
 * @param env - the environment the server is built from.
 * @returns the connected client and its server.
 */
export async function connectServer(env: DiscordEnvironment = TEST_ENV): Promise<Session> {
  const server = createDiscordServer(env)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'discord-mcp-spec', version: '0.0.0' })
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  return { client, server }
}

/**
 * The text of a tool result's blocks.
 * @param result - the value a tool call returned.
 * @returns the concatenated text.
 */
export function resultText(result: unknown): string {
  const content = (result as { content?: { type: string, text?: string }[] }).content ?? []
  return content.map((block) => block.text ?? '').join('\n')
}

/**
 * The names of the tools a session serves.
 * @param session - the connected session.
 * @returns the tool names in registration order.
 */
export async function servedToolNames(session: Session): Promise<string[]> {
  const listed = await session.client.listTools()
  return listed.tools.map((tool) => tool.name)
}
