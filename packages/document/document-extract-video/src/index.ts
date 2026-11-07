/**
 * Video and MP3 reader: claims recorded and uploaded clips so a composer can attach
 * them, and reports what this deployment knows about the file — duration,
 * frame size, and codec when `ffprobe` answers, the container and size always —
 * and, when the deployment mounts speech-to-text with voice input on, a
 * transcript of the clip's sound, or that no speech was recognized in it.
 * Frames are never described, so the text never implies the model watched the clip.
 * @module @aeven/document-extract-video
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessRuntime } from '@aeven/subprocess'
import z from '@deepseek-ai/schemastery'
import type {} from '@aeven/document-extract'
import type {} from '@aeven/speech-to-text'
import type {
  DocumentExtractInput, DocumentExtractProviderId, DocumentFormats, ExtractedDocument,
} from '@aeven/document-extract'

/** Stable plugin name. */
export const name = 'document-extract-video'
/** The registry this provider contributes to. */
export const inject = ['documentExtract']

/** Probe policy for the host's own `ffprobe`. */
export interface Config {
  /** `ffprobe` executable, resolved through `PATH` unless it names a file. */
  ffprobePath: string
  /** Wall-clock limit for one probe before the reader falls back to file facts. */
  probeTimeoutMs: number
  /** Directory each clip is written to for the probe; defaults to the OS temp directory. */
  probeDirectory?: string
  /**
   * Argv the probe runs under, such as a bubblewrap jail that sees only
   * `/usr` and {@link probeDirectory}; the `ffprobe` and `ffmpeg` argv follow it. Omitted,
   * they run directly.
   */
  probeRunner?: string[]
  /** `ffmpeg` executable that decodes a clip's sound for transcription, resolved through `PATH` unless it names a file. */
  ffmpegPath: string
  /** Seconds of a clip's sound that are transcribed, from its start; 0 turns transcription off. */
  transcribeMaxSeconds: number
  /** Wall-clock limit for decoding one clip's sound before it is described without a transcript. */
  decodeTimeoutMs: number
}

export const Config: z<Partial<Config>, Config> = z.object({
  ffprobePath: z.string().default('ffprobe'),
  probeTimeoutMs: z.natural().min(1).default(15_000),
  ffmpegPath: z.string().default('ffmpeg'),
  transcribeMaxSeconds: z.natural().default(600),
  decodeTimeoutMs: z.natural().min(1).default(60_000),
  probeDirectory: z.string(),
  probeRunner: z.array(z.string()),
})

/** Provider id registered on `ctx.documentExtract`. */
export const PROVIDER_ID = 'video' as DocumentExtractProviderId

/** Recorded with stored text; bump when the reported facts change. */
const EXTRACTOR_VERSION = '3'

/** Video and MP3 formats the composer can record or a browser can upload. */
export const VIDEO_FORMATS: DocumentFormats = {
  extensions: ['mp4', 'm4v', 'mov', 'webm', 'mp3'],
  mediaTypes: ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm', 'audio/mpeg', 'audio/mp3'],
}

/** Container names for the extensions this reader claims. */
const CONTAINERS: Readonly<Record<string, string>> = {
  mp4: 'MP4', m4v: 'MP4', mov: 'QuickTime', webm: 'WebM', mp3: 'MP3',
}

/** Facts one clip reports, in the order the sentence lists them. */
export interface ClipFacts {
  /** Duration in seconds, when the probe answered. */
  readonly seconds?: number
  /** Frame width and height in pixels, when the probe answered. */
  readonly width?: number
  readonly height?: number
  /** Video codec name, when the probe answered. */
  readonly codec?: string
  /** Container label resolved from the extension. */
  readonly container: string
  /** Encoded size in bytes. */
  readonly bytes: number
}

/**
 * One human-sized byte string.
 * @param bytes - encoded length.
 * @returns megabytes with one decimal, or kilobytes below one megabyte.
 */
