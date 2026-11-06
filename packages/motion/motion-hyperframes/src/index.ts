/**
 * HyperFrames renderer for `ctx.motion`. Chromium captures the composition frame by frame and the bundled,
 * LGPL-only ffmpeg encodes H.264. Where HyperFrames finds a working hardware encoder the bundled ffmpeg
 * carries (VideoToolbox on macOS, VAAPI on Linux) it writes the MP4 directly; elsewhere it writes a ProRes
 * intermediate that the first working fallback encoder (Media Foundation on Windows, OpenH264 on Linux)
 * re-encodes to H.264.
 * @module @aeven/motion-hyperframes
 */
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { MotionProgress, MotionQuality, MotionRenderInput, MotionRenderOutput } from '@aeven/motion'
import type {} from '@aeven/motion'
import { detectGpuEncoder } from '@hyperframes/engine'
import { createRenderJob, executeRenderJob, resolveConfig } from '@hyperframes/producer'
import type { ProducerLogger, RenderJob } from '@hyperframes/producer'
import { resolveFfBinaries } from './binaries.ts'
import type { FfBinaries } from './binaries.ts'
import { resolveBrowser } from './browser.ts'
import { firstWorkingEncoder, probeFilm, takeStills, transcode } from './encode.ts'

export const name = 'motion-hyperframes'
export const inject = ['motion']

/** ProRes profiles the intermediate may use; all are 4:2:2 without alpha. */
export type IntermediateProfile = 'hq' | '422' | 'lt'

export interface Config {
  /** ffmpeg executable; omitted, the bundled `@aeven/ffmpeg-<platform>-<arch>` copy. */
  ffmpegPath?: string
  /** ffprobe executable; omitted, the bundled copy beside ffmpeg. */
  ffprobePath?: string
  /** Chromium executable; omitted, an installed Chrome, Chromium, Edge, or Brave, else a downloaded headless shell. */
  browserPath?: string
  /** Directory the downloaded headless shell is installed into. */
  browserCacheDir: string
  /** H.264 encoders tried in order when HyperFrames finds no hardware encoder. */
  fallbackEncoders: string[]
  /** ProRes profile of the intermediate the fallback encoder reads. */
  intermediateProfile: IntermediateProfile
  /** Fallback encoder video bitrate per quality tier. */
  fallbackBitrate: Record<MotionQuality, string>
  /** Width in pixels of the stills a render returns. */
  stillWidth: number
}

export const Config: z<Config> = z.object({
  ffmpegPath: z.string(),
  ffprobePath: z.string(),
  browserPath: z.string(),
  browserCacheDir: z.string().required(),
  fallbackEncoders: z.array(z.string()).default(['h264_mf', 'libopenh264']),
  intermediateProfile: z.union(['hq', '422', 'lt'] as const).default('422'),
  fallbackBitrate: z.object({
    draft: z.string().default('6M'),
    standard: z.string().default('12M'),
    high: z.string().default('20M'),
  }),
  stillWidth: z.natural().min(64).default(960),
})

/** How a host encodes H.264: HyperFrames' hardware path, or a ProRes intermediate plus a fallback encoder. */
type EncodePath = { readonly kind: 'direct'; readonly encoder: string } | { readonly kind: 'transcode'; readonly encoder: string }

/**
 * The headless shell build matching the Puppeteer that HyperFrames drives, read from that Puppeteer's revisions.
 * @returns a Chrome for Testing build id.
 */
async function headlessShellBuildId(): Promise<string> {
  const producer = fileURLToPath(import.meta.resolve('@hyperframes/producer'))
  const revisions = createRequire(producer).resolve('puppeteer-core/internal/revisions.js')
  const loaded = await import(pathToFileURL(revisions).href) as { PUPPETEER_REVISIONS: Record<string, string> }
  const build = loaded.PUPPETEER_REVISIONS['chrome-headless-shell']
  if (build === undefined) throw new Error('motion-hyperframes: Puppeteer names no chrome-headless-shell build')
  return build
}

/**
 * Route HyperFrames' log lines to the plugin logger; its per-frame info lines become debug lines.
 * @param ctx - plugin context.
 * @returns a producer logger.
 */
function producerLogger(ctx: Context): ProducerLogger {
  const logger = ctx.logger(name)
  const line = (message: string, meta?: Record<string, unknown>): string => meta === undefined ? message : `${message} ${JSON.stringify(meta)}`
  return {
    error: (message, meta) => { logger.error(line(message, meta)) },
    warn: (message, meta) => { logger.warn(line(message, meta)) },
    info: (message, meta) => { logger.debug(line(message, meta)) },
    debug: (message, meta) => { logger.debug(line(message, meta)) },
  }
}

/**
 * Register the HyperFrames renderer. The ffmpeg and ffprobe paths resolve at load, so a host without them fails
 * here; the browser and the encode path resolve on the first render and are reused after it succeeds.
 * @param ctx - plugin context carrying `ctx.motion`.
 * @param config - executables, browser cache, and fallback encoding.
 */
