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
import { deflateSync } from 'node:zlib'
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

/** CRC-32 over one PNG chunk, per the PNG specification's polynomial. */
function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * A valid truecolor PNG of the given size. Sized above the store's normalized
 * 2048² pixel budget, it forces the downscale path that reports the input
 * dimensions beside the stored raster.
 * @param width - raster width in pixels.
 * @param height - raster height in pixels.
 * @returns the encoded PNG as base64, the form a gateway answer carries.
 */
function png(width: number, height: number): string {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const stride = 1 + width * 3
  const raw = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y += 1) {
    const row = y * stride
    for (let x = 0; x < width; x += 1) {
      const at = row + 1 + x * 3
      raw[at] = y % 256
      raw[at + 1] = (x >> 4) % 256
      raw[at + 2] = 96
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length, 0)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE(crc32(body), 0)
    return Buffer.concat([length, body, checksum])
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64')
}

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

/**
 * Start the gateway double; it records each body and answers the given image.
 * @param image - base64 PNG the gateway answers with.
 * @returns the gateway URL, the bodies it received, and their authorization headers.
 */
async function startGateway(image: string = PNG_1X1): Promise<{ url: string; bodies: unknown[]; auth: (string | undefined)[] }> {
  const bodies: unknown[] = []
  const auth: (string | undefined)[] = []
  gateway = createServer((request: IncomingMessage, response) => {
    let raw = ''
    request.on('data', (chunk: Buffer) => { raw += chunk.toString() })
    request.on('end', () => {
      bodies.push(JSON.parse(raw))
      auth.push(request.headers.authorization)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ created: 0, data: [{ b64_json: image }] }))
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
    expect(out.content[0]).toEqual({ type: 'text', text: 'Generated 1 image(s) with Aeven Image Flash. Already displayed to the user; do not repeat or embed them in your reply.' })
    expect(out.content[1]).toMatchObject({ type: 'image', attachment: { mediaType: 'image/png', width: 1, height: 1 } })
  })

  it('states each configured model\'s per-call image count as the provider declares it', async () => {
    const { url } = await startGateway()
    const ctx = await loadComposition(url)

    const description = ctx.tools.get('generate_image')?.description ?? ''
    const listed = description.split('Available models: ')[1] ?? ''
    // Every shipped choice states the count its own provider enforces, so a
    // model composes a call the gateway will accept instead of losing a turn.
    // A choice's own text carries `; ` separators, so each entry runs to where
    // the next model's id begins.
    for (const [index, model] of MediaAeven.AEVEN_IMAGE_MODELS.entries()) {
      const next = MediaAeven.AEVEN_IMAGE_MODELS[index + 1]
      const clause = listed.slice(listed.indexOf(`${model.id} `), next === undefined ? undefined : listed.indexOf(`${next.id} `))
      expect(clause).toContain(`up to ${String(model.maxImages)} images per call`)
    }
  })

  it('stores an image the store had to scale down, keeping its images and their reported dimensions', async () => {
    const { url } = await startGateway(png(4096, 1755))
    const ctx = await loadComposition(url)

    const out = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-1'),
      name: 'generate_image',
      arguments: { prompt: 'a wide valley', resolution: '2K' },
    })
    expect(out.isError).not.toBe(true)
    const [image] = (out.value as {
      images: { width: number; height: number; originalDimensions?: { width: number; height: number } }[]
    }).images
    expect(image?.originalDimensions).toEqual({ width: 4096, height: 1755 })
    expect(image!.width).toBeLessThan(4096)
    expect(image!.width * image!.height).toBeLessThanOrEqual(2048 * 2048)
    expect(out.content.some(block => block.type === 'image')).toBe(true)
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
