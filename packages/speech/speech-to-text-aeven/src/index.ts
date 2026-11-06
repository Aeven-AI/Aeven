/**
 * Cloud speech recognition through the Aeven API's `/transcribe` route. Each
 * recording is sent with the Aeven session of the person dictating, so a Host
 * that serves several accounts never bills or identifies one person's speech
 * as another's, and the Host itself loads no recognizer model.
 * @module @aeven/speech-to-text-aeven
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@aeven/credentials'
import type {} from '@aeven/credentials'
import type {} from '@aeven/agent'
import type {} from '@aeven/identity-user'
import type {} from '@aeven/speech-to-text'
import type { SpeechInput, SpeechProviderId, Transcript } from '@aeven/speech-to-text/types'

export const name = 'speech-to-text-aeven'
export const inject = ['speechToText']

/** Deployment configuration for the Aeven transcription route. */
export interface Config {
  /** Unique registration id; consumers select this exact id. */
  providerId: string
  /** Base URL of the Aeven API, path prefix included (`https://aeven.io/api`); `/transcribe` is appended to it. */
  apiUrl: string
  /** Credential reference holding each signed-in user's Aeven session. */
  apiKeyEnv: string
  /** Largest recording sent, in bytes; a longer one is refused before upload. */
  maxAudioBytes: number
  /** Deadline for one transcription request, in milliseconds. */
  timeoutMs: number
}

export const Config = z.object({
  providerId: z.string().default('aeven-cloud'),
  apiUrl: z.string().required(),
  apiKeyEnv: z.string().role('credential-ref').default('AEVEN_TOKEN'),
  maxAudioBytes: z.natural().default(25 * 1024 * 1024),
  timeoutMs: z.natural().default(60_000),
}) as z<Config>

/** What `/transcribe` answers with. */
interface TranscribeResponse {
  readonly text?: string
  readonly duration?: number
}

/**
 * The bearer for one recording: the session of the account whose agent is
 * acting, else of the caller who is dictating. There is no process-wide
 * fallback, because on a shared Host that value would belong to somebody else.
 * @param ctx - Host context carrying credentials and the acting user.
 * @param ref - credential reference naming the session.
 * @returns the bearer token.
 * @throws when the speaker has no Aeven session on this Host.
 */
async function sessionToken(ctx: Context, ref: string): Promise<string> {
  const credentials = ctx.get('credentials')
  const user = ctx.get('agents')?.currentInitiator()?.session.header.owner
    ?? ctx.get('identityUsers')?.actingUser()?.id
  const hit = credentials === undefined ? undefined : await credentials.resolve(credentialRef(ref), user)
  if (hit === undefined || hit.value.length === 0) {
    throw new Error('speech-to-text-aeven: dictation needs a signed-in Aeven session')
  }
  return hit.value
}

/**
 * Send one recording to the Aeven API and read back its text.
 * @param ctx - Host context carrying credentials and the acting user.
 * @param config - validated configuration.
 * @param input - WAV bytes and language hint; the API detects the language itself.
 * @param signal - caller or registration cancellation.
 * @returns the transcript with the API's audio duration and the measured request time.
 */
async function transcribe(ctx: Context, config: Config, input: SpeechInput, signal: AbortSignal): Promise<Transcript> {
  if (input.audio.byteLength > config.maxAudioBytes) {
    throw new Error(`speech-to-text-aeven: the recording is larger than ${String(config.maxAudioBytes)} bytes`)
  }
  const token = await sessionToken(ctx, config.apiKeyEnv)
  const form = new FormData()
  // A copy, because the input is only borrowed until settlement and Blob needs an ArrayBuffer-backed view.
  form.append('file', new Blob([new Uint8Array(input.audio)], { type: 'audio/wav' }), 'audio.wav')
  const started = performance.now()
  // Appended rather than resolved, so a base with a path prefix (`https://aeven.io/api`) keeps it.
  const response = await fetch(`${config.apiUrl.replace(/\/+$/, '')}/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]),
  })
  if (!response.ok) {
    throw new Error(`speech-to-text-aeven: the Aeven API answered ${String(response.status)}`)
  }
  const body = await response.json() as TranscribeResponse
  return {
    text: typeof body.text === 'string' ? body.text.trim() : '',
    audioSeconds: typeof body.duration === 'number' ? body.duration : 0,
    inferenceSeconds: (performance.now() - started) / 1000,
  }
}

/**
 * Register the Aeven cloud recognizer.
 * @param ctx - Host context with the speech registry.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  new URL(config.apiUrl)
  ctx.effect(() => ctx.speechToText.register({
    info: { id: config.providerId as SpeechProviderId, name: 'Aeven', location: 'cloud', languages: ['auto'] },
    transcribe: (input, signal) => transcribe(ctx, config, input, signal),
  }), 'speech-to-text-aeven: provider')
}
