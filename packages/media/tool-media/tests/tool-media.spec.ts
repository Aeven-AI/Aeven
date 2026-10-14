import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@aeven/llm'
import SystemPrompt from '@aeven/system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@aeven/tools'
import { MEDIA_SETTINGS_NAMESPACE, VIDEO_SETTINGS_NAMESPACE } from '../src/index.ts'
import { MediaRuntime } from '@aeven/media'
import type { GeneratedImage, MediaImageProvider, MediaImageRequest } from '@aeven/media'
import * as ToolMedia from '@aeven/tool-media'
import { askRequest, choiceFor, choiceLabel, imageBlockRef, modelsText, readReferences, resolveRequest, storable, storeImage } from '../src/index.ts'

const signal = new AbortController().signal

// Both name the registered stub provider: these cases assert the picker, not
// seam selection, which has its own tests.
const CHOICES = [
  { provider: 'stub', model: 'flux-pro', label: 'FLUX Pro', description: 'best' },
  { provider: 'stub', model: 'flux.2-pro' },
]
const PNG = Uint8Array.of(137, 80, 78, 71)
const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0)

/** Record what the seam was asked for, and answer with fixed bytes. */
function imageProvider(
  images: readonly GeneratedImage[] = [{ kind: 'bytes', mediaType: 'image/png', data: PNG }],
): {
  provider: MediaImageProvider
  seen: MediaImageRequest[]
} {
  const seen: MediaImageRequest[] = []
  return {
    seen,
    provider: {
      id: 'stub',
      available: () => true,
      listImageModels: async () => [
        { provider: 'stub', id: 'flux-pro' },
        { provider: 'stub', id: 'live-model', label: 'Live model' },
      ],
      generateImage: async (request) => {
        seen.push(request)
        return { provider: 'stub', model: request.model, images }
      },
    },
  }
}

/**
 * A store that hands back a deterministic reference per saved image.
 * @param stored - extra reference fields to report, such as the dimensions a
 *   store normalized a larger image down from.
 * @returns the seam double, with the saved media types it was handed.
 */
