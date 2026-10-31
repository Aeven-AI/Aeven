/** The Edge provider: discovery, catalogue merge, streaming synthesis, cancellation, and teardown. */
import { Context } from '@deepseek-ai/cordis'
import TextToSpeech from '@aeven/text-to-speech'
import type { TtsVoiceId } from '@aeven/text-to-speech/types'
import { afterEach, expect, it, vi } from 'vitest'
import * as edgePlugin from '../src/index.ts'
import type { Config, VoiceConfig } from '../src/config.ts'

const edge = vi.hoisted(() => {
  interface Listed {
    ShortName: string
    Locale: string
    Gender?: string
  }
  const empty = async function* (): AsyncIterable<Uint8Array> {}
  const state = {
    /** What the service's voice listing answers. */
    listed: [] as Listed[],
    /** Set to fail the voice listing. */
    listError: undefined as Error | undefined,
    /** Set to hold the voice listing until the test settles it. */
    listGate: undefined as Promise<void> | undefined,
    /** Set to fail opening one voice. */
    metadataError: undefined as Error | undefined,
    /** Audio chunks per utterance, keyed by the text asked for. */
    streams: new Map<string, () => AsyncIterable<Uint8Array>>(),
    /** Audio chunks for every utterance no entry names. */
    fallbackStream: empty as () => AsyncIterable<Uint8Array>,
  }
  class MsEdgeTTS {
    static readonly instances: MsEdgeTTS[] = []
    voiceName = ''
    format: string | undefined
    closed = 0
    constructor(readonly options: { synthesisTimeoutMs?: number }) {
      MsEdgeTTS.instances.push(this)
    }
    async getVoices(): Promise<Listed[]> {
      if (state.listGate !== undefined) await state.listGate
      if (state.listError !== undefined) throw state.listError
      return state.listed
    }
    async setMetadata(voiceName: string, format: string): Promise<void> {
      if (state.metadataError !== undefined) throw state.metadataError
      this.voiceName = voiceName
      this.format = format
    }
    toStream(text: string): { audioStream: AsyncIterable<Uint8Array> } {
      return { audioStream: (state.streams.get(text) ?? state.fallbackStream)() }
    }
    close(): void {
      this.closed++
    }
  }
  return {
    state,
    MsEdgeTTS,
    OUTPUT_FORMAT: { AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'audio-24khz-48kbitrate-mono-mp3' },
  }
})

vi.mock('../src/edge-tts.ts', () => ({ MsEdgeTTS: edge.MsEdgeTTS, OUTPUT_FORMAT: edge.OUTPUT_FORMAT }))

const roots: Context[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => root.fiber.dispose()))
  edge.state.listed = []
  edge.state.listError = undefined
  edge.state.listGate = undefined
  edge.state.metadataError = undefined
  edge.state.streams.clear()
  edge.state.fallbackStream = async function* () {}
  edge.MsEdgeTTS.instances.length = 0
})

const sonia: VoiceConfig = { id: 'en-GB-SoniaNeural', name: 'Sonia', language: 'en', gender: 'female' }

/** Mount the real registry and the Edge provider over the mocked service. */
async function mounted(config: Partial<Config> & { voices: VoiceConfig[] }) {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(TextToSpeech, { voiceByLanguage: {} })
  const fiber = ctx.plugin(edgePlugin, { providerId: 'edge', locales: [], timeoutMs: 1000, ...config })
  await fiber
  await published(ctx)
  return { ctx, fiber, tts: ctx.get('textToSpeech')! }
}

/** Wait until the provider's asynchronous discovery publishes its registration. */
async function published(ctx: Context): Promise<void> {
  await vi.waitFor(() => { expect(ctx.get('textToSpeech')!.listProviders()).toHaveLength(1) })
}

function streamOf(...chunks: readonly Uint8Array[]): () => AsyncIterable<Uint8Array> {
  return async function* () { for (const chunk of chunks) yield chunk }
}

