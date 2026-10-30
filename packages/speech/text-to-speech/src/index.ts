/** Named synthesis providers with disposable registration and explicit voice resolution. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { TtsCatalog, TtsProvider, TtsProviderId, TtsRequest, TtsSpec, TtsVoice, TtsVoiceId, TtsVoiceView } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Speech synthesis provider registry. */
    textToSpeech: TextToSpeech
  }
}

/** Composition defaults for the language-to-voice mapping. */
export interface Config {
  /** Voice id per primary language subtag, such as `{ en: 'en-US-AvaMultilingualNeural' }`. */
  voiceByLanguage: Record<string, string>
}

interface Registration {
  readonly provider: TtsProvider
  readonly lifetime: AbortController
  readonly pending: Set<Promise<unknown>>
}

/** Registry shared by every synthesis consumer in one Host composition. */
export default class TextToSpeech extends Service {
  static Config: z<Partial<Config>, Config> = z.object({
    voiceByLanguage: z.dict(z.string().min(1)).default({}),
  })

  private readonly providers = new Map<TtsProviderId, Registration>()
  /** Reserved voice ids: one id names one voice across all providers, so resolution is unambiguous. */
  private readonly voices = new Map<TtsVoiceId, { provider: TtsProvider; voice: TtsVoice }>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'textToSpeech')
    ctx.effect(() => async () => {
      await Promise.all([...this.providers.values()].map(registration => this.remove(registration)))
    })
  }

  /**
   * Register one synthesis provider; duplicate provider or voice ids fail without replacing the original.
   * @param provider - provider owned by the contributing fiber.
   * @returns idempotent disposer which rejects admission and joins accepted work.
   */
  register(provider: TtsProvider): () => Promise<void> {
    if (this.providers.has(provider.info.id)) throw new Error(`Speech synthesis provider already registered: ${provider.info.id}`)
    for (const voice of provider.voices) {
      if (this.voices.has(voice.id)) throw new Error(`Speech synthesis voice already registered: ${voice.id}`)
    }
    const registration: Registration = { provider, lifetime: new AbortController(), pending: new Set() }
    this.providers.set(provider.info.id, registration)
    for (const voice of provider.voices) this.voices.set(voice.id, { provider, voice })
    return async () => { await this.remove(registration) }
  }

  private async remove(registration: Registration): Promise<void> {
    if (this.providers.get(registration.provider.info.id) !== registration) return
    this.providers.delete(registration.provider.info.id)
    for (const voice of registration.provider.voices) {
      if (this.voices.get(voice.id)?.provider === registration.provider) this.voices.delete(voice.id)
    }
    registration.lifetime.abort(new Error('Speech synthesis provider unloaded'))
    await Promise.allSettled(registration.pending)
  }

  /**
   * Read the current provider roster.
   * @returns provider facts in registration order.
   */
  listProviders(): readonly TtsProvider['info'][] {
    return [...this.providers.values()].map(({ provider }) => provider.info)
  }

  /**
   * Read every voice a Surface may choose, plus the configured language mapping.
   * @returns detached voice roster and mapping.
   */
  catalog(): TtsCatalog {
    const voices: TtsVoiceView[] = [...this.providers.values()].flatMap(({ provider }) => provider.voices.map(voice => ({
      ...voice, providerId: provider.info.id, providerName: provider.info.name,
    })))
    return { voices, voiceByLanguage: { ...this.config.voiceByLanguage } }
  }

  /**
   * Apply the requested voice, the configured language mapping, or the catalogue for that language.
   * A voice id that no provider registered fails explicitly instead of falling back.
   * @param request - text plus a language or an exact voice.
   * @returns provider-pinned input for synthesize().
   */
  resolve(request: TtsRequest): TtsSpec {
    if (request.text.trim() === '') throw new Error('Speech synthesis needs text')
    const id = request.voiceId ?? this.voiceFor(request.language)
    if (id === undefined) {
      throw new Error(request.language === undefined
        ? 'Speech synthesis needs a language or a voice'
        : `No speech synthesis voice speaks language: ${request.language}`)
    }
    const entry = this.voices.get(id as TtsVoiceId)
    if (entry === undefined) throw new Error(`Speech synthesis voice is unavailable: ${id}`)
    return { provider: entry.provider, text: request.text, voiceId: entry.voice.id }
  }

  /**
   * Choose the voice that reads one language, from the mapping or from the registered catalogue.
   * The mapping wins; otherwise a voice of the language's home region, then any voice of that language,
   * then a multilingual voice. Every rung prefers a female voice, so an unmapped language never falls
   * through to a male one while a female voice of it exists.
   * @param language - primary subtag or full tag, such as `pt` or `pt-BR`.
   * @returns the chosen voice id, or nothing when no provider speaks the language.
   */
  private voiceFor(language: string | undefined): string | undefined {
    if (language === undefined) return undefined
    const mapped = this.config.voiceByLanguage[language] ?? this.config.voiceByLanguage[language.split('-')[0] ?? language]
    if (mapped !== undefined) return mapped
    const primary = (language.split('-')[0] ?? language).toLowerCase()
    const spoken = [...this.voices.values()].map(({ voice }) => voice)
    const female = spoken.filter(voice => voice.gender === 'female')
    const rungs: readonly ((voice: TtsVoice) => boolean)[] = [
      voice => voice.id.toLowerCase().startsWith(`${primary}-${primary}-`),
      voice => voice.language.toLowerCase() === primary,
      voice => voice.language.toLowerCase().startsWith(primary),
    ]
    for (const matches of rungs) {
      const chosen = female.find(matches) ?? spoken.find(matches)
      if (chosen !== undefined) return chosen.id
    }
    const multilingual = (voice: TtsVoice): boolean => /multilingual/i.test(voice.id)
    return female.find(multilingual)?.id ?? spoken.find(multilingual)?.id
  }

  /**
   * Execute exactly the resolved provider; no fallback speaks the text elsewhere.
   * @param spec - resolved input; a withdrawn or replaced registration is rejected.
   * @param signal - caller cancellation.
   * @returns encoded audio after provider settlement.
   */
  async synthesize(spec: TtsSpec, signal: AbortSignal): Promise<Uint8Array> {
    signal.throwIfAborted()
    const registration = this.providers.get(spec.provider.info.id)
    if (registration?.provider !== spec.provider) throw new Error('Resolved speech synthesis provider is no longer registered')
    const combined = AbortSignal.any([signal, registration.lifetime.signal])
    const pending = Promise.resolve().then(() => {
      combined.throwIfAborted()
      return spec.provider.synthesize({ text: spec.text, voiceId: spec.voiceId }, combined)
    })
    registration.pending.add(pending)
    try {
      const audio = await pending
      combined.throwIfAborted()
      return audio
    } finally {
      registration.pending.delete(pending)
    }
  }
}