function attachments(
  stored: Record<string, unknown> = {},
): { saved: { mediaType: string }[]; names: (string | undefined)[] } & Record<string, unknown> {
  const saved: { mediaType: string }[] = []
  const names: (string | undefined)[] = []
  let counter = 0
  return {
    saved,
    names,
    imageLimits: { maxImageBytes: 1024, maxImagesPerMessage: 8, maxMessageImageBytes: 4096, maxImageDimension: 4096, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
    saveImage: async (input: { data: Uint8Array; mediaType: string; name?: string }) => {
      saved.push({ mediaType: input.mediaType })
      names.push(input.name)
      return { attachmentId: `att-${++counter}`, mediaType: input.mediaType, bytes: input.data.byteLength, width: 8, height: 8, ...stored }
    },
  }
}

async function mount(opts: {
  config?: ToolMedia.Config
  images?: readonly GeneratedImage[]
  answer?: string | null
  answers?: readonly (string | null)[]
  files?: Record<string, Uint8Array>
  settings?: boolean
  stored?: Record<string, unknown>
} = {}): Promise<{
  commands: { name: string; handler: (invocation: unknown) => Promise<{ kind: string; text?: string }> }[]
  installed: { ns: string; patches: object[]; set: (next: ToolMedia.Config) => void }[]
  asked: unknown[]
  call: (args: unknown) => Promise<ToolExecutionResult>
  seen: MediaImageRequest[]
  store: ReturnType<typeof attachments>
  toolNames: () => string[]
}> {
  const ctx = new Context()
  const asked: unknown[] = []
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const commands: { name: string; handler: (invocation: unknown) => Promise<{ kind: string; text?: string }> }[] = []
  ctx.provide('commands', {
    register: (definition: { name: string; handler: (invocation: unknown) => Promise<{ kind: string; text?: string }> }) => {
      commands.push(definition)
      return () => {}
    },
  })
  const installed: { ns: string; patches: object[]; set: (next: ToolMedia.Config) => void }[] = []
  if (opts.settings === true) {
    ctx.provide('settings', {
      register: (ns: string, _schema: unknown, options: { base: ToolMedia.Config }) => {
        let value = options.base
        const entry = {
          ns,
          patches: [] as object[],
          set: (next: ToolMedia.Config) => { value = next },
        }
        installed.push(entry)
        return {
          get: () => value,
          update: async (patch: object) => {
            entry.patches.push(patch)
            // oxlint-disable-next-line typescript/no-misused-spread -- a settings document
            value = { ...value, ...patch }
          },
        }
      },
    })
  }
  if (opts.answer !== undefined || opts.answers !== undefined) {
    const scripted = opts.answers ?? [opts.answer ?? null]
    let turn = 0
    ctx.provide('userQuestions', {
      ask: async (request: unknown) => {
        asked.push(request)
        const reply = scripted[Math.min(turn, scripted.length - 1)] ?? null
        turn += 1
        return { answers: [{ id: 'image-model', selected: reply === null ? [] : [reply] }] }
      },
    })
  }
  await ctx.plugin(MediaRuntime)
  const store = attachments(opts.stored)
  ctx.provide('attachments', store)
  if (opts.files !== undefined) ctx.provide('fs', fileSystem(opts.files).fs)
  const { provider, seen } = imageProvider(opts.images)
  ctx.media.registerImageProvider(provider)
  await ctx.plugin(ToolMedia, opts.config ?? {})
  let counter = 0
  return {
    commands,
    installed,
    asked,
    seen,
    store,
    /** Every tool the plugin left visible to the model, by name. */
    toolNames: () => ctx.tools.schemas().map(tool => tool.name),
    call: (args: unknown) => ctx.tools.execute({ signal, callId: ToolCallId(`call-${++counter}`), name: 'generate_image', arguments: args }),
  }
}

describe('resolveRequest', () => {
  const references = [{ mediaType: 'image/png', data: PNG }]

  it('maps every model-facing argument onto the seam request under the seam names', () => {
    expect(resolveRequest({
      prompt: 'a red panda', model: 'm', n: 2, size: '1024x1024', background: 'transparent',
    }, { provider: 'aeven' }, references)).toEqual({
      prompt: 'a red panda', model: 'm', provider: 'aeven',
      n: 2, size: '1024x1024', background: 'transparent', references,
    })
  })

  it('falls back to the configured model and provider', () => {
    expect(resolveRequest({ prompt: 'x' }, { model: 'cfg-model', provider: 'cfg-provider' }))
      .toEqual({ prompt: 'x', model: 'cfg-model', provider: 'cfg-provider' })
  })

  it('prefers the called model and serves it from the provider its choice names', () => {
    expect(resolveRequest({ prompt: 'x', model: 'flux.2-pro' }, { model: 'flux-pro', provider: 'cfg-p', choices: CHOICES }))
      .toMatchObject({ model: 'flux.2-pro', provider: 'stub' })
  })

  it('refuses a model outside the configured choices', () => {
    expect(() => resolveRequest({ prompt: 'x', model: 'dall-e' }, { model: 'flux-pro', choices: CHOICES }))
      .toThrow('"dall-e" is not an available image model; use one of flux-pro, flux.2-pro')
  })

  it('omits provider entirely when neither names one, deferring to seam selection', () => {
    expect(resolveRequest({ prompt: 'x', model: 'm' }, {})).toEqual({ prompt: 'x', model: 'm' })
  })

  it.each([undefined, ''])('refuses to build a request with no model named (%o)', (model) => {
    expect(() => resolveRequest({ prompt: 'x', ...model === undefined ? {} : { model } }, {})).toThrow(/no image model named/)
  })
})

/** A filesystem double that resolves every path under `/ws` and serves fixed files. */
function fileSystem(files: Record<string, Uint8Array>): { fs: Context['fs']; resolved: unknown[]; limits: number[] } {
  const resolved: unknown[] = []
  const limits: number[] = []
  return {
    resolved,
    limits,
    fs: {
      resolve: async (path: string, options: unknown) => {
        resolved.push({ path, options })
        return { displayPath: `/ws/${path}` }
      },
      readBytes: async (target: { displayPath: string }, _signal: AbortSignal | undefined, maxBytes: number) => {
        limits.push(maxBytes)
        const data = files[target.displayPath]
        if (data === undefined) throw new Error(`cannot read "${target.displayPath}": not found`)
        return data
      },
    } as unknown as Context['fs'],
  }
}

describe('readReferences', () => {
  it('reads each path through the filesystem in order, under the call cwd, labelling it by its bytes', async () => {
    const { fs, resolved, limits } = fileSystem({ '/ws/a.png': PNG, '/ws/b.jpg': JPEG })
    expect(await readReferences(fs, ['a.png', 'b.jpg'], { cwd: '/ws', signal }, 100)).toEqual([
      { mediaType: 'image/png', data: PNG },
      { mediaType: 'image/jpeg', data: JPEG },
    ])
    expect(resolved).toEqual([
      { path: 'a.png', options: { cwd: '/ws', signal } },
      { path: 'b.jpg', options: { cwd: '/ws', signal } },
    ])
    expect(limits).toEqual([100, 100])
  })

  it('resolves without a cwd or signal when the call has none', async () => {
    const { fs, resolved } = fileSystem({ '/ws/a.png': PNG })
    await readReferences(fs, ['a.png'], { cwd: undefined, signal: undefined }, 100)
    expect(resolved).toEqual([{ path: 'a.png', options: {} }])
  })

  it('reads nothing, and needs no filesystem, when the call names no reference', async () => {
    expect(await readReferences(undefined, [], { cwd: undefined, signal: undefined }, 100)).toEqual([])
  })

  it('refuses references where no filesystem is mounted', async () => {
    await expect(readReferences(undefined, ['a.png'], { cwd: undefined, signal: undefined }, 100))
      .rejects.toThrow('reference_images needs a filesystem, and none is mounted')
  })

  it('refuses a file that is not a supported image, naming it', async () => {
    const { fs } = fileSystem({ '/ws/notes.txt': new TextEncoder().encode('hello') })
    await expect(readReferences(fs, ['notes.txt'], { cwd: undefined, signal: undefined }, 100))
      .rejects.toThrow('reference image "/ws/notes.txt" is not a PNG, JPEG, WebP, or GIF image')
  })
})

describe('modelsText', () => {
  it('names every choice, marks the default, and carries each description', () => {
    expect(modelsText({ model: 'flux-pro', choices: CHOICES }))
      .toBe(' Available models: flux-pro (default) — best; flux.2-pro.')
  })

  it('adds nothing where no choices are configured', () => {
    expect(modelsText({ model: 'm' })).toBe('')
  })
})

describe('storable', () => {
  it.each(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])('accepts %s', (mediaType) => {
    expect(storable(mediaType, PNG)).toEqual({ mediaType, data: PNG })
  })

  it.each(['application/octet-stream', 'image/svg+xml'])('refuses %s by name', (mediaType) => {
    expect(() => storable(mediaType, PNG)).toThrow(new RegExp(`"${mediaType.replace('+', '\\+')}" cannot be stored`))
  })
})

