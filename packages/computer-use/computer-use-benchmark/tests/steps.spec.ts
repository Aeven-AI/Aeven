/**
 * The step-count benchmark.
 *
 * The rule under test is that only what could be run is reported as measured, and
 * everything else says why. A benchmark that quietly omits the tasks it could not
 * reach would overstate the result, and the two platforms it cannot reach here are
 * precisely the ones whose adapters remain unverified.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STARTER_BOOK, type RecipeBook } from '@aeven/computer-use-router'
import {
  buildReport,
  formatReport,
  measureTask,
  RECORDED_VISION_BASELINES,
  runBenchmark,
  stepRatio,
  type BenchmarkTask,
  type StepComparison,
} from '../src/index.ts'

const comparison = (overrides: Partial<StepComparison> = {}): StepComparison => ({
  task: 't',
  platform: 'darwin',
  measuredEvidence: 'measured',
  baselineEvidence: 'recorded',
  ...overrides,
})

describe('step ratios', () => {
  it('reports how many times fewer steps the measured path needed', () => {
    expect(stepRatio(comparison({ measuredCalls: 1, recordedVisionCalls: 20 }))).toBe(20)
    expect(stepRatio(comparison({ measuredCalls: 4, recordedVisionCalls: 20 }))).toBe(5)
  })

  it('refuses to compute a ratio without both figures', () => {
    expect(stepRatio(comparison({ measuredCalls: 1 }))).toBeUndefined()
    expect(stepRatio(comparison({ recordedVisionCalls: 20 }))).toBeUndefined()
  })

  it('refuses to divide by zero rather than reporting infinity', () => {
    expect(stepRatio(comparison({ measuredCalls: 0, recordedVisionCalls: 20 }))).toBeUndefined()
  })
})

describe('report assembly', () => {
  it('totals only what was measured', () => {
    const report = buildReport([
      comparison({ task: 'a', measuredCalls: 1 }),
      comparison({ task: 'b', measuredCalls: 3 }),
      comparison({ task: 'c', skipped: 'no Windows host' }),
    ])
    expect(report.measuredTotal).toBe(4)
    expect(report.skipped).toBe(1)
  })

  it('totals only the baselines that have a measured counterpart', () => {
    const report = buildReport([
      comparison({ task: 'a', measuredCalls: 1, recordedVisionCalls: 20 }),
      comparison({ task: 'b', measuredCalls: 1 }),
    ])
    expect(report.comparedBaselineTotal).toBe(20)
  })

  it('renders a skipped task with its reason rather than dropping it', () => {
    const text = formatReport(buildReport([comparison({ task: 'spreadsheet.setCell', platform: 'win32', skipped: 'no Windows host' })]))
    expect(text).toContain('spreadsheet.setCell')
    expect(text).toContain('skipped: no Windows host')
  })

  it('names both evidence kinds in the header so a reader cannot merge them', () => {
    const text = formatReport(buildReport([comparison({ measuredCalls: 1 })]))
    expect(text).toContain('evidence')
    expect(text).toContain('measured / recorded')
  })

  it('states the ratio and both figures for a compared task', () => {
    const text = formatReport(buildReport([comparison({ task: 'document.createText', measuredCalls: 1, recordedVisionCalls: 20 })]))
    expect(text).toContain('20 recorded vs 1 measured = 20x fewer steps')
  })
})

describe('measuring for real', () => {
  it('counts the mechanism invocation for a filesystem task and verifies it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aeven-bench-'))
    const path = join(dir, 'out.txt')
    const book: RecipeBook = [{
      task: 'file.writeText',
      summary: 'Write.',
      on: [{ platform: 'darwin', rung: 'semantic', apps: [], evidence: 'verified', invocation: { mechanism: 'filesystem', operation: 'writeFile' } }],
      verify: [{ kind: 'fileEquals', path: '{path}', text: '{text}' }],
    }]
    const result = await measureTask({ book, tasks: [] }, {
      task: 'file.writeText',
      platform: 'darwin',
      parameters: { path, text: 'measured' },
    })
    expect(result.measuredCalls).toBe(1)
    expect(result.measuredEvidence).toBe('measured')
    await rm(dir, { recursive: true, force: true })
  })

  it('counts one call for the Pages document task, which is the claim being tested', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aeven-bench2-'))
    const path = join(dir, 'story.pages')
    const result = await measureTask({ book: STARTER_BOOK, tasks: [] }, {
      task: 'document.createText',
      platform: 'darwin',
      app: 'com.apple.Pages',
      parameters: { path, text: 'The Cartographer of Small Hours' },
    })
    // The mechanism is stubbed here so the figure records the stack's call count,
    // not whether Pages happened to be installed on the machine running the suite.
    expect(result.measuredCalls).toBe(1)
    expect(result.recordedVisionCalls).toBe(20)
    expect(stepRatio(result)).toBe(20)
    await rm(dir, { recursive: true, force: true })
  })

  it('reports a task it cannot run with the reason, never as zero calls', async () => {
    const result = await measureTask({ book: STARTER_BOOK, tasks: [] }, {
      task: 'document.createText',
      platform: 'darwin',
      app: 'com.apple.Pages',
      parameters: {},
      skip: 'requires Pages on this host',
    })
    expect(result.measuredCalls).toBeUndefined()
    expect(result.skipped).toBe('requires Pages on this host')
  })

  it('reports a task whose resolution fails as skipped with the failure', async () => {
    const result = await measureTask({ book: STARTER_BOOK, tasks: [] }, {
      task: 'spreadsheet.setCell',
      platform: 'linux',
      parameters: { cell: 'A1', value: '1' },
    })
    expect(result.measuredCalls).toBeUndefined()
    expect(result.skipped).toContain('could not run here')
  })

  it('runs a full report over a mixed task list', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aeven-bench3-'))
    const tasks: BenchmarkTask[] = [
      { task: 'file.exists', platform: 'darwin', parameters: { path: dir } },
      { task: 'spreadsheet.setCell', platform: 'win32', parameters: { cell: 'A1', value: '1' }, skip: 'no Windows host' },
    ]
    const report = await runBenchmark({ book: STARTER_BOOK, tasks })
    expect(report.comparisons).toHaveLength(2)
    expect(report.measuredTotal).toBe(1)
    expect(report.skipped).toBe(1)
    await rm(dir, { recursive: true, force: true })
  })

  it('calls the observer once per invocation, which is how the count is taken', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aeven-bench4-'))
    let observed = 0
    await measureTask({ book: STARTER_BOOK, tasks: [], onCall: () => { observed++ } }, {
      task: 'file.exists',
      platform: 'darwin',
      parameters: { path: dir },
    })
    expect(observed).toBe(1)
    await rm(dir, { recursive: true, force: true })
  })
})

describe('the recorded baselines', () => {
  it('records the measured vision cost for the Pages document task', () => {
    expect(RECORDED_VISION_BASELINES['document.createText']).toBe(20)
  })

  it('does not invent baselines for tasks that were never run the other way', () => {
    for (const task of Object.keys(RECORDED_VISION_BASELINES)) {
      expect(STARTER_BOOK.some(recipe => recipe.task === task)).toBe(true)
    }
    expect(Object.keys(RECORDED_VISION_BASELINES)).toHaveLength(1)
  })
})
