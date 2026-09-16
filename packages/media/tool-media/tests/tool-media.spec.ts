import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@aeven/llm'
import SystemPrompt from '@aeven/system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@aeven/tools'
import { MEDIA_SETTINGS_NAMESPACE } from '../src/index.ts'
import { MediaRuntime } from '@aeven/media'
import type { GeneratedImage, MediaImageProvider, MediaImageRequest } from '@aeven/media'
import * as ToolMedia from '@aeven/tool-media'
import { askRequest, catalogChoices, choiceFor, choiceLabel, imageBlockRef, OTHER_MODEL_LABEL, resolveRequest, storable, storeImage } from '../src/index.ts'

const signal = new AbortController().signal
const PNG = Uint8Array.of(137, 80, 78, 71)

/** Record what the seam was asked for, and answer with fixed bytes. */
function imageProvider(
  images: readonly GeneratedImage[] = [{ kind: 'bytes', mediaType: 'image/png', data: PNG }],
  catalog: readonly { provider: string; id: string; label?: string }[] = [
    { provider: 'stub', id: 'catalog-a', label: 'Catalog A' },
    { provider: 'stub', id: 'catalog-b' },
  ],
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
      generateImage: async (request) => {
        seen.push(request)
        return { provider: 'stub', model: request.model, images }
      },
      listImageModels: async () => catalog,
    },
  }
}