const REF = { attachmentId: 'att-9', mediaType: 'image/png', bytes: 4, width: 8, height: 8 } as never

describe('storeImage', () => {
  it('stores bytes a provider could not store itself', async () => {
    const saved: unknown[] = []
    const ref = await storeImage({ kind: 'bytes', mediaType: 'image/png', data: PNG }, async (input) => {
      saved.push(input)
      return REF
    })
    expect(saved).toEqual([{ mediaType: 'image/png', data: PNG }])
    expect(ref).toBe(REF)
  })

  it('uses a provider-stored reference as-is, never re-storing the same bytes', async () => {
    let calls = 0
    const ref = await storeImage({ kind: 'attachment', attachment: REF }, async () => {
      calls += 1
      return REF
    })
    expect(calls).toBe(0)
    expect(ref).toBe(REF)
  })

  it('refuses an image kind this build does not know', async () => {
    await expect(storeImage({ kind: 'sculpture' } as never, async () => REF))
      .rejects.toThrow(/unsupported generated image kind "sculpture"/)
  })
})

describe('imageBlockRef', () => {
  it('restores the branded reference the output schema flattened to strings', () => {
    expect(imageBlockRef({ attachmentId: 'att-1', mediaType: 'image/png', bytes: 4, width: 8, height: 8 }))
      .toEqual({ attachmentId: 'att-1', mediaType: 'image/png', bytes: 4, width: 8, height: 8 })
  })
})


