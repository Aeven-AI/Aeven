/**
 * Video reader: claims recorded and uploaded clips so a composer can attach
 * them, and reports what this deployment knows about the file — duration,
 * frame size, and codec when `ffprobe` answers, the container and size always.
 * Frames and sound are not transcribed, so the text never implies the model
 * watched the clip.
 * @module @aeven/document-extract-video
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@aeven/document-extract'
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
}

export const Config: z<Partial<Config>, Config> = z.object({
  ffprobePath: z.string().default('ffprobe'),
  probeTimeoutMs: z.natural().min(1).default(15_000),
})

/** Provider id registered on `ctx.documentExtract`. */
export const PROVIDER_ID = 'video' as DocumentExtractProviderId

/** Recorded with stored text; bump when the reported facts change. */
const EXTRACTOR_VERSION = '1'

/** Clip formats the composer can record or a browser can upload. */
export const VIDEO_FORMATS: DocumentFormats = {
  extensions: ['mp4', 'm4v', 'mov', 'webm'],
  mediaTypes: ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm'],
}

/** Container names for the extensions this reader claims. */
const CONTAINERS: Readonly<Record<string, string>> = {
  mp4: 'MP4', m4v: 'MP4', mov: 'QuickTime', webm: 'WebM',
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

/**
 * The sentence stored with the clip and shown to the model.
 * @param name - display name of the uploaded file.
 * @param facts - what this deployment knows about the clip.
 * @returns one line naming the file, the probed facts, and the reader's limit.
 */
export function describeClip(name: string, facts: ClipFacts): string {
  const details: string[] = []
  if (facts.seconds !== undefined) details.push(`${facts.seconds.toFixed(1)} s`)
  if (facts.width !== undefined && facts.height !== undefined) details.push(`${facts.width}×${facts.height}`)
  if (facts.codec !== undefined) details.push(facts.codec)
  details.push(facts.container, sizeText(facts.bytes))
  return `Video clip "${name}": ${details.join(', ')}. The clip is stored with this session; its frames and sound are not transcribed.`
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
 * @returns facts to describe, never a rejection for a failed probe.
 */
async function probe(data: Uint8Array, extension: string, config: Config, signal: AbortSignal): Promise<ProbeFacts> {
  const directory = await mkdtemp(join(tmpdir(), 'avn-clip-'))
  const file = join(directory, `clip.${extension}`)
  try {
    await writeFile(file, data)
    const { stdout } = await promisify(execFile)(config.ffprobePath, [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,codec_name:format=duration',
      '-of', 'json', file,
    ], { timeout: config.probeTimeoutMs, signal, maxBuffer: 1 << 20 })
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
 * Register the video reader.
 * @param ctx - plugin context carrying `documentExtract`.
 * @param config - probe policy.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.documentExtract.register({
    info: { id: PROVIDER_ID, version: EXTRACTOR_VERSION, formats: VIDEO_FORMATS, priority: 10 },
    extract: async (input: DocumentExtractInput, signal: AbortSignal): Promise<ExtractedDocument> => {
      const context = await probe(input.data, input.extension, config, signal)
      signal.throwIfAborted()
      return {
        text: describeClip(input.name, { ...context, container: containerOf(input.extension), bytes: input.data.byteLength }),
        method: 'native',
      }
    },
  }), 'document-extract-video: provider')
}
