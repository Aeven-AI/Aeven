/** Recording validation and the request frames the private worker accepts. */
import { validateWave } from '@aeven/speech-to-text/wave'

/**
 * Language hints accepted by provider metadata: `auto`, under which Whisper detects the spoken language of
 * each recording, or one of Whisper's own language codes (whisper.cpp `g_lang`) to decode in that language.
 */
export const languages: readonly string[] = [
  'auto', 'en', 'zh', 'de', 'es', 'ru', 'ko', 'fr', 'ja', 'pt', 'tr', 'pl', 'ca', 'nl', 'ar', 'sv', 'it', 'id', 'hi',
  'fi', 'vi', 'he', 'uk', 'el', 'ms', 'cs', 'ro', 'da', 'hu', 'ta', 'no', 'th', 'ur', 'hr', 'bg', 'lt', 'la', 'mi',
  'ml', 'cy', 'sk', 'te', 'fa', 'lv', 'bn', 'sr', 'az', 'sl', 'kn', 'et', 'mk', 'br', 'eu', 'is', 'hy', 'ne', 'mn',
  'bs', 'kk', 'sq', 'sw', 'gl', 'mr', 'pa', 'si', 'km', 'sn', 'yo', 'so', 'af', 'oc', 'ka', 'be', 'tg', 'sd', 'gu',
  'am', 'yi', 'lo', 'uz', 'fo', 'ht', 'ps', 'tk', 'nn', 'mt', 'sa', 'lb', 'my', 'bo', 'tl', 'mg', 'as', 'tt', 'haw',
  'ln', 'ha', 'ba', 'jw', 'su', 'yue',
]

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
 * @param language - requested language hint: `auto` or a Whisper language code.
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