/** Utterance text whose audio the test controls, held open until `release` runs. */
function heldStream(): { stream: () => AsyncIterable<Uint8Array>; release: () => void } {
  let open!: () => void
  const gate = new Promise<void>((resolve) => { open = resolve })
  return {
    stream: async function* () { yield Buffer.from('ab'); await gate; yield Buffer.from('cd') },
    release: open,
  }
}

it('exports the function plugin shape the Loader mounts', () => {
  expect('default' in edgePlugin).toBe(false)
  expect(edgePlugin.name).toBe('text-to-speech-edge')
  expect(edgePlugin.inject).toEqual(['textToSpeech'])
})

it('registers Edge voices for the configured locales alongside the configured ones', async () => {
  edge.state.listed = [
    { ShortName: 'nl-NL-FennaNeural', Locale: 'nl-NL', Gender: 'Female' },
    { ShortName: 'nl-BE-DenaNeural', Locale: 'nl-BE', Gender: 'Female' },
    { ShortName: 'en-US-AvaNeural', Locale: 'en-US', Gender: 'Female' },
  ]
  const { tts } = await mounted({ locales: ['nl-NL'], providerId: 'edge-cloud', voices: [sonia] })
  expect(tts.listProviders()).toEqual([{ id: 'edge-cloud', name: 'Microsoft Edge', location: 'cloud' }])
  expect(tts.catalog().voices).toEqual([
    { id: 'nl-NL-FennaNeural', name: 'Fenna', language: 'nl', gender: 'female', providerId: 'edge-cloud', providerName: 'Microsoft Edge' },
    { id: 'en-GB-SoniaNeural', name: 'Sonia', language: 'en', gender: 'female', providerId: 'edge-cloud', providerName: 'Microsoft Edge' },
  ])
  expect(edge.MsEdgeTTS.instances[0]?.options.synthesisTimeoutMs).toBe(1000)
})

it('names every voice of the whole service when no locale is configured', async () => {
  edge.state.listed = [
    { ShortName: 'en-US-AvaMultilingualNeural', Locale: 'en-US', Gender: 'Female' },
    { ShortName: 'de-DE-ConradNeural', Locale: 'de-DE', Gender: 'male' },
    { ShortName: 'ja-JP-NanamiNeural', Locale: 'ja-JP', Gender: 'Child' },
    { ShortName: 'nl-NL-FennaNeural', Locale: 'nl-NL' },
  ]
  const { tts } = await mounted({ voices: [] })
  expect(tts.catalog().voices.map(({ id, name, language, gender }) => ({ id, name, language, gender }))).toEqual([
    { id: 'en-US-AvaMultilingualNeural', name: 'Ava Multilingual', language: 'en', gender: 'female' },
    { id: 'de-DE-ConradNeural', name: 'Conrad', language: 'de', gender: 'male' },
    { id: 'ja-JP-NanamiNeural', name: 'Nanami', language: 'ja', gender: undefined },
    { id: 'nl-NL-FennaNeural', name: 'Fenna', language: 'nl', gender: undefined },
  ])
})

it('keeps the configured row authoritative while preserving the timbre Edge reported', async () => {
  edge.state.listed = [
    { ShortName: 'nl-NL-FennaNeural', Locale: 'nl-NL', Gender: 'Female' },
    { ShortName: 'nl-NL-MaartenNeural', Locale: 'nl-NL', Gender: 'Male' },
  ]
  const { tts } = await mounted({
    voices: [
      { id: 'nl-NL-FennaNeural', name: 'Fenna (deployment)', language: 'nl' },
      { id: 'nl-NL-MaartenNeural', name: 'Maarten', language: 'nl', gender: 'female' },
      sonia,
    ],
  })
  expect(tts.catalog().voices).toEqual([
    { id: 'nl-NL-FennaNeural', name: 'Fenna (deployment)', language: 'nl', gender: 'female', providerId: 'edge', providerName: 'Microsoft Edge' },
    { id: 'nl-NL-MaartenNeural', name: 'Maarten', language: 'nl', gender: 'female', providerId: 'edge', providerName: 'Microsoft Edge' },
    { id: 'en-GB-SoniaNeural', name: 'Sonia', language: 'en', gender: 'female', providerId: 'edge', providerName: 'Microsoft Edge' },
  ])
})

