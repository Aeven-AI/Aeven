/**
 * Image input on the deployment's own route.
 *
 * A conversation that carries an image — a pasted screenshot, or what
 * `read_image` answers with — holds a durable content-addressed reference, not
 * bytes. Only the attachment store can turn that reference into something the
 * wire can carry, so a route that does not resolve the store refuses every such
 * request before it serializes anything: one turn failed with
 * `UNSUPPORTED_CONTENT` whose `read_image` call had succeeded a step earlier.
 *
 * What is asserted here is the whole path, against the real local store and a
 * gateway that has no Files API: the image reaches the chat body inline, the
 * handle text names the normalized copy when a filesystem is mounted, and a
 * request that carries no image never enters the image path at all.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@aeven/llm'
import LocalAttachmentStore from '@aeven/attachment-local'
import LocalFileSystem from '@aeven/fs-local'
import * as LlmAeven from '../src/index.ts'
import { DEFAULT_API_KEY_ENV, DEFAULT_API_URL, PROVIDER } from '../src/index.ts'
import { stubGatewayWithoutFilesApi, type GatewayCalls } from './chat-double.ts'
import { cleanupTempHomes, generate, tempHome } from './harness.ts'

/** 1x1 red PNG (valid signature, IHDR, IDAT). */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
)

let ctx: Context | undefined
const scratch: string[] = []

/**
 * A context with the LLM runtime, this route, the durable store the base
 * composition mounts beside it, and optionally a filesystem.
 * @param withFileSystem - whether the `fs` service is mounted too.
 * @returns the mounted context.
 */
async function mountContext(withFileSystem: boolean): Promise<Context> {
  const cwd = await mkdtemp(join(tmpdir(), 'avn-llm-aeven-images-'))
  scratch.push(cwd)
  const mounted = new Context()
  await mounted.plugin(LlmRuntime)
  await mounted.plugin(LocalAttachmentStore, {})
  if (withFileSystem) await mounted.plugin(LocalFileSystem, { cwd })
  await mounted.plugin(LlmAeven, {})
  return mounted
}

/** One wire content part, as far as these assertions read it. */
interface WirePart {
  type: string
  text?: string
  image_url?: { url: string }
}

/** The wire parts of the first message of the one recorded chat call. */
function firstMessageParts(gateway: GatewayCalls): WirePart[] {
  const messages = gateway.chat[0]?.body.messages as { content: WirePart[] }[]
  return messages[0]?.content ?? []
}

/**
 * One user message carrying the text prompt and one durable image.
 * @param ref - the stored attachment to reference.
 * @returns the message to send.
 */
function messageWithImage(ref: Awaited<ReturnType<Context['attachments']['saveImage']>>) {
  return createUserMessage({
    content: [{ type: 'text', text: 'what is in this screenshot?' }, { type: 'image', attachment: ref }],
    source: { kind: 'plugin', plugin: 'llm-aeven-images-test' },
  })
}

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await Promise.all(scratch.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  await cleanupTempHomes()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('images on the aeven-cloud route', () => {
  it('carries the image inline when the gateway answers no Files API', async () => {
    await tempHome()
    vi.stubEnv(DEFAULT_API_KEY_ENV, 'ambient-token')
    const gateway = stubGatewayWithoutFilesApi()
    ctx = await mountContext(false)

    const ref = await ctx.attachments.saveImage({ data: PNG_1X1, mediaType: 'image/png', name: 'shot.png' })
    const result = await generate(ctx, 'Aeven-1.0-Flash', { messages: [messageWithImage(ref)] })

    expect(result.finish).toEqual({ kind: 'stop' })
    // The Files API attempt comes first and is refused — this gateway has none —
    // so the inline form is what actually carries the image. Without the store
    // wired into this route, the request never gets this far: it is refused as
    // `UNSUPPORTED_CONTENT` before a single call is made.
    expect(gateway.refused).toEqual([`${DEFAULT_API_URL}/v1/files`])
    expect(gateway.chat).toHaveLength(1)

    const parts = firstMessageParts(gateway)
    // The prompt as written, then the handle, then the bytes.
    expect(parts).toHaveLength(3)
    expect(parts[0]).toEqual({ type: 'text', text: 'what is in this screenshot?' })
    // The handle names the durable image and its request-preview dimensions, so
    // a model that cannot see bytes still knows what it was sent.
    expect(parts[1]).toMatchObject({ type: 'text' })
    expect(parts[1]?.text).toContain('shot.png')
    expect(parts[1]?.text).toContain('request preview 1x1px')
    // And the bytes themselves ride as a data URL, which is the only image form
    // this gateway accepts.
    expect(parts[2]).toMatchObject({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${PNG_1X1.toString('base64')}` },
    })
  })

  it('names the normalized copy on disk when a filesystem is mounted', async () => {
    await tempHome()
    vi.stubEnv(DEFAULT_API_KEY_ENV, 'ambient-token')
    const gateway = stubGatewayWithoutFilesApi()
    ctx = await mountContext(true)

    const ref = await ctx.attachments.saveImage({ data: PNG_1X1, mediaType: 'image/png', name: 'shot.png' })
    await generate(ctx, 'Aeven-1.0-Flash', { messages: [messageWithImage(ref)] })

    // The path is what lets the model act on the image with file tools, so it
    // has to be the read-only normalized copy rather than the submitted file.
    const handle = firstMessageParts(gateway)[1]?.text ?? ''
    expect(handle).toContain('Normalized copy (read-only')
    expect(handle).toContain('.png')
  })

  it('offloads old previews before image history exceeds the gateway body ceiling', async () => {
    await tempHome()
    vi.stubEnv(DEFAULT_API_KEY_ENV, 'ambient-token')
    const gateway = stubGatewayWithoutFilesApi()
    ctx = await mountContext(true)
    const ref = await ctx.attachments.saveImage({ data: PNG_1X1, mediaType: 'image/png', name: 'shot.png' })
    const version = await ctx.attachments.readImageRequest(ref, { maxPixels: 1, maxBytes: 1024 * 1024 })
    const data = new Uint8Array(1024 * 1024)
    vi.spyOn(ctx.attachments, 'readImageRequest').mockResolvedValue({ ...version, data, bytes: data.byteLength })
    const messages = Array.from({ length: 8 }, () => messageWithImage(ref))

    await generate(ctx, 'Aeven-1.0-Flash', { messages })

    const body = gateway.chat[0]?.body
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(8 * 1024 * 1024)
    const wire = JSON.stringify(body)
    expect(wire).toContain('image omitted to fit request image limits')
    expect(wire).toContain('Normalized copy (read-only')
    expect(wire).toContain('data:image/png;base64,')
    expect(messages.every(message => message.content.some(block => block.type === 'image'))).toBe(true)
  })

  it('never enters the image path for a request that carries no image', async () => {
    await tempHome()
    vi.stubEnv(DEFAULT_API_KEY_ENV, 'ambient-token')
    const gateway = stubGatewayWithoutFilesApi()
    ctx = await mountContext(false)

    const result = await generate(ctx, 'Aeven-1.0-Flash', {
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'no pictures here' }],
        source: { kind: 'plugin', plugin: 'llm-aeven-images-test' },
      })],
    })

    expect(PROVIDER).toBe('aeven-cloud')
    expect(result.finish).toEqual({ kind: 'stop' })
    // One call, and no Files API attempt: the store is resolved per request and
    // only when the conversation actually holds an image.
    expect(gateway.refused).toEqual([])
    expect(gateway.chat).toHaveLength(1)
    expect(gateway.chat[0]?.body.messages).toEqual([{ role: 'user', content: 'no pictures here' }])
  })
})
