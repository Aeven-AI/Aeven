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
    calls.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: decodeBody(init.body),
    })
    return Promise.resolve(new Response(
      TEXT_GENERATION.map(event => `data: ${event}\n\n`).join(''),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ))
  })
  return calls
}