it('still speaks the configured voices when Edge cannot be listed', async () => {
  edge.state.listError = new Error('offline')
  const { tts } = await mounted({ voices: [sonia, { id: 'nl-NL-FennaNeural', name: 'Fenna', language: 'nl' }] })
  expect(tts.catalog().voices.map(({ id, gender }) => ({ id, gender }))).toEqual([
    { id: 'en-GB-SoniaNeural', gender: 'female' },
    { id: 'nl-NL-FennaNeural', gender: undefined },
  ])
  expect(edge.MsEdgeTTS.instances[0]?.closed).toBe(1)
})

it('streams one utterance through the pinned voice and returns the joined audio', async () => {
  edge.state.listed = [{ ShortName: 'en-GB-SoniaNeural', Locale: 'en-GB', Gender: 'Female' }]
  edge.state.streams.set('Good morning', streamOf(Buffer.from('ab'), Buffer.from('cd')))
  const { tts } = await mounted({ voices: [sonia] })
  const spec = tts.resolve({ text: 'Good morning', voiceId: 'en-GB-SoniaNeural' as TtsVoiceId })
  const audio = await tts.synthesize(spec, new AbortController().signal)
  expect(Buffer.from(audio).toString()).toBe('abcd')
  const engine = edge.MsEdgeTTS.instances.at(-1)!
  expect(engine.voiceName).toBe('en-GB-SoniaNeural')
  expect(engine.format).toBe('audio-24khz-48kbitrate-mono-mp3')
})

it('reports the caller cancellation reason and keeps the connection for the next utterance', async () => {
  edge.state.listed = [{ ShortName: 'en-GB-SoniaNeural', Locale: 'en-GB', Gender: 'Female' }]
  const held = heldStream()
  edge.state.streams.set('Good morning', held.stream)
  const { tts } = await mounted({ voices: [sonia] })
  const spec = tts.resolve({ text: 'Good morning', voiceId: 'en-GB-SoniaNeural' as TtsVoiceId })
  const controller = new AbortController()
  const cancelled = tts.synthesize(spec, controller.signal)
  await vi.waitFor(() => { expect(edge.MsEdgeTTS.instances.at(-1)?.voiceName).toBe('en-GB-SoniaNeural') })
  controller.abort(new Error('caller stopped reading'))
  held.release()
  await expect(cancelled).rejects.toThrow('caller stopped reading')
  const opened = edge.MsEdgeTTS.instances.length
  expect(edge.MsEdgeTTS.instances[opened - 1]?.closed).toBe(0)
  edge.state.streams.set('Again', streamOf(Buffer.from('ef')))
  expect(Buffer.from(await tts.synthesize(tts.resolve({ text: 'Again', voiceId: 'en-GB-SoniaNeural' as TtsVoiceId }), new AbortController().signal)).toString())
    .toBe('ef')
  expect(edge.MsEdgeTTS.instances).toHaveLength(opened)
})

it('reports a generic cancellation when the signal carries no Error', async () => {
  edge.state.listed = [{ ShortName: 'en-GB-SoniaNeural', Locale: 'en-GB', Gender: 'Female' }]
  const held = heldStream()
  edge.state.streams.set('Good morning', held.stream)
  const { tts } = await mounted({ voices: [sonia] })
  const controller = new AbortController()
  const cancelled = tts.synthesize(tts.resolve({ text: 'Good morning', voiceId: 'en-GB-SoniaNeural' as TtsVoiceId }), controller.signal)
  await vi.waitFor(() => { expect(edge.MsEdgeTTS.instances.at(-1)?.voiceName).toBe('en-GB-SoniaNeural') })
  controller.abort('stopped')
  held.release()
  await expect(cancelled).rejects.toThrow('Speech synthesis cancelled')
})

