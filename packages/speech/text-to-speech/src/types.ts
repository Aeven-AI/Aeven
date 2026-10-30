/** Provider-neutral speech synthesis inputs and registration metadata. */
import type { Branded } from '@aeven/brand'

/** Configured identity of one synthesis provider. */
export type TtsProviderId = Branded<'TtsProviderId'>

/** Provider-assigned voice identity, unique across the registered providers. */
export type TtsVoiceId = Branded<'TtsVoiceId'>

/** One voice a provider can speak with. */
export interface TtsVoice {
  readonly id: TtsVoiceId
  readonly name: string
  /** Primary language subtag this voice speaks, such as `en`, `nl`, `es` or `zh`. */
  readonly language: string
  /** Timbre the provider reports; absent when it names none. A language's default prefers a female voice. */
  readonly gender?: 'female' | 'male'
}

/** Public provider facts; credentials and endpoints are excluded. */
export interface TtsProviderInfo {
  readonly id: TtsProviderId
  readonly name: string
  readonly location: 'host-local' | 'cloud'
}

/** One utterance pinned to a voice. */
export interface TtsInput {
  readonly text: string
  readonly voiceId: TtsVoiceId
}

/** Complete synthesis request from a Consumer; voice or language, never both required. */
export interface TtsRequest {
  readonly text: string
  /** Primary language subtag whose configured voice reads the text. */
  readonly language?: string
  /** Exact voice, overriding the language mapping. */
  readonly voiceId?: TtsVoiceId
}

/** Provider-pinned synthesis input produced by resolve(). */
export interface TtsSpec {
  readonly provider: TtsProvider
  readonly text: string
  readonly voiceId: TtsVoiceId
}

/** Voice facts flattened across providers for Surface listing. */
export interface TtsVoiceView extends TtsVoice {
  readonly providerId: TtsProviderId
  readonly providerName: string
}

/** One consistent voice roster and configured language mapping. */
export interface TtsCatalog {
  readonly voices: readonly TtsVoiceView[]
  readonly voiceByLanguage: Readonly<Record<string, string>>
}

/** One replaceable synthesis provider. It owns transport and cancellation of its own work. */
export interface TtsProvider {
  readonly info: TtsProviderInfo
  /** Voices this provider can speak with; `resolve()` searches them by exact id. */
  readonly voices: readonly TtsVoice[]
  /**
   * Synthesize one utterance as encoded audio bytes.
   * @param input - text and pinned voice, borrowed until settlement.
   * @param signal - caller cancellation and provider withdrawal.
   * @returns encoded audio; the provider's encoding is fixed per provider.
   */
  synthesize(input: TtsInput, signal: AbortSignal): Promise<Uint8Array>
}
