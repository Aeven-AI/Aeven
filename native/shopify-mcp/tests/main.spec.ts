/**
 * The Shopify server: its configuration, its tools as an MCP client sees them, and what each
 * tool sends to the Admin GraphQL API.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { afterEach, describe, expect, it } from 'vitest'
import { readConfig, registerTools, renderResult, type AdminFetch } from '../aeven/main.ts'

const ENV = {
  SHOPIFY_SHOP: 'mugs.myshopify.com', SHOPIFY_ACCESS_TOKEN: 'shpat_test', SHOPIFY_API_VERSION: '2026-10',
  SHOPIFY_MAX_RESULT_BYTES: '4096', SHOPIFY_REQUEST_TIMEOUT_MS: '5000',
}

const clients: Client[] = []
afterEach(async () => { for (const client of clients.splice(0)) await client.close() })

/** Connect a client to a server whose Admin API is the given fake. */
async function connect(send: AdminFetch): Promise<{ client: Client; sent: { url: string; headers: Record<string, string>; body: { query: string; variables?: unknown } }[] }> {
  const sent: { url: string; headers: Record<string, string>; body: { query: string; variables?: unknown } }[] = []
  const server = new McpServer({ name: 'test', version: '0' })
  registerTools(server, readConfig(ENV), async (url, init) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) as { query: string } })
    return send(url, init)
  })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  const client = new Client({ name: 'test-client', version: '0' })
  await client.connect(clientSide)
  clients.push(client)
  return { client, sent }
}

function text(result: unknown): string {
  return ((result as { content: { text: string }[] }).content[0]?.text) ?? ''
}

describe('configuration', () => {
  it('accepts a store domain, token, version, and bounds', () => {
    expect(readConfig(ENV)).toEqual({ shop: 'mugs.myshopify.com', accessToken: 'shpat_test', apiVersion: '2026-10', maxResultBytes: 4096, requestTimeoutMs: 5000 })
  })

  it('refuses a domain outside myshopify.com, a missing token, and a malformed version', () => {
    expect(() => readConfig({ ...ENV, SHOPIFY_SHOP: 'evil.example.com' })).toThrow(/SHOPIFY_SHOP/)
    expect(() => readConfig({ ...ENV, SHOPIFY_ACCESS_TOKEN: '' })).toThrow(/SHOPIFY_ACCESS_TOKEN/)
    expect(() => readConfig({ ...ENV, SHOPIFY_API_VERSION: 'latest' })).toThrow(/SHOPIFY_API_VERSION/)
  })
})

describe('result budget', () => {
  it('cuts at the byte budget without splitting a character and says so', () => {
    const rendered = renderResult({ title: 'é'.repeat(2_000) }, 1_024)
    expect(Buffer.byteLength(rendered, 'utf8')).toBeLessThanOrEqual(1_024)
    expect(rendered).toMatch(/cut at 1024 bytes/)
    expect(rendered).not.toContain('�')
  })
})

describe('tools', () => {
  it('marks the three reads read-only and the mutation as not', async () => {
    const { client } = await connect(async () => ({ status: 200, body: { data: {} } }))
    const tools = (await client.listTools()).tools
    const hints = Object.fromEntries(tools.map(tool => [tool.name, tool.annotations?.readOnlyHint]))
    expect(hints).toEqual({ get_shop: true, describe_type: true, graphql_query: true, graphql_mutation: false })
  })

  it('sends a query to the store\'s Admin API with its token and returns the data', async () => {
    const { client, sent } = await connect(async () => ({ status: 200, body: { data: { shop: { name: 'Mugs' } }, extensions: { cost: { requestedQueryCost: 1 } } } }))
    const result = await client.callTool({ name: 'graphql_query', arguments: { query: '{ shop { name } }' } })
    expect(sent[0]?.url).toBe('https://mugs.myshopify.com/admin/api/2026-10/graphql.json')
    expect(sent[0]?.headers['X-Shopify-Access-Token']).toBe('shpat_test')
    expect(JSON.parse(text(result))).toEqual({ data: { shop: { name: 'Mugs' } }, extensions: { cost: { requestedQueryCost: 1 } } })
    expect(result.isError).toBeFalsy()
  })

  it('refuses a mutation in the read tool without calling Shopify', async () => {
    const { client, sent } = await connect(async () => ({ status: 200, body: { data: {} } }))
    const result = await client.callTool({ name: 'graphql_query', arguments: { query: 'query { shop { name } } mutation { productDelete(input: { id: "1" }) { deletedProductId } }' } })
    expect(result.isError).toBe(true)
    expect(sent).toHaveLength(0)
  })

  it('runs one mutation with its variables', async () => {
    const { client, sent } = await connect(async () => ({ status: 200, body: { data: { productUpdate: { userErrors: [] } } } }))
    await client.callTool({ name: 'graphql_mutation', arguments: { mutation: 'mutation U($p: ProductUpdateInput!) { productUpdate(product: $p) { userErrors { message } } }', variables: { p: { id: 'gid://shopify/Product/1', title: 'Mug' } } } })
    expect(sent[0]?.body.variables).toEqual({ p: { id: 'gid://shopify/Product/1', title: 'Mug' } })
  })

  it('reports a refused token and a GraphQL error as failures', async () => {
    const refused = await connect(async () => ({ status: 401, body: { errors: '[API] Invalid API key or access token' } }))
    const denied = await refused.client.callTool({ name: 'get_shop', arguments: {} })
    expect(denied.isError).toBe(true)
    expect(text(denied)).toMatch(/reconnect the store/)
    const failing = await connect(async () => ({ status: 200, body: { data: null, errors: [{ message: 'Field \'nope\' doesn\'t exist' }] } }))
    const failed = await failing.client.callTool({ name: 'graphql_query', arguments: { query: '{ nope }' } })
    expect(failed.isError).toBe(true)
    expect(text(failed)).toMatch(/doesn't exist/)
  })
})
