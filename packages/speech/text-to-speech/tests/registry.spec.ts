/** Provider registration, voice resolution, and synthesis lifetimes of the shared registry. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TextToSpeech from '../src/index.ts'
import type { TtsProvider, TtsProviderId, TtsRequest, TtsVoice, TtsVoiceId } from '../src/types.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => root.fiber.dispose())) })

function voice(id: string, language: string, gender?: 'female' | 'male'): TtsVoice {
  return { id: id as TtsVoiceId, name: id, language, ...gender === undefined ? {} : { gender } }
}

function provider(id: string, voices: readonly TtsVoice[], synthesize?: TtsProvider['synthesize']): TtsProvider {
  return {
    info: { id: id as TtsProviderId, name: `${id} speech`, location: 'cloud' },
    voices,
    synthesize: synthesize ?? (async () => new Uint8Array([7])),
  }
}

/** Mount the real service on a fresh root context. */
async function mounted(voiceByLanguage: Record<string, string> = {}) {
  const ctx = new Context()
  roots.push(ctx)
  const fiber = ctx.plugin(TextToSpeech, { voiceByLanguage })
  await fiber
  return { ctx, fiber, tts: ctx.get('textToSpeech')! }
}

/** Register one provider and read the voice its language default picks. */
async function chosen(voices: readonly TtsVoice[], request: Omit<TtsRequest, 'text'>, mapping: Record<string, string> = {}): Promise<string> {
  const { tts } = await mounted(mapping)
  tts.register(provider('edge', voices))
  return tts.resolve({ text: 'hello', ...request }).voiceId
}

describe('provider roster', () => {
  it('registers named providers, lists their facts, and publishes their voices with the mapping', async () => {
    const { tts } = await mounted({ en: 'en-US-AvaMultilingualNeural' })
    const local = provider('local', [voice('host-voice', 'nl', 'female')])
    const cloud = provider('edge', [voice('en-US-AvaMultilingualNeural', 'en', 'female'), voice('en-US-AndrewMultilingualNeural', 'en', 'male')])
    tts.register(local)
    tts.register(cloud)
    expect(tts.listProviders()).toEqual([local.info, cloud.info])
    expect(tts.catalog()).toEqual({
      voices: [
        { ...voice('host-voice', 'nl', 'female'), providerId: 'local', providerName: 'local speech' },
        { ...voice('en-US-AvaMultilingualNeural', 'en', 'female'), providerId: 'edge', providerName: 'edge speech' },
        { ...voice('en-US-AndrewMultilingualNeural', 'en', 'male'), providerId: 'edge', providerName: 'edge speech' },
      ],
      voiceByLanguage: { en: 'en-US-AvaMultilingualNeural' },
    })
  })

  it('hands every reader its own copy of the catalogue', async () => {
    const { tts } = await mounted({ en: 'en-US-AvaMultilingualNeural' })
    tts.register(provider('edge', [voice('en-US-AvaMultilingualNeural', 'en', 'female')]))
    const catalog = tts.catalog()
    const mutableVoices = catalog.voices as unknown as TtsVoice[]
    mutableVoices.splice(0)
    const mapping = catalog.voiceByLanguage as Record<string, string>
    mapping.en = 'nonsense'
    expect(tts.catalog()).toEqual({
      voices: [{ ...voice('en-US-AvaMultilingualNeural', 'en', 'female'), providerId: 'edge', providerName: 'edge speech' }],
      voiceByLanguage: { en: 'en-US-AvaMultilingualNeural' },
    })
  })

  it('refuses a duplicate provider id or a voice id another provider already owns', async () => {
    const { tts } = await mounted()
    const original = provider('edge', [voice('a-voice', 'en')])
    tts.register(original)
    expect(() => tts.register(provider('edge', [voice('b-voice', 'en')]))).toThrow('provider already registered: edge')
    expect(() => tts.register(provider('other', [voice('a-voice', 'en')]))).toThrow('voice already registered: a-voice')
    expect(tts.listProviders()).toEqual([original.info])
    expect(tts.catalog().voices.map(view => view.id)).toEqual(['a-voice'])
  })

  it('withdraws one provider with its disposer, idempotently, and leaves later ones registered', async () => {
    const { tts } = await mounted()
    const remove = tts.register(provider('edge', [voice('a-voice', 'en')]))
    const keep = provider('local', [voice('b-voice', 'nl')])
    tts.register(keep)
    await remove()
    expect(tts.listProviders()).toEqual([keep.info])
    expect(tts.catalog().voices.map(view => view.id)).toEqual(['b-voice'])
    await remove()
    expect(tts.listProviders()).toEqual([keep.info])
  })

  it('withdraws a voice a provider lists more than once without disturbing another provider', async () => {
    const { tts } = await mounted()
    const shared = voice('a-voice', 'en', 'female')
    const remove = tts.register(provider('edge', [shared, shared]))
    const keep = provider('local', [voice('b-voice', 'nl')])
    tts.register(keep)
    expect(tts.resolve({ text: 'hello', voiceId: 'a-voice' as TtsVoiceId }).voiceId).toBe('a-voice')
    await remove()
    expect(tts.catalog().voices.map(view => view.id)).toEqual(['b-voice'])
    expect(tts.listProviders()).toEqual([keep.info])
  })

  it('removes every registration when the service unloads', async () => {
    const { tts, fiber } = await mounted()
    tts.register(provider('edge', [voice('a-voice', 'en')]))
    tts.register(provider('local', [voice('b-voice', 'nl')]))
    await fiber.dispose()
    expect(tts.listProviders()).toEqual([])
    expect(tts.catalog().voices).toEqual([])
  })
})

