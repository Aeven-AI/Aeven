/**
 * Running the benchmark.
 *
 * The properties under test are that a report renders from the figures a run
 * assembled, and that a task whose run fails — including in a way that is not an
 * Error — is reported as skipped with its reason rather than escaping the caller.
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

  it('reports a failure that is not an Error as the reason the task could not run', async () => {
    const result = await measureTask(
      { book: STARTER_BOOK, tasks: [], onCall: () => { throw 'the observer gave up' } },
      { task: 'file.exists', platform: 'darwin', parameters: { path: tmpdir() } },
    )
    expect(result.skipped).toBe('could not run here: the observer gave up')
    expect(result.measuredCalls).toBeUndefined()
  })
})
