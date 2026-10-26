import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { installProxyFromEnvironment } from '@aeven/http-proxy'
import { Context } from '@deepseek-ai/cordis'
import { MediaRuntime } from '@aeven/media'
import { getBuiltinImageModels } from '@earendil-works/pi-ai/providers/all'
import * as provider from '../src/index.ts'

let seen: string[] = []
let proxy: Server
let proxyUrl: string

beforeAll(async () => {
  proxy = createServer((request, response) => {
    seen.push(`REQ ${request.url ?? ''}`)
    response.writeHead(502); response.end('fake-proxy')
  })
  proxy.on('connect', (request, socket) => {
    seen.push(`CONNECT ${request.url ?? ''}`)
    socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n'); socket.end()
  })
  const a = await new Promise<AddressInfo>((r) => { proxy.listen(0, '127.0.0.1', () => { r(proxy.address() as AddressInfo) }) })
  proxyUrl = `http://127.0.0.1:${String(a.port)}`
})
afterAll(async () => { await new Promise<void>((r) => { proxy.close(() => { r() }) }) })

/** The launch environment of a user who exported one proxy for both schemes. */
function proxyEnv(): { get(name: string): { value: string } | undefined } {
  return { get: name => (name === 'HTTP_PROXY' || name === 'HTTPS_PROXY' ? { value: proxyUrl } : undefined) }
}
async function observe(run: () => Promise<unknown>): Promise<string[]> {
  seen = []
  const dispose = await installProxyFromEnvironment(proxyEnv(), () => undefined)
  try { await run().catch(() => undefined) } finally { await dispose() }
  return seen
}

/**
 * This provider reaches the network through pi-ai's own images client rather
 * than a `fetch` call of its own, so the record proves the SDK honours the
 * process-wide dispatcher instead of opening its own connection.
 */
async function generateOnce(): Promise<void> {
  process.env.OPENROUTER_API_KEY = 'probe-key'
  try {
    const ctx = new Context()
    await ctx.plugin(MediaRuntime)
    await ctx.plugin(provider)
    // The provider rejects a model outside pi-ai's catalog before it sends
    // anything, so the model comes from the catalog the provider itself reads.
    const model = getBuiltinImageModels('openrouter')[0]?.id
    if (model === undefined) throw new Error('pi-ai served no image model to probe with')
    await ctx.media.generateImage({ model, prompt: 'a probe' })
  } finally {
    delete process.env.OPENROUTER_API_KEY
  }
}

describe('pi-ai media egress', () => {
  it('sends the generation request through the proxy', async () => {
    const observed = await observe(generateOnce)
    expect(observed.join('|')).toContain('openrouter.ai')
  })
})