describe('choice labels', () => {
  it('labels a choice by its own label, falling back to provider/model', () => {
    expect(choiceLabel(CHOICES[0]!)).toBe('FLUX Pro')
    expect(choiceLabel(CHOICES[1]!)).toBe('stub/flux.2-pro')
  })

  it('matches a selected label back to its choice, and nothing for an unknown one', () => {
    expect(choiceFor(CHOICES, 'FLUX Pro')).toBe(CHOICES[0])
    expect(choiceFor(CHOICES, 'stub/flux.2-pro')).toBe(CHOICES[1])
    expect(choiceFor(CHOICES, 'something else')).toBeUndefined()
    expect(choiceFor(CHOICES, undefined)).toBeUndefined()
  })
})

describe('askRequest', () => {
  it('names the live agent when the execution carries one', () => {
    const agent = { id: 'agent-1' } as never
    expect(askRequest(CHOICES, 'x', { agent, signal })).toMatchObject({ agent })
  })

  it('names no agent for a run outside a session, which ask() would refuse', () => {
    expect(askRequest(CHOICES, 'x', { signal })).not.toHaveProperty('agent')
  })
})

describe('the model picker', () => {
  it('asks before generating, and generates with what the user picked', async () => {
    const { call, seen, asked } = await mount({
      config: { model: 'flux-pro', provider: 'deepinfra', choices: CHOICES, confirmModel: true },
      answer: 'stub/flux.2-pro',
    })
    await call({ prompt: 'a lighthouse' })
    expect(asked).toHaveLength(1)
    expect(seen[0]).toMatchObject({ model: 'flux.2-pro', provider: 'stub' })
  })

  it('offers every choice as a labelled option and shows the prompt as detail', async () => {
    const { call, asked } = await mount({
      config: { choices: CHOICES, confirmModel: true, model: 'flux-pro' },
      answer: 'FLUX Pro',
    })
    await call({ prompt: 'a lighthouse' })
    expect(asked[0]).toMatchObject({
      questions: [{
        id: 'image-model',
        detail: 'a lighthouse',
        options: [
          { label: 'FLUX Pro', description: 'best' },
          { label: 'stub/flux.2-pro' },
        ],
      }],
    })
  })

  it('leads the menu with a model the call named, so accepting it is one click', async () => {
    const { call, asked } = await mount({
      config: { choices: CHOICES, confirmModel: true, model: 'flux-pro' },
      answer: 'stub/flux.2-pro',
    })
    await call({ prompt: 'x', model: 'flux.2-pro' })
    expect((asked[0] as { questions: { options: { label: string }[] }[] }).questions[0]!.options[0])
      .toMatchObject({ label: 'stub/flux.2-pro' })
  })

  it('keeps the configured model when the answer names no offered option', async () => {
    const { call, seen } = await mount({
      config: { model: 'flux-pro', provider: 'stub', choices: CHOICES, confirmModel: true },
      answer: null,
    })
    await call({ prompt: 'x' })
    expect(seen[0]).toMatchObject({ model: 'flux-pro', provider: 'stub' })
  })

  it.each([
    ['the picker is switched off', { model: 'flux-pro', choices: CHOICES, confirmModel: false }],
    ['no choice is offered', { model: 'flux-pro', choices: [], confirmModel: true }],
  ])('does not ask when %s', async (_case, config) => {
    const { call, seen, asked } = await mount({ config, answer: 'FLUX Pro' })
    await call({ prompt: 'x' })
    expect(asked).toHaveLength(0)
    expect(seen[0]).toMatchObject({ model: 'flux-pro' })
  })

  it('generates with the configured model where no UI is mounted to answer', async () => {
    const { call, seen } = await mount({
      config: { model: 'flux-pro', choices: CHOICES, confirmModel: true },
    })
    await call({ prompt: 'x' })
    expect(seen[0]).toMatchObject({ model: 'flux-pro' })
  })
})

