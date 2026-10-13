import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { installProxyFromEnvironment } from '@aeven/http-proxy'
import { Context } from '@deepseek-ai/cordis'
import { MediaRuntime } from '@aeven/media'
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

/** Drive the shipping provider at its pinned origin; the proxy record is the assertion. */
async function generateOnce(): Promise<void> {
  process.env.OPENROUTER_API_KEY = 'probe-key'
  try {
    const ctx = new Context()
    await ctx.plugin(MediaRuntime)
    await ctx.plugin(provider)
    await ctx.media.startVideo({ model: 'probe/model', prompt: 'a probe' })
  } finally {
    delete process.env.OPENROUTER_API_KEY
  }
}

describe('OpenRouter media egress', () => {
  it('sends the generation request through the proxy', async () => {
    const observed = await observe(generateOnce)
    expect(observed.join('|')).toContain('openrouter.ai')
  })
})
