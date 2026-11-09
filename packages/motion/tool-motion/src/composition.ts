/**
 * Static reading of a HyperFrames composition folder, without a browser: the film's length and the scene windows
 * its `index.html` hosts, and the structural problems that would make a render stall or show a half-built film.
 * @module
 */
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** One scene the root composition hosts. */
export interface SceneWindow {
  /** The host element's id, which is also the scene's composition id. */
  readonly id: string
  /** Scene file, relative to the composition folder. */
  readonly src: string
  /** Film time the scene starts at, in seconds. */
  readonly start: number
  /** How long the scene shows, in seconds. */
  readonly duration: number
}

/** What a composition folder states about its film. */
export interface CompositionFacts {
  /** The root's `data-duration`, in seconds. */
  readonly durationSeconds: number
  /** The scenes the root hosts, in document order. */
  readonly scenes: readonly SceneWindow[]
}

/** Every opening tag in a document, with its attribute text. */
const TAG = /<([a-zA-Z][\w-]*)\b([^>]*)>/g

/** One `name="value"` or `name='value'` attribute. */
const ATTRIBUTE = /([\w-]+)\s*=\s*("([^"]*)"|'([^']*)')/g

/** The attributes of one tag's attribute text. */
function attributes(text: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of text.matchAll(ATTRIBUTE)) found.set(match[1] ?? '', match[3] ?? match[4] ?? '')
  return found
}

/** A finite, non-negative number an attribute spells, or undefined. */
function seconds(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

/** Seconds a scene may overrun the film before it counts as a problem, absorbing rounding in hand-written times. */
const TOLERANCE = 0.01

/**
 * Read a composition folder's film length and scene windows, and refuse one that cannot render as written.
 * @param dir - absolute composition folder.
 * @returns the film's length and scenes.
 * @throws When `index.html` is missing, names no root length, or hosts a scene whose file is missing or whose
 *   window falls outside the film; the message lists every problem found.
 */
export async function readComposition(dir: string): Promise<CompositionFacts> {
  const html = await readFile(join(dir, 'index.html'), 'utf8').catch(() => undefined)
  if (html === undefined) throw new Error('the folder has no index.html')
  const problems: string[] = []
  let durationSeconds: number | undefined
  const scenes: SceneWindow[] = []
  for (const match of html.matchAll(TAG)) {
    const attrs = attributes(match[2] ?? '')
    if (attrs.get('data-composition-id') === 'main' && durationSeconds === undefined) {
      durationSeconds = seconds(attrs.get('data-duration'))
      if (durationSeconds === undefined || durationSeconds === 0) problems.push('the root (data-composition-id="main") has no data-duration above 0')
      continue
    }
    const src = attrs.get('data-composition-src')
    if (src === undefined) continue
    const id = attrs.get('id') ?? attrs.get('data-composition-id') ?? src
    const start = seconds(attrs.get('data-start'))
    const duration = seconds(attrs.get('data-duration'))
    if (start === undefined || duration === undefined) {
      problems.push(`scene "${id}" needs data-start and data-duration`)
      continue
    }
    scenes.push({ id, src, start, duration })
  }
  if (durationSeconds === undefined && !problems.some(problem => problem.startsWith('the root'))) {
    problems.push('index.html has no root element with data-composition-id="main"')
  }
  await Promise.all(scenes.map(async (scene) => {
    const file = await stat(join(dir, scene.src)).catch(() => undefined)
    if (file?.isFile() !== true) problems.push(`scene "${scene.id}" names ${scene.src}, which does not exist`)
  }))
  if (durationSeconds !== undefined) {
    for (const scene of scenes) {
      if (scene.start + scene.duration > durationSeconds + TOLERANCE) {
        problems.push(`scene "${scene.id}" runs to ${String(scene.start + scene.duration)} s, past the film's ${String(durationSeconds)} s`)
      }
    }
  }
  if (problems.length > 0 || durationSeconds === undefined) throw new Error(`the composition cannot render as written: ${problems.join('; ')}`)
  return { durationSeconds, scenes }
}

/**
 * Evenly spaced times inside a window, each at the middle of its equal share so neither edge is taken.
 * @param start - window start, in seconds.
 * @param length - window length, in seconds.
 * @param count - number of times.
 * @returns the times, rounded to milliseconds.
 */
export function spacedTimes(start: number, length: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => Math.round((start + (index + 0.5) * length / count) * 1000) / 1000)
}