describe('listed providers', () => {
  it('offers a listed provider’s live models after the configured choices', async () => {
    const { call, seen, asked } = await mount({
      config: { choices: CHOICES, listedProviders: ['stub'], confirmModel: true, model: 'flux-pro' },
      answer: 'Live model',
    })
    await call({ prompt: 'a lighthouse' })
    expect(asked[0]).toMatchObject({
      questions: [{ options: [{ label: 'FLUX Pro' }, { label: 'stub/flux.2-pro' }, { label: 'Live model' }] }],
    })
    expect(seen[0]).toMatchObject({ model: 'live-model', provider: 'stub' })
  })

  it('refuses a live model whose provider is not listed', async () => {
    const { call, seen } = await mount({ config: { choices: CHOICES, confirmModel: false, model: 'flux-pro' } })
    const result = await call({ prompt: 'a lighthouse', model: 'live-model' })
    expect(JSON.stringify(result)).toContain('not an available image model')
    expect(seen).toHaveLength(0)
  })
})

describe('live settings', () => {
  it('serves both namespaces and generates with the edited document, not the mounted one', async () => {
    const { call, seen, installed, toolNames } = await mount({
      config: { model: 'flux-pro', provider: 'stub' },
      settings: true,
    })
    // Divergence: `src/index.ts:113`/`:135` and `README.md:12`/`:35` say the video
    // half exists only where `video` is configured, and the 2026-10-08
    // video-generation Agent Note repeats it, but `Config.video` is the nested
    // `VideoConfig` (`:179`) which schemastery always materializes, so the gate at
    // `:902` never closes.
    expect(installed.map(entry => entry.ns)).toEqual([MEDIA_SETTINGS_NAMESPACE, VIDEO_SETTINGS_NAMESPACE])
    expect(toolNames().sort()).toEqual(['generate_image', 'generate_video'])
    installed[0]!.set({ model: 'edited-model', provider: 'stub' })
    await call({ prompt: 'x' })
    expect(seen[0]).toMatchObject({ model: 'edited-model' })
  })
})

describe('asking exactly once', () => {
  it('asks while no choice is stored, and persists the answer', async () => {
    const { call, asked, installed, seen } = await mount({
      config: { model: 'flux-pro', provider: 'stub', choices: CHOICES, confirmModel: true },
      answer: 'stub/flux.2-pro',
      settings: true,
    })
    await call({ prompt: 'x' })
    expect(asked).toHaveLength(1)
    expect(installed[0]!.patches).toEqual([{ provider: 'stub', model: 'flux.2-pro', modelChosen: true }])
    expect(seen[0]).toMatchObject({ model: 'flux.2-pro' })
  })

  it('never asks again once a choice is stored', async () => {
    const { call, asked, seen } = await mount({
      config: { model: 'flux.2-pro', provider: 'stub', choices: CHOICES, confirmModel: true, modelChosen: true },
      answer: 'FLUX Pro',
      settings: true,
    })
    await call({ prompt: 'x' })
    expect(asked).toHaveLength(0)
    expect(seen[0]).toMatchObject({ model: 'flux.2-pro' })
  })

  it('stores nothing when the answer names no offered option, so the next call asks again', async () => {
    const { call, installed } = await mount({
      config: { model: 'flux-pro', provider: 'stub', choices: CHOICES, confirmModel: true },
      answer: null,
      settings: true,
    })
    await call({ prompt: 'x' })
    expect(installed[0]!.patches).toEqual([])
  })
})