export function apply(ctx: Context, config: Config): void {
  const binaries: FfBinaries = resolveFfBinaries(config)
  const logger = producerLogger(ctx)

  // HyperFrames reads its ffmpeg and ffprobe paths from these process variables on every call; the Host
  // process has no other HyperFrames user, so the plugin owns them for its lifetime.
  ctx.effect(() => {
    const previous = { ffmpeg: process.env.HYPERFRAMES_FFMPEG_PATH, ffprobe: process.env.HYPERFRAMES_FFPROBE_PATH }
    process.env.HYPERFRAMES_FFMPEG_PATH = binaries.ffmpeg
    process.env.HYPERFRAMES_FFPROBE_PATH = binaries.ffprobe
    return () => {
      if (previous.ffmpeg === undefined) delete process.env.HYPERFRAMES_FFMPEG_PATH
      else process.env.HYPERFRAMES_FFMPEG_PATH = previous.ffmpeg
      if (previous.ffprobe === undefined) delete process.env.HYPERFRAMES_FFPROBE_PATH
      else process.env.HYPERFRAMES_FFPROBE_PATH = previous.ffprobe
    }
  }, 'motion-hyperframes: ffmpeg paths')

  let browser: Promise<string> | undefined
  let encodePath: Promise<EncodePath> | undefined
  const memo = <T>(current: Promise<T> | undefined, make: () => Promise<T>, store: (value: Promise<T> | undefined) => void): Promise<T> => {
    if (current !== undefined) return current
    const created = make()
    store(created)
    created.catch(() => { store(undefined) })
    return created
  }

  const chooseEncodePath = async (signal: AbortSignal): Promise<EncodePath> => {
    const gpu = await detectGpuEncoder()
    if (gpu !== null) return { kind: 'direct', encoder: `h264_${gpu}` }
    const fallback = await firstWorkingEncoder(binaries.ffmpeg, config.fallbackEncoders, signal)
    if (fallback === undefined) {
      throw new Error(`No H.264 encoder works on this ${process.platform} machine: no hardware encoder answered `
        + `and none of ${config.fallbackEncoders.join(', ')} encoded a test frame.`)
    }
    return { kind: 'transcode', encoder: fallback }
  }

  // One render at a time: each one runs a Chromium capture and an encoder that already use every core.
  let queue: Promise<unknown> = Promise.resolve()

  const render = async (
    input: MotionRenderInput, signal: AbortSignal, onProgress?: (progress: MotionProgress) => void,
  ): Promise<MotionRenderOutput> => {
    const chromePath = await memo(browser, async () => resolveBrowser({
      browserPath: config.browserPath,
      cacheDir: config.browserCacheDir,
      headlessShellBuildId: await headlessShellBuildId(),
    }, signal), (value) => { browser = value })
    const path = await memo(encodePath, () => chooseEncodePath(signal), (value) => { encodePath = value })
    const progress = (job: RenderJob): void => {
      onProgress?.({ fraction: Math.min(1, job.progress / 100), stage: job.currentStage })
    }
    const base = {
      fps: input.fps,
      quality: input.quality,
      producerConfig: { ...resolveConfig(), chromePath },
      logger,
    }
    if (path.kind === 'direct') {
      const job = createRenderJob({ ...base, format: 'mp4', useGpu: true })
      await executeRenderJob(job, input.compositionDir, input.outputPath, progress, signal)
    } else {
      const scratch = await mkdtemp(join(tmpdir(), 'avn-motion-'))
      try {
        const intermediate = join(scratch, 'intermediate.mov')
        const job = createRenderJob({ ...base, format: 'mov', proresProfile: config.intermediateProfile })
        await executeRenderJob(job, input.compositionDir, intermediate, progress, signal)
        onProgress?.({ fraction: 1, stage: 'encode' })
        await transcode(binaries.ffmpeg, intermediate, input.outputPath, path.encoder, config.fallbackBitrate[input.quality], signal)
      } catch (error) {
        await rm(input.outputPath, { force: true })
        throw error
      } finally {
        await rm(scratch, { recursive: true, force: true })
      }
    }
    const facts = await probeFilm(binaries.ffprobe, input.outputPath, signal)
    const { size } = await stat(input.outputPath)
    const stills = await takeStills(binaries.ffmpeg, input.outputPath, facts.durationSeconds, input.stills, config.stillWidth, signal)
    return { outputPath: input.outputPath, bytes: size, encoder: path.encoder, stills, ...facts }
  }

  ctx.effect(() => ctx.motion.register({
    name: 'HyperFrames',
    render: (input, signal, onProgress) => {
      const next = queue.then(() => render(input, signal, onProgress))
      queue = next.catch(() => {})
      return next
    },
  }), 'motion-hyperframes: renderer')
}