function sizeText(bytes: number): string {
  return bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} kB` : `${(bytes / 1_000_000).toFixed(1)} MB`
}

/** What transcription made of a clip's sound. */
export interface ClipTranscript {
  /** Recognized speech; empty when no speech was recognized. */
  readonly text: string
  /** Seconds transcribed from the start, when only that part of a longer clip was transcribed. */
  readonly partialSeconds?: number
}

/**
 * The text stored with the clip and shown to the model.
 * @param name - display name of the uploaded file.
 * @param facts - what this deployment knows about the clip.
 * @param transcript - the transcription of its sound, or undefined when the sound was not transcribed.
 * @returns the file, the probed facts, the transcript or its absence, and the reader's limit.
 */
export function describeClip(name: string, facts: ClipFacts, transcript?: ClipTranscript): string {
  const details: string[] = []
  if (facts.seconds !== undefined) details.push(`${facts.seconds.toFixed(1)} s`)
  if (facts.width !== undefined && facts.height !== undefined) details.push(`${facts.width}×${facts.height}`)
  if (facts.codec !== undefined) details.push(facts.codec)
  details.push(facts.container, sizeText(facts.bytes))
  const audio = facts.container === 'MP3'
  const head = `${audio ? 'Audio' : 'Video'} clip "${name}": ${details.join(', ')}. The clip is stored with this session`
  const frames = audio ? '' : ' Its frames are not described.'
  if (transcript === undefined) return `${head}; its sound is not transcribed.${frames}`
  const span = transcript.partialSeconds === undefined ? '' : ` (first ${String(transcript.partialSeconds)} s)`
  if (transcript.text.trim() === '') return `${head}. No speech was recognized in its sound${span}.${frames}`
  return `${head}.${frames}\nTranscript of its sound${span}:\n${transcript.text.trim()}`
}

/** Probe output this reader reads back. */
interface ProbeOutput {
  readonly streams?: readonly { readonly codec_name?: string; readonly width?: number; readonly height?: number }[]
  readonly format?: { readonly duration?: string }
}

/**
 * Read one clip's facts through the probe, falling back to the container alone
 * when the binary is absent, slow, or answers with nothing usable.
 * @param data - the uploaded bytes.
 * @param extension - lowercase extension without the dot.
 * @param config - probe path and timeout.
 * @param signal - caller cancellation.
 * @param subprocess - the composed subprocess runtime, which starts the probe without
 *   forking the Host where it can; without one the probe runs through `execFile`.
 * @returns facts to describe, never a rejection for a failed probe.
 */
async function probe(
  data: Uint8Array,
  extension: string,
  config: Config,
  signal: AbortSignal,
  subprocess: SubprocessRuntime | undefined,
): Promise<ProbeFacts> {
  const directory = await mkdtemp(join(config.probeDirectory ?? tmpdir(), 'avn-clip-'))
  const file = join(directory, `clip.${extension}`)
  try {
    await writeFile(file, data)
    const probeArgv = [
      config.ffprobePath, '-v', 'error', '-select_streams', extension === 'mp3' ? 'a:0' : 'v:0',
      '-show_entries', 'stream=width,height,codec_name:format=duration',
      '-of', 'json', file,
    ]
    const argv = [...config.probeRunner ?? [], ...probeArgv] as [string, ...string[]]
    const stdout = subprocess === undefined
      ? (await promisify(execFile)(argv[0], argv.slice(1), { timeout: config.probeTimeoutMs, signal, maxBuffer: 1 << 20 })).stdout
      : await probeThrough(subprocess, argv, directory, config.probeTimeoutMs, signal)
    const parsed = JSON.parse(stdout) as ProbeOutput
    const stream = parsed.streams?.[0]
    const seconds = Number(parsed.format?.duration ?? Number.NaN)
    return {
      ...Number.isFinite(seconds) && seconds > 0 ? { seconds } : {},
      ...stream?.width === undefined ? {} : { width: stream.width },
      ...stream?.height === undefined ? {} : { height: stream.height },
      ...stream?.codec_name === undefined ? {} : { codec: stream.codec_name },
    }
  } catch {
    return {}
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/**
 * Run the probe through the subprocess runtime and return its stdout.
 * @param subprocess - the composed subprocess runtime.
 * @param argv - the probe argv, runner first.
 * @param cwd - the directory the clip was written to.
 * @param timeoutMs - wall-clock limit for the probe.
 * @param signal - caller cancellation.
 * @returns the probe's standard output.
 * @throws when the probe does not exit with status 0.
 */
async function probeThrough(
  subprocess: SubprocessRuntime,
  argv: readonly string[],
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<string> {
  const handle = subprocess.spawn({
    argv,
    cwd,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 1 << 20 }, stderr: { maxBytes: 64 * 1024 } },
    graceMs: 1_000,
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  })
  const outcome = await handle.done
  if (outcome.exitCode !== 0) throw new Error(`ffprobe exited with ${String(outcome.exitCode ?? outcome.signal)}`)
  return handle.collected.stdout?.readFrom(0).text ?? ''
}

/** Probed facts, all optional because the probe is best effort. */
type ProbeFacts = Pick<ClipFacts, 'seconds' | 'width' | 'height' | 'codec'>

/**
 * The container label for one clip.
 * @param extension - lowercase extension without the dot.
 * @returns the container name, or the raw extension when it is not a known one.
 */
function containerOf(extension: string): string {
  return CONTAINERS[extension] ?? extension.toUpperCase()
}

/**
 * Decode the first seconds of a clip's sound to the 16 kHz mono WAV speech recognizers take.
 * @param data - the uploaded bytes.
 * @param extension - lowercase extension without the dot.
 * @param config - decoder path, runner, length, and timeout.
 * @param signal - caller cancellation.
 * @param subprocess - the composed subprocess runtime, or undefined to run through `execFile`.
 * @returns the WAV bytes, or undefined when the clip has no decodable sound.
 */
async function decodeSpeech(
  data: Uint8Array,
  extension: string,
  config: Config,
  signal: AbortSignal,
  subprocess: SubprocessRuntime | undefined,
): Promise<Uint8Array | undefined> {
  const directory = await mkdtemp(join(config.probeDirectory ?? tmpdir(), 'avn-clip-'))
  const file = join(directory, `clip.${extension}`)
  const wav = join(directory, 'speech.wav')
  try {
    await writeFile(file, data)
    const decodeArgv = [
      config.ffmpegPath, '-v', 'error', '-nostdin', '-i', file, '-vn', '-ac', '1', '-ar', '16000',
      '-t', String(config.transcribeMaxSeconds), '-f', 'wav', wav,
    ]
    const argv = [...config.probeRunner ?? [], ...decodeArgv] as [string, ...string[]]
    if (subprocess === undefined) {
      await promisify(execFile)(argv[0], argv.slice(1), { timeout: config.decodeTimeoutMs, signal, maxBuffer: 1 << 20 })
    } else {
      await probeThrough(subprocess, argv, directory, config.decodeTimeoutMs, signal)
    }
    const bytes = new Uint8Array(await readFile(wav))
    // A WAV header alone carries no sound to recognize.
    return bytes.byteLength > 44 ? bytes : undefined
  } catch {
    // A clip without a sound track, or a decoder that is absent or fails, is described without a transcript.
    return undefined
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/**
 * Transcribe a clip's sound with the deployment's speech-to-text, when it mounts one and voice input is on.
 * @param ctx - plugin context, read for the optional `speechToText` and `subprocess` services.
 * @param input - the clip.
 * @param config - decoder policy.
 * @param seconds - the clip's probed duration, when known.
 * @param signal - caller cancellation.
 * @returns the transcript, or undefined when transcription is unavailable, off, or failed.
 */
async function transcribeClip(
  ctx: Context,
  input: DocumentExtractInput,
  config: Config,
  seconds: number | undefined,
  signal: AbortSignal,
): Promise<ClipTranscript | undefined> {
  const speech = ctx.get('speechToText')
  if (speech === undefined || config.transcribeMaxSeconds === 0) return undefined
  const audio = await decodeSpeech(input.data, input.extension, config, signal, ctx.get('subprocess'))
  if (audio === undefined) return undefined
  try {
    const transcript = await speech.transcribe(speech.resolve({ audio }), signal)
    const partial = seconds !== undefined && seconds > config.transcribeMaxSeconds
    return { text: transcript.text, ...partial ? { partialSeconds: config.transcribeMaxSeconds } : {} }
  } catch (error) {
    signal.throwIfAborted()
    // Voice input turned off, an unprepared or failing recognizer: the clip is described without a transcript.
    ctx.logger('document-extract-video').warn('clip transcription failed: %s', error instanceof Error ? error.message : String(error))
    return undefined
  }
}

/**
 * Register the video reader.
 * @param ctx - plugin context carrying `documentExtract`.
 * @param config - probe policy.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.documentExtract.register({
    info: { id: PROVIDER_ID, version: EXTRACTOR_VERSION, formats: VIDEO_FORMATS, priority: 10 },
    extract: async (input: DocumentExtractInput, signal: AbortSignal): Promise<ExtractedDocument> => {
      const context = await probe(input.data, input.extension, config, signal, ctx.get('subprocess'))
      signal.throwIfAborted()
      const transcript = await transcribeClip(ctx, input, config, context.seconds, signal)
      signal.throwIfAborted()
      return {
        text: describeClip(input.name, { ...context, container: containerOf(input.extension), bytes: input.data.byteLength }, transcript),
        method: 'native',
      }
    },
  }), 'document-extract-video: provider')
}
