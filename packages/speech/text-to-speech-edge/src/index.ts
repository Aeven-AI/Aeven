/** Cloud provider: Microsoft Edge read-aloud voices, one websocket per voice. */
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@aeven/text-to-speech'
import type { TtsProviderId, TtsVoice, TtsVoiceId } from '@aeven/text-to-speech/types'
import { Config, type VoiceConfig } from './config.ts'

export { Config } from './config.ts'
export const name = 'text-to-speech-edge'
export const inject = ['textToSpeech']

/** The parts of Edge's voice listing this provider reads. */
interface EdgeVoice {
  readonly ShortName: string
  readonly Locale: string
  readonly Gender?: string
}

/**
 * Register the Edge provider; sockets open on first use per voice and close on disposal.
 * @param ctx - Host registry owner.
 * @param config - validated voices, discovered locales, and deadline.
 */
export function apply(ctx: Context, config: Config): void {
  const engines = new Map<TtsVoiceId, Promise<MsEdgeTTS>>()

  const engine = (voiceId: TtsVoiceId): Promise<MsEdgeTTS> => {
    const existing = engines.get(voiceId)
    if (existing !== undefined) return existing
    const created = (async () => {
      const tts = new MsEdgeTTS({ synthesisTimeoutMs: config.timeoutMs })
      await tts.setMetadata(voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
      return tts
    })()
    engines.set(voiceId, created)
    return created
  }

  const release = (voiceId: TtsVoiceId, tts: MsEdgeTTS): void => {
    if (engines.get(voiceId) === undefined) return
    engines.delete(voiceId)
    tts.close()
  }

  ctx.effect(() => {
    let disposed = false
    let unregister: (() => void | Promise<void>) | undefined

    const publish = (voices: readonly TtsVoice[]): void => {
      if (disposed) return
      unregister = ctx.textToSpeech.register({
        info: { id: config.providerId as TtsProviderId, name: 'Microsoft Edge', location: 'cloud' },
        voices,
        synthesize: async (input, signal) => {
          const tts = await engine(input.voiceId)
          const cancelled = new Promise<never>((_, reject) => {
            signal.addEventListener('abort', () => {
              reject(signal.reason instanceof Error ? signal.reason : new Error('Speech synthesis cancelled'))
            }, { once: true })
          })
          const collect = async (): Promise<Uint8Array> => {
            const chunks: Buffer[] = []
            for await (const chunk of tts.toStream(input.text).audioStream) {
              signal.throwIfAborted()
              chunks.push(Buffer.from(chunk as Uint8Array))
            }
            if (chunks.length === 0) throw new Error('Speech synthesis returned no audio')
            return new Uint8Array(Buffer.concat(chunks))
          }
          const collected = collect()
          // The race reports cancellation; the abandoned reader must not reject unhandled.
          collected.catch(() => {})
          try {
            return await Promise.race([collected, cancelled])
          } catch (error) {
            release(input.voiceId, tts)
            throw error
          }
        },
      })
    }

    // The configured list stays authoritative; Edge's own listing adds every voice of the
    // chosen locales, or of the whole service when the list is empty, so a deployment does not
    // have to restate a catalogue that moves.
    void discover(config).then((discovered) => {
      publish(merge(config.voices, discovered))
    }, () => {
      // An unreachable voice service must not take read-aloud offline: the configured list still speaks.
      publish(config.voices.map(configured))
    })

    return async () => {
      disposed = true
      await unregister?.()
      const opened = [...engines.values()]
      engines.clear()
      for (const pending of opened) {
        const settled = await Promise.allSettled([pending])
        const tts = settled[0]
        if (tts.status === 'fulfilled') tts.value.close()
      }
    }
  })
}

/**
 * Ask Edge which voices exist for the configured locales.
 * @param config - locales to list; an empty list takes every locale Edge publishes.
 * @returns the discovered voices, in listing order.
 */
async function discover(config: Config): Promise<TtsVoice[]> {
  const client = new MsEdgeTTS({ synthesisTimeoutMs: config.timeoutMs })
  try {
    const listed = await client.getVoices() as unknown as EdgeVoice[]
    return listed
      .filter(voice => config.locales.length === 0 || config.locales.includes(voice.Locale))
      .map((voice) => {
        const gender = reportedGender(voice.Gender)
        return {
          id: voice.ShortName as TtsVoiceId,
          name: displayName(voice.ShortName),
          language: voice.Locale.split('-')[0] ?? voice.Locale,
          ...(gender === undefined ? {} : { gender }),
        }
      })
  } finally {
    client.close()
  }
}

/**
 * Turn a service voice id into the label a Surface shows.
 * @param shortName - service id such as `en-US-AvaMultilingualNeural`.
 * @returns the name a reader recognizes, such as `Ava Multilingual`.
 */
function displayName(shortName: string): string {
  const [, , ...rest] = shortName.split('-')
  return rest.join('-').replace(/Neural$/, '').replace(/([a-z])([A-Z])/g, '$1 $2')
}

/**
 * @param reported - the `Gender` Edge lists for one voice.
 * @returns the catalogue's timbre, or nothing when Edge names another value.
 */
function reportedGender(reported: string | undefined): 'female' | 'male' | undefined {
  const value = reported?.toLowerCase()
  return value === 'female' || value === 'male' ? value : undefined
}

/**
 * @param voice - configured voice.
 * @returns the same voice as a registry entry.
 */
function configured(voice: VoiceConfig): TtsVoice {
  return {
    id: voice.id as TtsVoiceId,
    name: voice.name,
    language: voice.language,
    ...(voice.gender === undefined ? {} : { gender: voice.gender }),
  }
}

/**
 * Union of configured and discovered voices, configured ids winning but keeping the timbre Edge
 * reported when the configured row omits it.
 * @param voices - configured voices.
 * @param discovered - voices Edge reported.
 * @returns one entry per voice id.
 */
function merge(voices: readonly VoiceConfig[], discovered: readonly TtsVoice[]): TtsVoice[] {
  const merged = new Map<TtsVoiceId, TtsVoice>(discovered.map(voice => [voice.id, voice]))
  for (const voice of voices) {
    const entry = configured(voice)
    const known = merged.get(entry.id)
    merged.set(entry.id, known?.gender === undefined || entry.gender !== undefined
      ? entry
      : { ...entry, gender: known.gender })
  }
  return [...merged.values()]
}
