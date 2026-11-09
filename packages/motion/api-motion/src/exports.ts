/**
 * The user's MP4 exports: one render per folder or call, joined by every request that asks for it while it runs,
 * with its progress reported to each request that is still waiting.
 * @module
 */
import { MOTION_QUEUED_STAGE, type MotionProgress, type RenderedFilm } from '@aeven/motion'

/** How far one export has come, as a request that is still waiting reports it. */
export interface ExportProgress {
  /** Share of the render done, from 0 to 1. */
  readonly fraction: number
  /** Whether the render waits for another render on the same renderer to finish. */
  readonly queued: boolean
}

/** The facts of a finished export. */
export type ExportedFilm = RenderedFilm

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
