/**
 * The user's MP4 exports: requests join one render and read its progress while it runs, a render waiting for
 * another reports so, and a rendered film is reused only while no file of its folder changed since it was made.
 */
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { currentRender, MOTION_QUEUED_STAGE, recordRender, type MotionProgress } from '@aeven/motion'
import { ExportJobs, type ExportedFilm } from '../src/exports.ts'

let dir: string | undefined

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

/** A render the case finishes by hand, with the progress sink the job gave it. */
function controlledRender() {
  let finish!: (film: ExportedFilm) => void
  let report!: (progress: MotionProgress) => void
  let starts = 0
  const start = (onProgress: (progress: MotionProgress) => void): Promise<ExportedFilm> => {
    starts += 1
    report = onProgress
    return new Promise((resolve) => { finish = resolve })
  }
  return { start, finish: (film: ExportedFilm) => { finish(film) }, report: (p: MotionProgress) => { report(p) }, starts: () => starts }
}

const FILM: ExportedFilm = { outputPath: '/films/a.mp4', bytes: 10, durationSeconds: 4, width: 1920, height: 1080 }

describe('ExportJobs', () => {
  it('answers a waiting request with the render\'s progress, and joins later requests to the same render', async () => {
    const jobs = new ExportJobs(20)
    const render = controlledRender()
    expect(await jobs.request('a', render.start)).toEqual({ pending: { fraction: 0, queued: false } })
    render.report({ fraction: 0.42, stage: 'Capturing frame 1260/3000' })
    expect(await jobs.request('a', render.start)).toEqual({ pending: { fraction: 0.42, queued: false } })
    render.finish(FILM)
    expect(await jobs.request('a', render.start)).toEqual({ film: FILM })
    expect(render.starts()).toBe(1)
  })

  it('reports a render that waits for another one', async () => {
    const jobs = new ExportJobs(20)
    const render = controlledRender()
    const first = jobs.request('a', render.start)
    render.report({ fraction: 0, stage: MOTION_QUEUED_STAGE })
    expect(await first).toEqual({ pending: { fraction: 0, queued: true } })
  })

  it('hands back the render\'s failure', async () => {
    const jobs = new ExportJobs(50)
    const outcome = await jobs.request('a', () => Promise.reject(new Error('no encoder')))
    expect('error' in outcome && String(outcome.error)).toContain('no encoder')
  })
})

describe('currentRender', () => {
  async function exported(): Promise<{ folder: string; output: string }> {
    dir = await mkdtemp(join(tmpdir(), 'avn-motion-export-'))
    await mkdir(join(dir, 'compositions'))
    await mkdir(join(dir, 'renders'))
    await writeFile(join(dir, 'index.html'), '<div></div>')
    await writeFile(join(dir, 'compositions', 'intro.html'), '<template></template>')
    const past = new Date(Date.now() - 60_000)
    await utimes(join(dir, 'index.html'), past, past)
    await utimes(join(dir, 'compositions', 'intro.html'), past, past)
    const output = join(dir, 'renders', 'film.mp4')
    await writeFile(output, 'MP4')
    await recordRender({ outputPath: output, bytes: 3, durationSeconds: 4, width: 1920, height: 1080 }, 'high')
    return { folder: dir, output }
  }

  it('reuses an export no file of its folder changed since', async () => {
    const { folder, output } = await exported()
    expect(await currentRender(folder, output, 'high')).toEqual({ outputPath: output, bytes: 3, durationSeconds: 4, width: 1920, height: 1080 })
  })

  it('renders again after a scene changes, or at another quality', async () => {
    const { folder, output } = await exported()
    expect(await currentRender(folder, output, 'standard')).toBeUndefined()
    const later = new Date(Date.now() + 60_000)
    await utimes(join(folder, 'compositions', 'intro.html'), later, later)
    expect(await currentRender(folder, output, 'high')).toBeUndefined()
  })

  it('renders again when the export was replaced by another render', async () => {
    const { folder, output } = await exported()
    const later = new Date(Date.now() + 60_000)
    await utimes(output, later, later)
    expect(await currentRender(folder, output, 'high')).toBeUndefined()
  })
})