describe('the /image-model command', () => {
  const bare = { agent: undefined, signal, rawInput: '' } as never
  const argued = (input: string) => ({ agent: undefined, signal, rawInput: ` ${input}` } as never)

  it('is registered so a stored choice stays changeable', async () => {
    const { commands } = await mount({ config: { model: 'm', provider: 'stub', choices: CHOICES } })
    // Divergence: the video half registers its own `/<kind>-model` re-open even
    // with no `video` in config, for the same reason the `media-video` document
    // exists — see the divergence note in `live settings`.
    expect(commands.map(c => c.name)).toEqual(['image-model', 'video-model'])
  })

  it('re-opens the picker even though a choice is already stored, and persists the new one', async () => {
    const { commands, asked, installed } = await mount({
      config: { model: 'flux-pro', provider: 'stub', choices: CHOICES, confirmModel: true, modelChosen: true },
      answer: 'stub/flux.2-pro',
      settings: true,
    })
    const result = await commands[0]!.handler(bare)
    expect(asked).toHaveLength(1)
    expect(installed[0]!.patches).toEqual([{ provider: 'stub', model: 'flux.2-pro', modelChosen: true }])
    expect(result).toEqual({ kind: 'success', text: 'Image model set to flux.2-pro.' })
  })

  it('reports the model unchanged when the picker is dismissed', async () => {
    const { commands } = await mount({
      config: { model: 'flux-pro', provider: 'stub', choices: CHOICES, confirmModel: true, modelChosen: true },
      answer: null,
      settings: true,
    })
    expect(await commands[0]!.handler(bare))
      .toEqual({ kind: 'success', text: 'Image model unchanged: flux-pro.' })
  })

  it('reports an error where nothing can be chosen', async () => {
    const { commands } = await mount({ config: { choices: [] } })
    expect(await commands[0]!.handler(bare)).toMatchObject({ kind: 'error' })
  })

  it('stores the model an argued line names, without asking', async () => {
    const { commands, asked, installed } = await mount({
      config: { model: 'flux-pro', provider: 'stub', choices: CHOICES, confirmModel: true },
      settings: true,
    })
    expect(await commands[0]!.handler(argued('stub/flux.2-pro')))
      .toEqual({ kind: 'success', text: 'Image model set to flux.2-pro.' })
    expect(asked).toEqual([])
    expect(installed[0]!.patches).toEqual([{ provider: 'stub', model: 'flux.2-pro', modelChosen: true }])
  })

  it('accepts a bare model id that exactly one offered choice carries', async () => {
    const { commands, installed } = await mount({
      config: { model: 'flux-pro', provider: 'stub', choices: CHOICES, confirmModel: true },
      settings: true,
    })
    expect(await commands[0]!.handler(argued('flux.2-pro')))
      .toEqual({ kind: 'success', text: 'Image model set to flux.2-pro.' })
    expect(installed[0]!.patches).toEqual([{ provider: 'stub', model: 'flux.2-pro', modelChosen: true }])
  })

  it('reaches a listed provider’s live model by the pair a picker row carries', async () => {
    const { commands, installed } = await mount({
      config: { model: 'flux-pro', provider: 'stub', choices: CHOICES, listedProviders: ['stub'], confirmModel: false },
      settings: true,
    })
    expect(await commands[0]!.handler(argued('stub/live-model')))
      .toEqual({ kind: 'success', text: 'Image model set to live-model.' })
    expect(installed[0]!.patches).toEqual([{ provider: 'stub', model: 'live-model', modelChosen: true }])
  })

  it('refuses a name no offered choice carries, and stores nothing', async () => {
    const { commands, installed } = await mount({
      config: { model: 'flux-pro', provider: 'stub', choices: CHOICES },
      settings: true,
    })
    expect(await commands[0]!.handler(argued('dall-e'))).toEqual({
      kind: 'error',
      text: '"dall-e" is not an available image model; use one of stub/flux-pro, stub/flux.2-pro',
    })
    expect(installed[0]!.patches).toEqual([])
  })

  it('refuses a bare model id two providers serve, naming the pair that resolves it', async () => {
    const twice = [{ provider: 'stub', model: 'shared' }, { provider: 'other', model: 'shared' }]
    const { commands, installed } = await mount({
      config: { choices: twice, provider: 'stub', model: 'shared' },
      settings: true,
    })
    expect(await commands[0]!.handler(argued('shared'))).toEqual({
      kind: 'error',
      text: '"shared" is served by more than one provider; name one as stub/shared or other/shared',
    })
    expect(installed[0]!.patches).toEqual([])
    expect(await commands[0]!.handler(argued('other/shared')))
      .toEqual({ kind: 'success', text: 'Image model set to shared.' })
    expect(installed[0]!.patches).toEqual([{ provider: 'other', model: 'shared', modelChosen: true }])
  })
})

