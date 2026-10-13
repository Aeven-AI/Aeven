/**
 * Stand-in for the Aeven gateway's chat-completions endpoint. One `fetch`
 * replacement records the calls the adapter makes and answers each with a
 * complete text generation as server-sent events, so request facts and stream
 * behavior are exercised without a socket.
 */

import { vi } from 'vitest'

/** One recorded chat-completions call: endpoint, lowercased headers, and decoded JSON body. */
export interface ChatCall {
  /** Absolute URL the adapter addressed. */
  url: string
  /** Request headers, lowercased as `Headers` reports them. */
  headers: Record<string, string>
  /** Decoded JSON request body. */
  body: Record<string, unknown>
}

/** The wire events of one complete generation, replayed verbatim on every call. */
const TEXT_GENERATION = [
  '{"choices":[{"delta":{"role":"assistant","content":null,"reasoning_content":""}}]}',
  '{"choices":[{"delta":{"content":"hello"}}]}',
  '{"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
  '[DONE]',
]

/**
 * Decode the request body the chat-completions protocol always sends as JSON.
 * @param body - the `fetch` request body.
 * @returns the decoded JSON object.
 * @throws TypeError when the request carries no string body.
 */
function decodeBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== 'string') {
    throw new TypeError('chat-completions double: the request body is not a JSON string')
  }
  return JSON.parse(body) as Record<string, unknown>
}

/**
 * Replace `fetch` with the chat-completions stand-in. The caller restores the
 * real `fetch` with `vi.unstubAllGlobals()`.
 * @returns the calls the adapter makes, in request order.
 */
export function stubChatCompletions(): ChatCall[] {
  const calls: ChatCall[] = []
  vi.stubGlobal('fetch', (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    calls.push(record(input, init))
    return Promise.resolve(textGeneration())
  })
  return calls
}

/** The recorded chat calls and the URLs a files-less gateway refused. */
export interface GatewayCalls {
  /** Chat-completions calls, in request order. */
  chat: ChatCall[]
  /** URLs the adapter addressed and this gateway does not serve, such as `/files`. */
  refused: string[]
}

/**
 * Replace `fetch` with the whole surface this route addresses: the
 * chat-completions stand-in above, plus a `/files` path that answers 404.
 *
 * That refusal is the real gateway's shape — it is an inference gateway with no
 * Files API — and it is why an image reaches it inline: the adapter's file
 * representation fails over to the base64 one. The caller restores the real
 * `fetch` with `vi.unstubAllGlobals()`.
 * @returns the chat calls, and the URLs refused.
 */
export function stubGatewayWithoutFilesApi(): GatewayCalls {
  const calls: GatewayCalls = { chat: [], refused: [] }
  vi.stubGlobal('fetch', (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input)
    if (url.endsWith('/files')) {
      calls.refused.push(url)
      return Promise.resolve(new Response('{"error":{"message":"no Files API on this gateway"}}', {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }))
    }
    calls.chat.push(record(input, init))
    return Promise.resolve(textGeneration())
  })
  return calls
}

/** Record one call: endpoint, lowercased headers, and decoded JSON body. */
function record(input: string | URL, init: RequestInit): ChatCall {
  return {
    url: String(input),
    headers: Object.fromEntries(new Headers(init.headers).entries()),
    body: decodeBody(init.body),
  }
}

/** One complete text generation as a server-sent-events response. */
function textGeneration(): Response {
  return new Response(
    TEXT_GENERATION.map(event => `data: ${event}\n\n`).join(''),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )
}
