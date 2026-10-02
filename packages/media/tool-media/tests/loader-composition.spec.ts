/**
 * Real-composition guard for image generation as the shipped presets compose
 * it: the media seam pinned to `aeven`, `media-aeven`, the durable local
 * attachment store, and `tool-media` carrying the `aeven` preset's own
 * `tool-media` config, booted from a test-only cordis.yml through the actual
 * Loader + Include path. Only the Aeven gateway is replaced, by a local HTTP
 * double, because it is the external service.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import yaml from 'js-yaml'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LocalAttachmentStore from '@aeven/attachment-local'
import { ToolCallId } from '@aeven/llm'
import { MediaRuntime } from '@aeven/media'
import * as MediaAeven from '@aeven/media-aeven'
import SystemPrompt from '@aeven/system-prompt'
import ToolRuntime from '@aeven/tools'
import * as ToolMedia from '../src/index.ts'

/** 1x1 red PNG (valid signature, IHDR, IDAT), which the attachment store fully decodes. */
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'

const PRESET = fileURLToPath(new URL('../../../preset/agent-presets/presets/aeven/agent.cordis.yml', import.meta.url))

let root: string | undefined
let gateway: Server | undefined
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  if (gateway !== undefined) await new Promise<void>((resolve) => { gateway!.close(() => { resolve() }) })
  gateway = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllEnvs()
})

/**
 * The `aeven` preset's `tool-media` config, exactly as shipped. The preset as a
 * whole carries `!!js` tags this parser does not evaluate, so only the entry's
 * own block is parsed.
 * @returns the shipped config.
 */
async function shippedToolMediaConfig(): Promise<ToolMedia.Config> {
  const text = await readFile(PRESET, 'utf8')
  const start = text.indexOf('- id: tool-media\n')
  const end = text.indexOf('\n- ', start + 1)
  const [entry] = yaml.load(text.slice(start, end)) as [{ config: ToolMedia.Config }]
  return entry.config
}

/** Start the gateway double; it records each body and answers one PNG. */
async function startGateway(): Promise<{ url: string; bodies: unknown[]; auth: (string | undefined)[] }> {
  const bodies: unknown[] = []
  const auth: (string | undefined)[] = []
  gateway = createServer((request: IncomingMessage, response) => {
    let raw = ''
    request.on('data', (chunk: Buffer) => { raw += chunk.toString() })
    request.on('end', () => {
      bodies.push(JSON.parse(raw))
      auth.push(request.headers.authorization)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ created: 0, data: [{ b64_json: PNG_1X1 }] }))
    })
  })
  const address = await new Promise<AddressInfo>((resolve) => {
    gateway!.listen(0, '127.0.0.1', () => { resolve(gateway!.address() as AddressInfo) })
  })
  return { url: `http://127.0.0.1:${String(address.port)}`, bodies, auth }
}

async function loadComposition(apiUrl: string): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'avn-tool-media-loader-'))
  vi.stubEnv('AVN_HOME', root)
  vi.stubEnv('AEVEN_TOKEN', 'session-token')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@aeven/system-prompt'",
    "- name: '@aeven/tools'",
    "- name: '@aeven/attachment-local'",
    "- name: '@aeven/media'",
    '  config:',
    '    imageProvider: aeven',
    "- name: '@aeven/media-aeven'",
    '  config:',
    `    apiUrl: ${JSON.stringify(apiUrl)}`,
    "- name: '@aeven/tool-media'",
    `  config: ${JSON.stringify(await shippedToolMediaConfig())}`,
    '',
  ].join('\n'))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@aeven/system-prompt', SystemPrompt],
    ['@aeven/tools', ToolRuntime],
    ['@aeven/attachment-local', LocalAttachmentStore],
    ['@aeven/media', MediaRuntime],
    ['@aeven/media-aeven', MediaAeven],
    ['@aeven/tool-media', ToolMedia],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const unloaded = [...ctx.loader.entries()]
    .filter(entry => entry.fiber === undefined && !entry.disabled)
    .map(entry => entry.options.name)
  expect(unloaded).toEqual([])
  return ctx
}

describe('image generation through the shipped preset composition', () => {
  it('offers exactly the two Aeven models, Flash by default, and generates with Flash without asking', async () => {
    const { url, bodies, auth } = await startGateway()
    const ctx = await loadComposition(url)

    expect(await ctx.media.listImageModels()).toEqual([
      expect.objectContaining({ provider: 'aeven', id: 'Aeven-1.0-Image-Flash' }),
      expect.objectContaining({ provider: 'aeven', id: 'Aeven-1.0-Image-Pro' }),
    ])
    const description = ctx.tools.get('generate_image')?.description ?? ''
    expect(description).toContain('Available models: Aeven-1.0-Image-Flash (default) — ')
    expect(description).toContain('; Aeven-1.0-Image-Pro — ')

    const out = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-1'),
      name: 'generate_image',
      arguments: { prompt: 'a lighthouse at dusk' },
    })
    expect(out.isError).not.toBe(true)
    expect(bodies).toEqual([{ model: 'Aeven-1.0-Image-Flash', prompt: 'a lighthouse at dusk', response_format: 'b64_json' }])
    expect(auth).toEqual(['Bearer session-token'])
    expect(out.content[0]).toEqual({ type: 'text', text: 'Generated 1 image(s) with Aeven-1.0-Image-Flash.' })
    expect(out.content[1]).toMatchObject({ type: 'image', attachment: { mediaType: 'image/png', width: 1, height: 1 } })
  })

  it('serves Pro with a background when the call names it, and refuses any other model', async () => {
    const { url, bodies } = await startGateway()
    const ctx = await loadComposition(url)
    const call = (callId: string, args: Record<string, unknown>) => ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId(callId),
      name: 'generate_image',
      arguments: args,
    })

    const pro = await call('call-1', { prompt: 'a logo', model: 'Aeven-1.0-Image-Pro', background: 'transparent', size: '2K' })
    expect(pro.isError).not.toBe(true)
    expect(bodies[0]).toEqual({
      model: 'Aeven-1.0-Image-Pro',
      prompt: 'a logo',
      response_format: 'b64_json',
      size: '2K',
      background: 'transparent',
    })

    const other = await call('call-2', { prompt: 'x', model: 'black-forest-labs/FLUX-1.1-pro' })
    expect(other.isError).toBe(true)
    const flashBackground = await call('call-3', { prompt: 'x', background: 'opaque' })
    expect(flashBackground.isError).toBe(true)
    // Neither refusal reached the gateway.
    expect(bodies).toHaveLength(1)
  })
})
