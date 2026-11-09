/**
 * The user's MP4 exports: one render per folder or call, joined by every request that asks for it while it runs,
 * with its progress reported to each request that is still waiting, and an export reused as long as nothing in its
 * folder changed since it was written.
 * @module
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { MOTION_QUEUED_STAGE, type MotionProgress, type MotionQuality, type MotionRenderOutput } from '@aeven/motion'

/** How far one export has come, as a request that is still waiting reports it. */
export interface ExportProgress {
  /** Share of the render done, from 0 to 1. */
  readonly fraction: number
  /** Whether the render waits for another render on the same renderer to finish. */
  readonly queued: boolean
}

/** The facts of a finished export that a reused one reports without rendering. */
export type ExportedFilm = Pick<MotionRenderOutput, 'outputPath' | 'bytes' | 'durationSeconds' | 'width' | 'height'>

/** What a waiting request learns: the film, the render's failure, or how far it has come. */
export type ExportOutcome =
  | { readonly film: ExportedFilm }
  | { readonly error: unknown }
  | { readonly pending: ExportProgress }

interface Job {
  readonly done: Promise<ExportedFilm>
  /** The render's latest progress, updated as the renderer reports it. */
  readonly progress: { current: ExportProgress }
}

/**
 * Renders in progress by key, so a repeated request joins the running render and reads its progress.
 */
export class ExportJobs {
  private readonly jobs = new Map<string, Job>()

  /**
   * @param waitMs - how long one request waits before it answers with the render's progress.
   */
  constructor(private readonly waitMs: number) {}

  /**
   * Join the render running under `key`, or start one.
   * @param key - the folder or call the export is for.
   * @param start - starts the render, reporting its progress.
   * @returns the outcome once the render settles, or its progress after `waitMs`.
   */
  async request(key: string, start: (onProgress: (progress: MotionProgress) => void) => Promise<ExportedFilm>): Promise<ExportOutcome> {
    let job = this.jobs.get(key)
    if (job === undefined) {
      const progress = { current: { fraction: 0, queued: false } }
      const done = start((update) => {
        progress.current = { fraction: update.fraction, queued: update.stage === MOTION_QUEUED_STAGE }
      })
      const started: Job = { done, progress }
      this.jobs.set(key, started)
      // A finished render nobody asks for again is dropped once a waiting card would have asked.
      void done.catch(() => undefined).finally(() => {
        setTimeout(() => { if (this.jobs.get(key) === started) this.jobs.delete(key) }, this.waitMs * 3)
      })
      job = started
    }
    const current = job
    const waited = await Promise.race([
      current.done.then(film => ({ film }), (error: unknown) => ({ error })),
      new Promise<undefined>((settle) => { setTimeout(settle, this.waitMs) }),
    ])
    if (waited === undefined) return { pending: current.progress.current }
    if (this.jobs.get(key) === current) this.jobs.delete(key)
    return waited
  }
}

/** Cap on the entries a freshness check walks; a larger folder is treated as changed. */
const MAX_ENTRIES = 10_000

/** The sidecar beside an export recording what it was rendered as. */
function sidecarPath(outputPath: string): string {
  return join(dirname(outputPath), `.${basename(outputPath)}.json`)
}

/** What the sidecar records. */
interface Sidecar extends ExportedFilm {
  readonly quality: MotionQuality
  /** The export's modification time when it was written. */
  readonly mtimeMs: number
}

/**
 * The newest modification time of any file in the folder outside its `renders/` output, or undefined when the
 * folder holds more than {@link MAX_ENTRIES} entries.
 */
async function newestSource(dir: string): Promise<number | undefined> {
  let newest = 0
  let seen = 0
  const queue = [dir]
  while (queue.length > 0) {
    const next = queue.shift() as string
    const entries = await readdir(next, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      seen += 1
      if (seen > MAX_ENTRIES) return undefined
      const path = join(next, entry.name)
      if (entry.isDirectory()) {
        if (!(next === dir && entry.name === 'renders')) queue.push(path)
        continue
      }
      const info = await stat(path).catch(() => undefined)
      if (info !== undefined && info.mtimeMs > newest) newest = info.mtimeMs
    }
  }
  return newest
}

/**
 * The export already on disk when it was rendered at `quality` after the last change to any file in its folder.
 * @param dir - composition folder.
 * @param outputPath - the export's path inside `renders/`.
 * @param quality - the quality an export must have been rendered at.
 * @returns the export's facts, or undefined when it must be rendered again.
 */
export async function freshExport(dir: string, outputPath: string, quality: MotionQuality): Promise<ExportedFilm | undefined> {
  const [output, recorded] = await Promise.all([
    stat(outputPath).catch(() => undefined),
    readFile(sidecarPath(outputPath), 'utf8').then(text => JSON.parse(text) as Partial<Sidecar>, () => undefined),
  ])
  if (output === undefined || recorded?.quality !== quality || recorded.mtimeMs !== output.mtimeMs) return undefined
  if (typeof recorded.durationSeconds !== 'number' || typeof recorded.width !== 'number' || typeof recorded.height !== 'number') return undefined
  const newest = await newestSource(dir)
  if (newest === undefined || newest >= output.mtimeMs) return undefined
  return { outputPath, bytes: output.size, durationSeconds: recorded.durationSeconds, width: recorded.width, height: recorded.height }
}

/**
 * Record what an export was rendered as, so an unchanged folder's next export reuses it.
 * @param film - the finished export.
 * @param quality - the quality it was rendered at.
 * @returns after the sidecar is written; a failure to write it only costs the next export a render.
 */
export async function recordExport(film: ExportedFilm, quality: MotionQuality): Promise<void> {
  const output = await stat(film.outputPath).catch(() => undefined)
  if (output === undefined) return
  const sidecar: Sidecar = {
    outputPath: film.outputPath,
    bytes: output.size,
    durationSeconds: film.durationSeconds,
    width: film.width,
    height: film.height,
    quality,
    mtimeMs: output.mtimeMs,
  }
  await writeFile(sidecarPath(film.outputPath), JSON.stringify(sidecar)).catch(() => undefined)
}