describe('generate_image', () => {
  it('stores the generated bytes and renders them as image blocks beside the summary', async () => {
    const { call, seen, store } = await mount({ config: { model: 'flux' } })
    const out = await call({ prompt: 'a red panda astronaut' })
    expect(seen[0]).toEqual({ prompt: 'a red panda astronaut', model: 'flux' })
    expect(store.saved).toEqual([{ mediaType: 'image/png' }])
    expect(out.value).toEqual({
      provider: 'stub',
      model: 'flux',
      label: 'flux',
      images: [{ attachmentId: 'att-1', mediaType: 'image/png', bytes: 4, width: 8, height: 8 }],
    })
    expect(out.content[0]).toEqual({ type: 'text', text: 'Generated 1 image(s) with flux. Already displayed to the user; do not repeat or embed them in your reply.' })
    expect(out.content[1]).toMatchObject({ type: 'image', attachment: { attachmentId: 'att-1' } })
  })

  it('names each stored image after its model and position, so a preview titles it', async () => {
    const { call, store } = await mount({
      config: { model: 'flux' },
      images: [{ kind: 'bytes', mediaType: 'image/png', data: PNG }, { kind: 'bytes', mediaType: 'image/jpeg', data: PNG }],
    })
    await call({ prompt: 'two of them', n: 2 })
    expect(store.names).toEqual(['flux-1.png', 'flux-2.jpg'])
  })

  it('stores every image a multi-image generation returned, in provider order', async () => {
    const { call, store } = await mount({
      config: { model: 'flux' },
      images: [{ kind: 'bytes', mediaType: 'image/png', data: PNG }, { kind: 'bytes', mediaType: 'image/jpeg', data: PNG }],
    })
    const out = await call({ prompt: 'two of them', n: 2 })
    expect(store.saved).toEqual([{ mediaType: 'image/png' }, { mediaType: 'image/jpeg' }])
    expect(out.content).toHaveLength(3)
    expect(out.content[0]).toEqual({ type: 'text', text: 'Generated 2 image(s) with flux. Already displayed to the user; do not repeat or embed them in your reply.' })
  })

  it('carries a provider-stored image straight into the result without re-storing it', async () => {
    const { call, store } = await mount({
      config: { model: 'm', provider: 'stub' },
      images: [{ kind: 'attachment', attachment: REF }],
    })
    const out = await call({ prompt: 'x' })
    expect(store.saved).toEqual([])
    expect(out.content[1]).toMatchObject({ type: 'image', attachment: { attachmentId: 'att-9' } })
  })

  it('carries the dimensions a store reports for an image it scaled down', async () => {
    const { call } = await mount({
      config: { model: 'flux' },
      stored: { originalDimensions: { width: 4096, height: 2048 } },
    })
    const out = await call({ prompt: 'a wide valley' })
    expect(out.isError).not.toBe(true)
    expect(out.value).toEqual({
      provider: 'stub',
      model: 'flux',
      label: 'flux',
      images: [{
        attachmentId: 'att-1',
        mediaType: 'image/png',
        bytes: 4,
        width: 8,
        height: 8,
        originalDimensions: { width: 4096, height: 2048 },
      }],
    })
    expect(out.content[1]).toMatchObject({ type: 'image', attachment: { attachmentId: 'att-1' } })
  })

  it('carries a provider-stored reference that names itself', async () => {
    const named = { attachmentId: 'att-9', mediaType: 'image/png', bytes: 4, width: 8, height: 8, name: 'render.png' } as never
    const { call } = await mount({
      config: { model: 'm', provider: 'stub' },
      images: [{ kind: 'attachment', attachment: named }],
    })
    const out = await call({ prompt: 'x' })
    expect(out.isError).not.toBe(true)
    expect(out.value).toMatchObject({ images: [named] })
  })

  it('reports an unstorable generated media type as a tool error', async () => {
    const { call } = await mount({ config: { model: 'flux' }, images: [{ kind: 'bytes', mediaType: 'image/svg+xml', data: PNG }] })
    const out = await call({ prompt: 'vector art' })
    expect(out.isError).toBe(true)
  })

  it('reads the named reference images and passes them, with the background, to the seam', async () => {
    const { call, seen } = await mount({ config: { model: 'flux' }, files: { '/ws/logo.png': PNG } })
    const out = await call({ prompt: 'put the logo on a mug', reference_images: ['logo.png'], background: 'opaque' })
    expect(out.isError).not.toBe(true)
    expect(seen[0]).toEqual({
      prompt: 'put the logo on a mug',
      model: 'flux',
      background: 'opaque',
      references: [{ mediaType: 'image/png', data: PNG }],
    })
  })

  it('refuses a model outside the choices before any generation', async () => {
    const { call, seen } = await mount({ config: { model: 'flux-pro', choices: CHOICES, confirmModel: false } })
    const out = await call({ prompt: 'x', model: 'dall-e' })
    expect(out.isError).toBe(true)
    expect(seen).toEqual([])
  })

  it('names the selectable models and the default in its description', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(MediaRuntime)
    ctx.provide('attachments', attachments())
    await ctx.plugin(ToolMedia, { model: 'flux-pro', choices: CHOICES })
    expect(ctx.tools.get('generate_image')?.description)
      .toMatch(/Available models: flux-pro \(default\) — best; flux\.2-pro\.$/)
  })

  it('leaves a call\'s image count to the chosen model, and names the recovery for more', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(MediaRuntime)
    ctx.provide('attachments', attachments())
    await ctx.plugin(ToolMedia, { model: 'flux-pro', choices: CHOICES })
    // The count is per model and the choice's own text states it, so the tool
    // states no number of its own and names what a larger request does instead.
    expect(ctx.tools.get('generate_image')?.description)
      .toContain("no more images in one call than the chosen model's description allows; for more images, make another call")
    const argumentsSchema = ctx.tools.get('generate_image')?.parameters as
      { properties: Record<string, { description?: string }> }
    expect(argumentsSchema.properties['n']?.description)
      .toBe("How many images to generate, at most the count the chosen model's description states. Omit for one.")
  })

  it('reports a call that names no model and has no configured default', async () => {
    const { call } = await mount()
    const out = await call({ prompt: 'x' })
    expect(out.isError).toBe(true)
  })
})
