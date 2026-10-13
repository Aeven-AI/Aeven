/** Recording validation and the request frames the private worker accepts. */
import { validateWave } from '@aeven/speech-to-text/wave'

/** Language hints accepted by provider metadata: Whisper detects the spoken language of each recording. */
export const languages: readonly string[] = ['auto']

/** A request rejected before inference; the loaded worker remains reusable. */
export class SpeechInputError extends Error {}

/** One validated recording, ready to frame for the worker. */
export interface ValidatedInput {
  readonly audioSeconds: number
  /** The WAV body: 16 kHz mono PCM16 little-endian samples. */
  readonly pcm: Uint8Array
}

/**
 * Validate a recording before it reaches the native worker.
 * @param audio - untrusted WAV request bytes.
 * @param language - requested language hint; only automatic detection is offered.
 * @param maxAudioBytes - configured byte limit.
 * @returns duration and PCM body; invalid inputs throw SpeechInputError.
 */
export function validateInput(audio: Uint8Array, language: string, maxAudioBytes: number): ValidatedInput {
  if (!languages.includes(language)) throw new SpeechInputError('Unsupported Whisper language')
  if (audio.byteLength > maxAudioBytes) throw new SpeechInputError('Speech audio exceeds the worker byte limit')
  let audioSeconds: number
  try { audioSeconds = validateWave(audio, maxAudioBytes / 32000) }
  catch (error) { throw new SpeechInputError('Invalid speech WAV', { cause: error }) }
  return { audioSeconds, pcm: audio.subarray(44) }
}

/**
 * Encode one worker request: magic, language length, sample count, language, then samples.
 * @param language - validated language hint.
 * @param pcm - PCM16 little-endian samples.
 * @returns the complete frame the worker reads from stdin.
 */
export function encodeRequest(language: string, pcm: Uint8Array): Buffer {
  const header = Buffer.alloc(12)
  header.write('AVW1', 0, 'ascii')
  header.writeUInt32LE(Buffer.byteLength(language, 'ascii'), 4)
  header.writeUInt32LE(pcm.byteLength / 2, 8)
  return Buffer.concat([header, Buffer.from(language, 'ascii'), pcm])
}
