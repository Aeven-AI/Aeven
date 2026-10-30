/** The speech Remote: wire binding, intake limit, labelled audio, and cancellation. */
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@aeven/typert-protocol'
import TextToSpeech from '@aeven/text-to-speech'
import type { TtsProvider, TtsProviderId, TtsVoice, TtsVoiceId } from '@aeven/text-to-speech/types'
import { afterEach, expect, it, vi } from 'vitest'
import TtsController from '../src/index.ts'
import type { Config as TtsControllerConfig } from '../src/index.ts'
import type { SpeechRequest } from '../src/types.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => root.fiber.dispose())) })

const ava = 'en-US-AvaMultilingualNeural' as TtsVoiceId

/** What a failed Remote call carries across the wire. */
interface Failure {
  readonly code?: string
  readonly message: string
  readonly details?: unknown
}

function voice(id: string, language: string, gender?: 'female' | 'male'): TtsVoice {
  return { id: id as TtsVoiceId, name: id, language, ...gender === undefined ? {} : { gender } }
}

/** Mount the real registry with one Edge voice and the controller that fronts it. */
function fixture(options: { maxTextChars?: number; synthesize?: TtsProvider['synthesize'] } = {}) {
  const ctx = new Context()
  roots.push(ctx)
  const tts = new TextToSpeech(ctx, { voiceByLanguage: { en: ava } })
  const synthesize = vi.fn<TtsProvider['synthesize']>(options.synthesize ?? (async () => new Uint8Array([1, 2, 3])))
  tts.register({
    info: { id: 'edge' as TtsProviderId, name: 'Microsoft Edge', location: 'cloud' },
    voices: [voice(ava, 'en', 'female')],
    synthesize,
  })
  const api = new TtsController(ctx, { maxTextChars: options.maxTextChars ?? 40 })
  return { ctx, tts, api, synthesize }
}

/** Await one Remote call's rejection as the failure it carried. */
async function failure(run: Promise<unknown>): Promise<Failure> {
  try {
    await run
  } catch (error) {
    return error as Failure
  }
  throw new Error('expected the Remote call to fail')
}

it('binds the tts namespace with its two Remote methods', () => {
  const { api } = fixture()
  expect(api.typertRemote).toEqual(expect.objectContaining({ serviceKey: 'ttsController', namespace: 'tts' }))
  expect(remoteMethods(api).map(marker => marker.method)).toEqual(['catalog', 'synthesize'])
  expect(TtsController.Config({} as TtsControllerConfig)).toEqual({ maxTextChars: 1200 })
  expect(() => TtsController.Config({ maxTextChars: 0 })).toThrow()
})

it('lists the voices a Surface may choose without synthesizing anything', () => {
  const { api, tts, synthesize } = fixture()
  expect(api.catalog()).toEqual(tts.catalog())
  expect(api.catalog().voices).toEqual([
    { id: ava, name: ava, language: 'en', gender: 'female', providerId: 'edge', providerName: 'Microsoft Edge' },
  ])
  expect(api.catalog().voiceByLanguage).toEqual({ en: ava })
  expect(synthesize).not.toHaveBeenCalled()
})

it('speaks through the resolved voice and labels the returned audio', async () => {
  const { api, synthesize } = fixture()
  const audio = await api.synthesize({ text: 'hello', language: 'en' }, new AbortController().signal)
  expect(audio).toEqual({ audioBase64: 'AQID', mediaType: 'audio/mpeg', voiceId: ava })
  expect(synthesize).toHaveBeenCalledWith({ text: 'hello', voiceId: ava }, expect.any(AbortSignal))
})

it('refuses an utterance over the intake limit before any voice resolution', async () => {
  const { api, synthesize } = fixture({ maxTextChars: 12 })
  const rejected = await failure(api.synthesize({ text: 'x'.repeat(13) }, new AbortController().signal))
  expect(rejected).toMatchObject({ code: 'tts/text-too-long', message: 'Text exceeds 12 characters', details: { reason: 'length' } })
  expect(synthesize).not.toHaveBeenCalled()
  await expect(api.synthesize({ text: 'x'.repeat(12), language: 'en' }, new AbortController().signal)).resolves.toMatchObject({ voiceId: ava })
})

it('keeps client cancellation ahead of the intake limit', async () => {
  const { api, synthesize } = fixture({ maxTextChars: 12 })
  const cancelled = await failure(api.synthesize({ text: 'x'.repeat(13) }, AbortSignal.abort(new Error('cancelled'))))
  expect(cancelled).toMatchObject({ message: 'cancelled' })
  expect(cancelled.code).toBeUndefined()
  expect(synthesize).not.toHaveBeenCalled()
})

it('reports an unresolved voice, an empty request, and a failing provider as one Remote failure', async () => {
  const unresolved = fixture()
  expect(await failure(unresolved.api.synthesize({ text: 'hello', voiceId: 'ghost' as TtsVoiceId }, new AbortController().signal)))
    .toMatchObject({ code: 'tts/synthesis-failed', message: 'Speech synthesis voice is unavailable: ghost', details: { reason: 'Speech synthesis voice is unavailable: ghost' } })
  expect(await failure(unresolved.api.synthesize({ text: '   ' }, new AbortController().signal)))
    .toMatchObject({ code: 'tts/synthesis-failed', message: 'Speech synthesis needs text' })

  const failing = fixture({ synthesize: async () => { throw new Error('offline') } })
  expect(await failure(failing.api.synthesize({ text: 'hello', language: 'en' }, new AbortController().signal)))
    .toMatchObject({ code: 'tts/synthesis-failed', message: 'offline' })

  const throwing = fixture({ synthesize: async () => { throw 'speaker unplugged' } })
  expect(await failure(throwing.api.synthesize({ text: 'hello', language: 'en' }, new AbortController().signal)))
    .toMatchObject({ code: 'tts/synthesis-failed', message: 'speaker unplugged' })
})

it('preserves the client cancellation that stopped a provider mid-utterance', async () => {
  let startedAt!: () => void
  const entered = new Promise<void>((resolve) => { startedAt = resolve })
  const { api } = fixture({
    synthesize: async (_input, signal) => {
      startedAt()
      await new Promise<void>((_, reject) => { signal.addEventListener('abort', () => { reject(new Error('provider stopped')) }, { once: true }) })
      return new Uint8Array()
    },
  })
  const controller = new AbortController()
  const run: Promise<unknown> = api.synthesize({ text: 'hello', language: 'en' } satisfies SpeechRequest, controller.signal)
  await entered
  controller.abort(new Error('cancelled by the client'))
  const cancelled = await failure(run)
  expect(cancelled).toMatchObject({ message: 'cancelled by the client' })
  expect(cancelled.code).toBeUndefined()
})
