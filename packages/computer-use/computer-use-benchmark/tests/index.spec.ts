/**
 * Running the benchmark.
 *
 * The properties under test are that a report renders from the figures a run
 * assembled, and that a failure inside a run is contained: the mechanism call it
 * reached is counted, and nothing escapes the caller.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STARTER_BOOK } from '@aeven/computer-use-router'
import { measureTask, renderBenchmark, runBenchmark, type BenchmarkTask } from '../src/index.ts'

describe('rendering a benchmark', () => {
  it('renders a report listing the measured and the skipped tasks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aeven-bench-render-'))
    try {
      const tasks: BenchmarkTask[] = [
        { task: 'file.exists', platform: 'darwin', parameters: { path: dir } },
        { task: 'spreadsheet.setCell', platform: 'win32', parameters: { cell: 'A1', value: '1' }, skip: 'no Windows host' },
      ]
      const text = renderBenchmark(await runBenchmark({ book: STARTER_BOOK, tasks }))
      expect(text).toContain('measured total: 1 call(s) across 1 task(s)')
      expect(text).toContain('skipped: no Windows host')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('counts a run whose observed step failed as a measured call', async () => {
    const result = await measureTask(
      { book: STARTER_BOOK, tasks: [], onCall: () => { throw 'the observer gave up' } },
      { task: 'file.exists', platform: 'darwin', parameters: { path: tmpdir() } },
    )
    // Divergence: the module doc says a task that cannot run here is reported as skipped with its
    // reason; run() contains the failing step, so the run resolves, its one mechanism call counts,
    // and the observer's own failure reaches no one.
    expect(result).toEqual({
      task: 'file.exists',
      platform: 'darwin',
      measuredEvidence: 'measured',
      baselineEvidence: 'recorded',
      measuredCalls: 1,
    })
  })
})
