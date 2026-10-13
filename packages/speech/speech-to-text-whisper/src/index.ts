/** Optional local Whisper provider; activation checks cached files without downloading or loading models. */
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@aeven/speech-to-text'
import type {} from '@aeven/subprocess'
import type { SpeechProviderId } from '@aeven/speech-to-text/types'
import { Config } from './config.ts'
import { WhisperWorker } from './recognizer.ts'
import { languages } from './input.ts'

export { Config } from './config.ts'
export const name = 'speech-to-text-whisper'
export const inject = ['speechToText', 'subprocess']

/** Planning estimates for the setup card: the small model plus VAD, and the loaded model's resident memory. */
const SETUP_ESTIMATE = { recommendedDiskBytes: 300_000_000, expectedMemoryBytes: 600_000_000, minimumMinutes: 1, maximumMinutes: 5 }

/**
 * Register the local recognizer and inspect disk caches without downloading or loading models.
 * @param ctx - Host registry and subprocess owner.
 * @param config - validated runtime configuration.
 */
export function apply(ctx: Context, config: Config): void {
  for (const path of [config.dataRoot, config.modelPath, config.vadModelPath, config.workerPath]) {
    if (path !== undefined && !isAbsolute(path)) throw new Error(`Whisper paths must be absolute: ${path}`)
  }
  for (const origin of config.modelOrigin === undefined ? config.modelOrigins : [config.modelOrigin]) new URL(origin)
  const worker = new WhisperWorker(ctx, config)
  ctx.effect(() => {
    const unregister = ctx.speechToText.register({
      info: { id: config.providerId as SpeechProviderId, name: 'Whisper small', location: 'host-local', languages,
        downloadSources: worker.downloadSources, setupEstimate: SETUP_ESTIMATE },
      preparation: worker,
      transcribe: async (input, signal) => await worker.transcribe(input, signal),
    })
    worker.inspect()
    return async () => {
      const removing = unregister()
      await worker.dispose()
      await removing
    }
  })
}
