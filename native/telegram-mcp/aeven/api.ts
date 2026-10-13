/**
 * Raw MTProto access: one tool that reaches every request class teleproto ships, so a capability
 * the named tools do not cover is still available without changing the daemon.
 *
 * Authentication and account security are out of reach by design: the daemon owns the session and
 * the credentials, and no tool may hand the account away, change its password, or move money.
 */

import bigInt from 'big-integer'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Api, getClient } from '../source/src/client.ts'
import { tool, z } from '../source/src/tools/helpers.ts'

/** The namespaces the raw tool refuses, each with the reason it is out of reach. */
const REFUSED_NAMESPACES: Record<string, string> = {
  auth: 'signing in belongs to the connector, not to a tool',
  account: 'account security and deletion belong to the connector, not to a tool',
  payments: 'payments spend real money',
}

/** How much of a response is rendered before it is cut short. */
const MAX_RESULT_CHARS = 4000

/** A method name as the schema spells it, like `messages.SearchGlobal`. */
const METHOD_NAME = /^([a-z][A-Za-z0-9]*)\.([A-Z][A-Za-z0-9]*)$/

/** A generated request class, as the schema declares it. */
export type RequestConstructor = new (args: Record<string, unknown>) => unknown

/**
 * Resolve the request class a method name selects.
 * @param method - a name like `messages.SearchGlobal`.
 * @returns the constructor to invoke.
 * @throws when the name is malformed, refused, or absent from the schema.
 */
export function resolveRequest(method: string): RequestConstructor {
  const match = METHOD_NAME.exec(method.trim())
  if (match === null) throw new Error(`Expected a method like "messages.SearchGlobal", got "${method}".`)
  const namespace = match[1] as string
  const name = match[2] as string
  const refusal = REFUSED_NAMESPACES[namespace]
  if (refusal !== undefined) throw new Error(`The "${namespace}.*" namespace is out of reach: ${refusal}.`)
  const table = (Api as unknown as Record<string, Record<string, unknown> | undefined>)[namespace]
  const constructor = table?.[name]
  if (typeof constructor !== 'function') throw new Error(`Telegram's schema has no request "${namespace}.${name}".`)
  return constructor as RequestConstructor
}

/** A response as plain data: generated classes serialize themselves, and anything else is walked. */
function plain(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value
  if (bigInt.isInstance(value)) return value.toString()
  const serialize = (value as { toJSON?: unknown }).toJSON
  if (typeof serialize === 'function') return (serialize as () => unknown).call(value)
  if (depth >= 3) return '[…]'
  if (Array.isArray(value)) return value.map(item => plain(item, depth + 1))
  const fields: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key.startsWith('_')) continue
    fields[key] = plain(item, depth + 1)
  }
  return fields
}

/**
 * Render a response for the model, bounded so a large one cannot fill the context.
 * @param value - what Telegram answered.
 * @returns the response as JSON, or a sentence when there is nothing to show.
 */
export function renderResult(value: unknown): string {
  if (value === undefined) return 'Telegram returned no result.'
  if (typeof value === 'boolean') return `Telegram answered: ${String(value)}.`
  const rendered = JSON.stringify(plain(value), undefined, 2)
  if (rendered === undefined) return String(value)
  return rendered.length > MAX_RESULT_CHARS ? `${rendered.slice(0, MAX_RESULT_CHARS)}\n… truncated` : rendered
}

/** Register the raw request tool. */
export function registerApiTool(server: McpServer): void {
  tool(
    server,
    'telegram_api_call',
    {
      title: 'Call a Telegram API method',
      description:
        'Invoke any Telegram request by name, for capabilities the named tools do not cover. The auth, account, and payments namespaces are refused.',
      inputSchema: {
        method: z.string().describe('Request name as the schema spells it, like "messages.SearchGlobal".'),
        params: z.record(z.string(), z.unknown()).default({}).describe('Request fields, named as the schema names them.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ method, params }) => {
      const build = resolveRequest(method)
      const client = await getClient()
      // The schema is dynamic by design: teleproto's generated classes are selected by name, which
      // no single static request type covers.
      const request = new build(params) as Parameters<typeof client.invoke>[0]
      return renderResult(await client.invoke(request))
    }
  )
}