/** A store that hands back a deterministic reference per saved image. */
function attachments(): { saved: { mediaType: string }[] } & Record<string, unknown> {
  const saved: { mediaType: string }[] = []
  let counter = 0
  return {
    saved,
    imageLimits: { maxImageBytes: 1024, maxImagesPerMessage: 8, maxMessageImageBytes: 4096, maxImageDimension: 4096, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
    saveImage: async (input: { data: Uint8Array; mediaType: string }) => {
      saved.push({ mediaType: input.mediaType })
      return { attachmentId: `att-${++counter}`, mediaType: input.mediaType, bytes: input.data.byteLength, width: 8, height: 8 }
    },
  }
}

async function mount(opts: {
  config?: ToolMedia.Config
  images?: readonly GeneratedImage[]
  answer?: string | null
  answers?: readonly (string | null)[]
  emptyCatalog?: boolean
  settings?: boolean
} = {}): Promise<{
  commands: { name: string; handler: (invocation: unknown) => Promise<{ kind: string; text?: string }> }[]
  installed: { ns: string; patches: object[]; set: (next: ToolMedia.Config) => void }[]
  asked: unknown[]
  call: (args: unknown) => Promise<ToolExecutionResult>
  seen: MediaImageRequest[]
  store: ReturnType<typeof attachments>
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
  const store = attachments()
  ctx.provide('attachments', store)
  const { provider, seen } = imageProvider(opts.images, opts.emptyCatalog === true ? [] : undefined)
  ctx.media.registerImageProvider(provider)
  await ctx.plugin(ToolMedia, opts.config ?? {})
  let counter = 0
  return {
    commands,
    installed,
    asked,
    seen,
    store,
    call: (args: unknown) => ctx.tools.execute({ signal, callId: ToolCallId(`call-${++counter}`), name: 'generate_image', arguments: args }),
  }
}

describe('resolveRequest', () => {
  it('maps every model-facing argument onto the seam request under the seam names', () => {
    expect(resolveRequest({
      prompt: 'a red panda', model: 'm', provider: 'openrouter',
      n: 2, aspect_ratio: '16:9', resolution: '2K', size: '1024x1024', seed: 4,
    }, {})).toEqual({
      prompt: 'a red panda', model: 'm', provider: 'openrouter',
      n: 2, aspectRatio: '16:9', resolution: '2K', size: '1024x1024', seed: 4,
    })
  })

  it('falls back to the configured model and provider', () => {
    expect(resolveRequest({ prompt: 'x' }, { model: 'cfg-model', provider: 'cfg-provider' }))
      .toEqual({ prompt: 'x', model: 'cfg-model', provider: 'cfg-provider' })
  })

  it('prefers the call over the configuration', () => {
    expect(resolveRequest({ prompt: 'x', model: 'arg', provider: 'arg-p' }, { model: 'cfg', provider: 'cfg-p' }))
      .toMatchObject({ model: 'arg', provider: 'arg-p' })
  })

  it('omits provider entirely when neither names one, deferring to seam selection', () => {
    expect(resolveRequest({ prompt: 'x', model: 'm' }, {})).toEqual({ prompt: 'x', model: 'm' })
  })

  it.each([undefined, ''])('refuses to build a request with no model named (%o)', (model) => {
    expect(() => resolveRequest({ prompt: 'x', ...model === undefined ? {} : { model } }, {})).toThrow(/no image model named/)
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


// Both name the registered stub provider: these cases assert the picker, not
// seam selection, which has its own tests.
const CHOICES = [
  { provider: 'stub', model: 'flux-pro', label: 'FLUX Pro', description: 'best' },
  { provider: 'stub', model: 'flux.2-pro' },
]

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
          { label: OTHER_MODEL_LABEL },
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

describe('live settings', () => {
  it('serves the media namespace and generates with the edited document, not the mounted one', async () => {
    const { call, seen, installed } = await mount({
      config: { model: 'flux-pro', provider: 'stub' },
      settings: true,
    })
    expect(installed.map(entry => entry.ns)).toEqual([MEDIA_SETTINGS_NAMESPACE])
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
      config: { model: 'chosen', provider: 'stub', choices: CHOICES, confirmModel: true, modelChosen: true },
      answer: 'FLUX Pro',
      settings: true,
    })
    await call({ prompt: 'x' })
    expect(asked).toHaveLength(0)
    expect(seen[0]).toMatchObject({ model: 'chosen' })
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

  it('persists a model picked from the full catalog too', async () => {
    const { call, installed } = await mount({
      config: { model: 'flux-pro', provider: 'stub', choices: CHOICES, confirmModel: true },
      answers: [OTHER_MODEL_LABEL, 'Catalog A (stub)'],
      settings: true,
    })
    await call({ prompt: 'x' })
    expect(installed[0]!.patches).toEqual([{ provider: 'stub', model: 'catalog-a', modelChosen: true }])
  })
})

describe('catalogChoices', () => {
  it('labels a catalog entry by its name and provider, or by provider/id when unnamed', () => {
    expect(catalogChoices([
      { provider: 'openrouter', id: 'x/y', label: 'Nice Model', description: 'd' },
      { provider: 'deepinfra', id: 'a/b' },
    ])).toEqual([
      { provider: 'openrouter', model: 'x/y', label: 'Nice Model (openrouter)', description: 'd' },
      { provider: 'deepinfra', model: 'a/b', label: 'deepinfra/a/b' },
    ])
  })
})

describe('the every-model escape hatch', () => {
  it('asks again over the published catalog and generates with the pick', async () => {
    const { call, seen, asked } = await mount({
      config: { model: 'flux-pro', provider: 'stub', choices: CHOICES, confirmModel: true },
      answers: [OTHER_MODEL_LABEL, 'Catalog A (stub)'],
    })
    await call({ prompt: 'x' })
    expect(asked).toHaveLength(2)
    expect(seen[0]).toMatchObject({ model: 'catalog-a', provider: 'stub' })
  })

  it('offers no further escape hatch in the catalog menu itself', async () => {
    const { call, asked } = await mount({
      config: { model: 'flux-pro', provider: 'stub', choices: CHOICES, confirmModel: true },
      answers: [OTHER_MODEL_LABEL, 'Catalog A (stub)'],
    })
    await call({ prompt: 'x' })
    const second = asked[1] as { questions: { options: { label: string }[] }[] }
    expect(second.questions[0]!.options.map(o => o.label)).toEqual(['Catalog A (stub)', 'stub/catalog-b'])
  })

  it('keeps the configured model when no provider publishes a catalog', async () => {
    const { call, seen, asked } = await mount({
      config: { model: 'flux-pro', provider: 'stub', choices: CHOICES, confirmModel: true },
      answers: [OTHER_MODEL_LABEL],
      emptyCatalog: true,
    })
    await call({ prompt: 'x' })
    expect(asked).toHaveLength(1)
    expect(seen[0]).toMatchObject({ model: 'flux-pro' })
  })

  it('keeps the configured model when the catalog answer names no option', async () => {
    const { call, seen } = await mount({
      config: { model: 'flux-pro', provider: 'stub', choices: CHOICES, confirmModel: true },
      answers: [OTHER_MODEL_LABEL, null],
    })
    await call({ prompt: 'x' })
    expect(seen[0]).toMatchObject({ model: 'flux-pro' })
  })
})

describe('the /image-model command', () => {
  const invocation = { agent: undefined, signal } as never

  it('is registered so a stored choice stays changeable', async () => {
    const { commands } = await mount({ config: { model: 'm', provider: 'stub', choices: CHOICES } })
    expect(commands.map(c => c.name)).toEqual(['image-model'])
  })

  it('re-opens the picker even though a choice is already stored, and persists the new one', async () => {
    const { commands, asked, installed } = await mount({
      config: { model: 'flux-pro', provider: 'stub', choices: CHOICES, confirmModel: true, modelChosen: true },
      answer: 'stub/flux.2-pro',
      settings: true,
    })
    const result = await commands[0]!.handler(invocation)
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
    expect(await commands[0]!.handler(invocation))
      .toEqual({ kind: 'success', text: 'Image model unchanged: flux-pro.' })
  })

  it('reports an error where nothing can be chosen', async () => {
    const { commands } = await mount({ config: { choices: [] } })
    expect(await commands[0]!.handler(invocation)).toMatchObject({ kind: 'error' })
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
      images: [{ attachmentId: 'att-1', mediaType: 'image/png', bytes: 4, width: 8, height: 8 }],
    })
    expect(out.content[0]).toEqual({ type: 'text', text: 'Generated 1 image(s) with flux via stub.' })
    expect(out.content[1]).toMatchObject({ type: 'image', attachment: { attachmentId: 'att-1' } })
  })

  it('stores every image a multi-image generation returned, in provider order', async () => {
    const { call, store } = await mount({
      config: { model: 'flux' },
      images: [{ kind: 'bytes', mediaType: 'image/png', data: PNG }, { kind: 'bytes', mediaType: 'image/jpeg', data: PNG }],
    })
    const out = await call({ prompt: 'two of them', n: 2 })
    expect(store.saved).toEqual([{ mediaType: 'image/png' }, { mediaType: 'image/jpeg' }])
    expect(out.content).toHaveLength(3)
    expect(out.content[0]).toEqual({ type: 'text', text: 'Generated 2 image(s) with flux via stub.' })
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

  it('reports an unstorable generated media type as a tool error', async () => {
    const { call } = await mount({ config: { model: 'flux' }, images: [{ kind: 'bytes', mediaType: 'image/svg+xml', data: PNG }] })
    const out = await call({ prompt: 'vector art' })
    expect(out.isError).toBe(true)
  })

  it('reports a call that names no model and has no configured default', async () => {
    const { call } = await mount()
    const out = await call({ prompt: 'x' })
    expect(out.isError).toBe(true)
  })
})