describe('voice resolution', () => {
  it('rejects requests without text, without a voice or language, and with an unregistered voice id', async () => {
    const { tts } = await mounted({ en: 'en-US-AvaMultilingualNeural' })
    tts.register(provider('edge', [voice('en-US-AvaMultilingualNeural', 'en', 'female')]))
    expect(() => tts.resolve({ text: '  ', voiceId: 'en-US-AvaMultilingualNeural' as TtsVoiceId })).toThrow('Speech synthesis needs text')
    expect(() => tts.resolve({ text: 'hello' })).toThrow('Speech synthesis needs a language or a voice')
    expect(() => tts.resolve({ text: 'hello', voiceId: 'ghost' as TtsVoiceId })).toThrow('Speech synthesis voice is unavailable: ghost')
    expect(tts.resolve({ text: 'hello', language: 'en' }).voiceId).toBe('en-US-AvaMultilingualNeural')
  })

  it('prefers the exact voice over the language mapping', async () => {
    const voices = [voice('en-US-AvaMultilingualNeural', 'en', 'female'), voice('nl-NL-FennaNeural', 'nl', 'female')]
    expect(await chosen(voices, { voiceId: 'nl-NL-FennaNeural' as TtsVoiceId }, { en: 'en-US-AvaMultilingualNeural' })).toBe('nl-NL-FennaNeural')
    expect(await chosen(voices, { language: 'en' }, { en: 'en-US-AvaMultilingualNeural' })).toBe('en-US-AvaMultilingualNeural')
  })

  it('matches the mapping by the language tag, then by its primary subtag', async () => {
    const voices = [voice('pt-BR-FranciscaNeural', 'pt', 'female'), voice('pt-PT-RaquelNeural', 'pt', 'female')]
    expect(await chosen(voices, { language: 'pt-BR' }, { pt: 'pt-PT-RaquelNeural' })).toBe('pt-PT-RaquelNeural')
    expect(await chosen(voices, { language: 'pt-BR' }, { 'pt-BR': 'pt-BR-FranciscaNeural' })).toBe('pt-BR-FranciscaNeural')
  })

  it('prefers a home-region voice of the language, and a female voice inside that rung', async () => {
    const home = [voice('de-DE-ConradNeural', 'de', 'male'), voice('de-DE-KatjaNeural', 'de', 'female'), voice('de-AT-IngridNeural', 'de', 'female')]
    expect(await chosen(home, { language: 'de' })).toBe('de-DE-KatjaNeural')
    const neighbours = [voice('de-AT-IngridNeural', 'de', 'female'), voice('nl-NL-FennaNeural', 'nl', 'female')]
    expect(await chosen(neighbours, { language: 'de' })).toBe('de-AT-IngridNeural')
  })

  it('takes a voice of the language before a regional variant, and a male one only without a female', async () => {
    expect(await chosen([voice('es-MX-DaliaNeural', 'es-mx', 'female'), voice('es-JorgeNeural', 'es', 'male')], { language: 'es' })).toBe('es-JorgeNeural')
    expect(await chosen([voice('es-MX-DaliaNeural', 'es-mx', 'female'), voice('es-MX-JorgeNeural', 'es-mx', 'male')], { language: 'es' })).toBe('es-MX-DaliaNeural')
    expect(await chosen([voice('es-MX-JorgeNeural', 'es-mx', 'male')], { language: 'es' })).toBe('es-MX-JorgeNeural')
  })

  it('falls back to a multilingual voice, female first, when no provider speaks the language', async () => {
    const both = [voice('en-US-AndrewMultilingualNeural', 'en', 'male'), voice('en-US-AvaMultilingualNeural', 'en', 'female')]
    expect(await chosen(both, { language: 'ja' })).toBe('en-US-AvaMultilingualNeural')
    expect(await chosen([voice('en-US-AndrewMultilingualNeural', 'en', 'male')], { language: 'ja' })).toBe('en-US-AndrewMultilingualNeural')
  })

  it('reports a language no registered voice can speak', async () => {
    const { tts } = await mounted()
    tts.register(provider('edge', [voice('en-US-AvaNeural', 'en', 'female')]))
    expect(() => tts.resolve({ text: 'hello', language: 'ja' })).toThrow('No speech synthesis voice speaks language: ja')
  })
})

