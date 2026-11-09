/**
 * Rendered films on disk and whether they still match their composition: each render records the quality it was
 * made at and its modification time in a sidecar beside it, and counts as current while no file of the folder
 * outside `renders/` changed since. The user's export reuses a current export or a current review render instead
 * of rendering the film again.
 * @module
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { MotionQuality, MotionRenderOutput } from './index.ts'

/** The facts of a finished film that a reused one reports without rendering. */
export type RenderedFilm = Pick<MotionRenderOutput, 'outputPath' | 'bytes' | 'durationSeconds' | 'width' | 'height'>

/** Cap on the entries a freshness check walks; a larger folder is treated as changed. */
const MAX_ENTRIES = 10_000

/** The sidecar beside a film recording what it was rendered as. */
function sidecarPath(outputPath: string): string {
  return join(dirname(outputPath), `.${basename(outputPath)}.json`)
}

/** What the sidecar records. */
interface Sidecar extends RenderedFilm {
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
 * A film already on disk that was rendered at `quality` after the last change to any file in its folder.
 * @param dir - composition folder.
 * @param outputPath - the film's path inside `renders/`.
 * @param quality - the quality the film must have been rendered at.
 * @returns the film's facts, or undefined when it must be rendered again.
 */
export async function currentRender(dir: string, outputPath: string, quality: MotionQuality): Promise<RenderedFilm | undefined> {
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
 * Record what a film was rendered as, so an export of the unchanged folder reuses it.
 * @param film - the finished film.
 * @param quality - the quality it was rendered at.
 * @returns after the sidecar is written; a failure to write it only costs the next export a render.
 */
export async function recordRender(film: RenderedFilm, quality: MotionQuality): Promise<void> {
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
