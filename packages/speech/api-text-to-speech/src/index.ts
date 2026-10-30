/** Authenticated, cancellation-aware Client access to speech synthesis. */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@aeven/typert-protocol'
import type {} from '@aeven/text-to-speech'
import type { TtsCatalog } from '@aeven/text-to-speech/types'
import type { SpeechAudio, SpeechRequest } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Speech synthesis Remote controller. */
    ttsController: TtsController
  }
}

/** Limits applied before calling a provider. */
export interface Config {
  /** Maximum characters of one synthesized utterance. */
  maxTextChars: number
}

/** Speech synthesis never activates or submits to an Agent. */
export default class TtsController extends TypertRemoteService {
  static inject = ['textToSpeech', 'typert']
  static Config: z<Partial<Config>, Config> = z.object({
    maxTextChars: z.natural().min(1).default(1200),
  })

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'ttsController', { namespace: 'tts' })
  }

  /**
   * Read the voices a Surface may choose and the configured language mapping.
   * @returns detached voice roster and mapping.
   */
  @Remote
  catalog(): TtsCatalog {
    return this.ctx.textToSpeech.catalog()
  }

  /**
   * Speak one utterance through the explicit voice resolution.
   * @param request - text plus a language or an exact voice.
   * @param signal - Client cancellation or Remote contribution disposal.
   * @returns encoded audio without adding a Session event.
   */
  @Remote
  async synthesize(request: SpeechRequest, signal: AbortSignal): Promise<SpeechAudio> {
    signal.throwIfAborted()
    if (request.text.length > this.config.maxTextChars) {
      throw new RemoteError('tts/text-too-long', `Text exceeds ${this.config.maxTextChars} characters`, { reason: 'length' })
    }
    try {
      const spec = this.ctx.textToSpeech.resolve(request)
      const audio = await this.ctx.textToSpeech.synthesize(spec, signal)
      return { audioBase64: Buffer.from(audio).toString('base64'), mediaType: 'audio/mpeg', voiceId: spec.voiceId }
    } catch (error) {
      signal.throwIfAborted()
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('tts/synthesis-failed', reason, { reason })
    }
  }
}