describe('synthesis', () => {
  it('runs exactly the resolved provider and returns its encoded audio', async () => {
    const audio = new Uint8Array([1, 2, 3])
    const synthesize = vi.fn<TtsProvider['synthesize']>(async () => audio)
    const { tts } = await mounted()
    tts.register(provider('edge', [voice('en-US-AvaNeural', 'en', 'female')], synthesize))
    const other = vi.fn<TtsProvider['synthesize']>(async () => new Uint8Array([9]))
    tts.register(provider('local', [voice('host-voice', 'nl', 'male')], other))
    expect(await tts.synthesize(tts.resolve({ text: 'hello', language: 'en' }), new AbortController().signal)).toEqual(audio)
    expect(synthesize).toHaveBeenCalledWith({ text: 'hello', voiceId: 'en-US-AvaNeural' }, expect.any(AbortSignal))
    expect(other).not.toHaveBeenCalled()
  })

  it('rejects pre-aborted, withdrawn, and replaced registrations', async () => {
    const { tts } = await mounted()
    const synthesize = vi.fn<TtsProvider['synthesize']>(async () => new Uint8Array([1]))
    const remove = tts.register(provider('edge', [voice('a-voice', 'en', 'female')], synthesize))
    const spec = tts.resolve({ text: 'hello', voiceId: 'a-voice' as TtsVoiceId })
    await expect(tts.synthesize(spec, AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled')
    expect(synthesize).not.toHaveBeenCalled()
    await remove()
    await expect(tts.synthesize(spec, new AbortController().signal)).rejects.toThrow('no longer registered')
    tts.register(provider('edge', [voice('a-voice', 'en', 'female')]))
    await expect(tts.synthesize(spec, new AbortController().signal)).rejects.toThrow('no longer registered')
  })

  it('withdraws the registration before joining work it already accepted', async () => {
    const { tts } = await mounted()
    let enter!: () => void
    const entered = new Promise<void>((resolve) => { enter = resolve })
    const synthesize = vi.fn<TtsProvider['synthesize']>(async (_input, signal) => {
      enter()
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      return new Uint8Array([4])
    })
    const remove = tts.register(provider('edge', [voice('a-voice', 'en', 'female')], synthesize))
    const operation = tts.synthesize(tts.resolve({ text: 'hello', voiceId: 'a-voice' as TtsVoiceId }), new AbortController().signal)
    const rejection = expect(operation).rejects.toThrow('unloaded')
    await entered
    const removing = remove()
    expect(tts.listProviders()).toEqual([])
    await removing
    await rejection
    expect(synthesize).toHaveBeenCalledOnce()
  })

  it('refuses queued work before the provider starts when its registration is withdrawn', async () => {
    const { tts } = await mounted()
    const synthesize = vi.fn<TtsProvider['synthesize']>(async () => new Uint8Array([4]))
    const remove = tts.register(provider('edge', [voice('a-voice', 'en', 'female')], synthesize))
    const operation = tts.synthesize(tts.resolve({ text: 'hello', voiceId: 'a-voice' as TtsVoiceId }), new AbortController().signal)
    const rejection = expect(operation).rejects.toThrow('unloaded')
    await remove()
    await rejection
    expect(synthesize).not.toHaveBeenCalled()
  })

  it('resolves its composition config from the schema defaults', () => {
    expect(TextToSpeech.Config({})).toEqual({ voiceByLanguage: {} })
    expect(TextToSpeech.Config({ voiceByLanguage: { nl: 'nl-NL-FennaNeural' } })).toEqual({ voiceByLanguage: { nl: 'nl-NL-FennaNeural' } })
    expect(() => TextToSpeech.Config({ voiceByLanguage: { nl: '' } })).toThrow()
  })
})
