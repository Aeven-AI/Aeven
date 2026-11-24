#!/usr/bin/env node
/**
 * Executable entry of the Shopify connector server.
 *
 * One process serves one store: the connector spawns this entry per connected store and passes
 * the store's domain and a short-lived Admin API access token in the environment, so no tool
 * accepts a store. stdout carries the MCP stream and nothing else.
 */

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { isMutationDocument, isReadDocument } from './graphql.ts'

/** The process environment the connector populated. */
export type ShopifyEnvironment = Readonly<Record<string, string | undefined>>

/** Validated configuration of one store's server process. */
export interface ShopifyConfig {
  /** The store's `<name>.myshopify.com` domain. */
  shop: string
  /** Admin API access token for that store. */
  accessToken: string
  /** Admin API version, such as `2026-10`. */
  apiVersion: string
  /** Largest result text one call returns, in bytes; a longer one is cut and says so. */
  maxResultBytes: number
  /** Network budget of one Admin API call, in milliseconds. */
  requestTimeoutMs: number
}

/** A store's domain as Shopify issues it; the connector never sends a token anywhere else. */
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/
/** An Admin API version: a year and a quarter-start month. */
const API_VERSION = /^\d{4}-(?:01|04|07|10)$/

/** Identifies this server in the MCP handshake. */
const SERVER_INFO = { name: 'aeven-shopify', version: '0.1.0' } as const

/**
 * Read and validate the connector's environment.
 * @param env - the process environment.
 * @returns the store's configuration.
 * @throws when a value is missing or malformed, naming the variable.
 */
export function readConfig(env: ShopifyEnvironment): ShopifyConfig {
  const shop = env.SHOPIFY_SHOP ?? ''
  if (!SHOP_DOMAIN.test(shop)) throw new Error('SHOPIFY_SHOP must be a <store>.myshopify.com domain')
  const accessToken = env.SHOPIFY_ACCESS_TOKEN ?? ''
  if (accessToken === '') throw new Error('SHOPIFY_ACCESS_TOKEN is required')
  const apiVersion = env.SHOPIFY_API_VERSION ?? ''
  if (!API_VERSION.test(apiVersion)) throw new Error('SHOPIFY_API_VERSION must look like 2026-10')
  const maxResultBytes = Number(env.SHOPIFY_MAX_RESULT_BYTES)
  if (!Number.isInteger(maxResultBytes) || maxResultBytes < 1_024) throw new Error('SHOPIFY_MAX_RESULT_BYTES must be an integer of at least 1024')
  const requestTimeoutMs = Number(env.SHOPIFY_REQUEST_TIMEOUT_MS)
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1) throw new Error('SHOPIFY_REQUEST_TIMEOUT_MS must be a positive integer')
  return { shop, accessToken, apiVersion, maxResultBytes, requestTimeoutMs }
}

/** What one Admin GraphQL call answered. */
export interface AdminResponse {
  status: number
  body: unknown
}

/** Sends one Admin GraphQL request; tests replace it. */
export type AdminFetch = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<AdminResponse>

/** The default {@link AdminFetch}, over the runtime's fetch. */
const defaultFetch: AdminFetch = async (url, init) => {
  const response = await fetch(url, { ...init, redirect: 'error' })
  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    // A non-JSON answer (an HTML error page) carries no GraphQL result; its status says what happened.
    body = undefined
  }
  return { status: response.status, body }
}

/**
 * Render one result as the tool's text, cut to the byte budget.
 * @param value - the JSON value to render.
 * @param maxBytes - the budget in UTF-8 bytes.
 * @returns the text, ending with a note when it was cut.
 */
export function renderResult(value: unknown, maxBytes: number): string {
  const text = JSON.stringify(value, null, 2)
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.length <= maxBytes) return text
  const note = `\n… cut at ${maxBytes} bytes; ask for fewer fields or a smaller page (\`first\`).`
  const keep = Math.max(0, maxBytes - Buffer.byteLength(note, 'utf8'))
  // Back off to a character boundary so a multibyte character is never split.
  let end = keep
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1
  return bytes.subarray(0, end).toString('utf8') + note
}

/**
 * Register the store's tools.
 * @param server - the MCP server.
 * @param config - the store's configuration.
 * @param send - the Admin GraphQL transport.
 */
