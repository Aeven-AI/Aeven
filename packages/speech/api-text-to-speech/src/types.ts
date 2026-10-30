/** Wire shapes for the speech synthesis Remote. */
import type { TtsVoiceId } from '@aeven/text-to-speech/types'
import type {} from '@aeven/typert-protocol'

declare module '@aeven/typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The utterance exceeded the intake limit before any provider was called. */
    'tts/text-too-long': { readonly reason: string }
    /** Voice resolution or synthesis failed. */
    'tts/synthesis-failed': { readonly reason: string }
  }
}

/** One utterance to speak; the Host resolves the voice from the language mapping or an exact id. */
export interface SpeechRequest {
  readonly text: string
  /** Primary language subtag whose configured voice reads the text. */
  readonly language?: string
  /** Exact voice, overriding the language mapping. */
  readonly voiceId?: TtsVoiceId
}

/** Encoded audio plus the voice that produced it, so the Surface can label the player. */
export interface SpeechAudio {
  readonly audioBase64: string
  readonly mediaType: string
  readonly voiceId: TtsVoiceId
}