it('keeps the shared connection when two utterances are cancelled together', async () => {
  edge.state.listed = [{ ShortName: 'en-GB-SoniaNeural', Locale: 'en-GB', Gender: 'Female' }]
  const first = heldStream(), second = heldStream()
  edge.state.streams.set('one', first.stream)
  edge.state.streams.set('two', second.stream)
  const { tts } = await mounted({ voices: [sonia] })
  const controller = new AbortController()
  const a = tts.synthesize(tts.resolve({ text: 'one', voiceId: 'en-GB-SoniaNeural' as TtsVoiceId }), controller.signal)
  const b = tts.synthesize(tts.resolve({ text: 'two', voiceId: 'en-GB-SoniaNeural' as TtsVoiceId }), controller.signal)
  await vi.waitFor(() => { expect(edge.MsEdgeTTS.instances.at(-1)?.voiceName).toBe('en-GB-SoniaNeural') })
  controller.abort(new Error('stopped'))
  first.release()
  second.release()
  await expect(a).rejects.toThrow('stopped')
  await expect(b).rejects.toThrow('stopped')
  expect(edge.MsEdgeTTS.instances.at(-1)?.closed).toBe(0)
})

it('reports an utterance that produced no audio and drops its connection', async () => {
  edge.state.listed = [{ ShortName: 'en-GB-SoniaNeural', Locale: 'en-GB', Gender: 'Female' }]
  const { tts } = await mounted({ voices: [sonia] })
  await expect(tts.synthesize(tts.resolve({ text: 'Silence', voiceId: 'en-GB-SoniaNeural' as TtsVoiceId }), new AbortController().signal))
    .rejects.toThrow('Speech synthesis returned no audio')
  expect(edge.MsEdgeTTS.instances.at(-1)?.closed).toBe(1)
})

it('closes the connections it opened when the provider unloads', async () => {
  edge.state.listed = [{ ShortName: 'en-GB-SoniaNeural', Locale: 'en-GB', Gender: 'Female' }]
  edge.state.streams.set('Good morning', streamOf(Buffer.from('ab')))
  const { ctx, fiber, tts } = await mounted({ voices: [sonia] })
  await tts.synthesize(tts.resolve({ text: 'Good morning', voiceId: 'en-GB-SoniaNeural' as TtsVoiceId }), new AbortController().signal)
  const engine = edge.MsEdgeTTS.instances.at(-1)!
  await fiber.dispose()
  expect(engine.closed).toBe(1)
  expect(ctx.get('textToSpeech')!.listProviders()).toEqual([])
})

it('ignores a listing that settles after the provider unloaded', async () => {
  let settle!: () => void
  edge.state.listGate = new Promise<void>((resolve) => { settle = resolve })
  edge.state.listed = [{ ShortName: 'nl-NL-FennaNeural', Locale: 'nl-NL', Gender: 'Female' }]
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(TextToSpeech, { voiceByLanguage: {} })
  const fiber = ctx.plugin(edgePlugin, { voices: [sonia] })
  await fiber
  await fiber.dispose()
  settle()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(ctx.get('textToSpeech')!.listProviders()).toEqual([])
})

it('unloads cleanly after a voice refused to open', async () => {
  edge.state.listed = [{ ShortName: 'en-GB-SoniaNeural', Locale: 'en-GB', Gender: 'Female' }]
  edge.state.metadataError = new Error('voice unavailable')
  const { fiber, tts } = await mounted({ voices: [sonia] })
  await expect(tts.synthesize(tts.resolve({ text: 'Good morning', voiceId: 'en-GB-SoniaNeural' as TtsVoiceId }), new AbortController().signal))
    .rejects.toThrow('voice unavailable')
  await fiber.dispose()
  expect(edge.MsEdgeTTS.instances.at(-1)?.closed).toBe(0)
})

it('validates its composition config', () => {
  expect(edgePlugin.Config({ voices: [sonia] })).toEqual({ providerId: 'edge', voices: [sonia], locales: [], timeoutMs: 20000 })
  expect(() => edgePlugin.Config({})).toThrow()
  expect(() => edgePlugin.Config({ voices: [sonia], locales: ['n'] })).toThrow()
})