export function registerTools(server: McpServer, config: ShopifyConfig, send: AdminFetch = defaultFetch): void {
  const endpoint = `https://${config.shop}/admin/api/${config.apiVersion}/graphql.json`

  /** Run one document and render its data, errors, and query cost. */
  async function run(document: string, variables: Record<string, unknown> | undefined): Promise<{ content: { type: 'text'; text: string }[]; isError?: true }> {
    const response = await send(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Shopify-Access-Token': config.accessToken },
      body: JSON.stringify({ query: document, ...variables === undefined ? {} : { variables } }),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    })
    if (response.status === 401 || response.status === 403) {
      return { content: [{ type: 'text', text: `Shopify refused the request (HTTP ${response.status}): the store's connection lacks access. Ask the user to reconnect the store in Settings.` }], isError: true }
    }
    if (response.status === 429) return { content: [{ type: 'text', text: 'Shopify is rate limiting this store; wait a moment and retry with a smaller query.' }], isError: true }
    const body = response.body as { data?: unknown; errors?: unknown; extensions?: unknown } | undefined
    if (response.status >= 400 || body === undefined) return { content: [{ type: 'text', text: `Shopify answered HTTP ${response.status} without a GraphQL result.` }], isError: true }
    const text = renderResult({ ...body.data === undefined ? {} : { data: body.data }, ...body.errors === undefined ? {} : { errors: body.errors },
      ...body.extensions === undefined ? {} : { extensions: body.extensions } }, config.maxResultBytes)
    return body.data === undefined || body.data === null ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] }
  }

  const variables = z.record(z.string(), z.unknown()).optional().describe('GraphQL variables, by name without `$`.')

  server.registerTool('get_shop', {
    description: 'Read the connected store: its name, domains, currency, plan, and timezone.',
    annotations: { readOnlyHint: true },
  }, async () => run('{ shop { name myshopifyDomain primaryDomain { url } currencyCode ianaTimezone plan { displayName } } }', undefined))

  server.registerTool('describe_type', {
    description: 'Describe one type of the Shopify Admin GraphQL schema (for example Product, Order, QueryRoot, or ProductInput): its fields, their arguments and types, input fields, and enum values. Use it to write correct queries and mutations.',
    inputSchema: { name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).describe('The type\'s exact name.') },
    annotations: { readOnlyHint: true },
  }, async ({ name }) => run(
    'query Describe($name: String!) { __type(name: $name) { name kind description fields { name description args { name type { ...Ref } } type { ...Ref } } inputFields { name description type { ...Ref } } enumValues { name description } } }'
    + ' fragment Ref on __Type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }',
    { name },
  ))

  server.registerTool('graphql_query', {
    description: 'Run a read-only Shopify Admin GraphQL query against the connected store, such as products, orders, customers, inventory, or discounts. Lists are paginated: pass `first` and use `pageInfo { hasNextPage endCursor }` with `after`. A document containing a mutation is refused; use graphql_mutation for changes.',
    inputSchema: { query: z.string().min(1).describe('A GraphQL query document.'), variables },
    annotations: { readOnlyHint: true },
  }, async ({ query, variables: values }) => {
    if (!isReadDocument(query)) return { content: [{ type: 'text', text: 'This tool runs queries only; the document defines a mutation or subscription, or could not be read.' }], isError: true }
    return run(query, values)
  })

  server.registerTool('graphql_mutation', {
    description: 'Run one Shopify Admin GraphQL mutation against the connected store, such as creating or updating a product, adjusting inventory, or updating an order. It changes the live store. Check the payload\'s `userErrors` in the result.',
    inputSchema: { mutation: z.string().min(1).describe('A GraphQL document defining exactly one mutation.'), variables },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ mutation, variables: values }) => {
    if (!isMutationDocument(mutation)) return { content: [{ type: 'text', text: 'This tool runs exactly one mutation; the document defines something else or could not be read.' }], isError: true }
    return run(mutation, values)
  })
}

/** Start the server over stdio with the environment's configuration. */
async function main(): Promise<void> {
  const config = readConfig(process.env)
  const server = new McpServer(SERVER_INFO)
  registerTools(server, config)
  await server.connect(new StdioServerTransport())
}

// Run only as the executable: tests import the module without starting a server.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`shopify-mcp: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
