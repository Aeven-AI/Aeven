/**
 * Step-count benchmark.
 *
 * The goal this stack exists for is "fewest steps", and until it is measured that
 * is an opinion. This produces the number: for each task, one call to do it, next
 * to the recorded cost of doing it the other way.
 *
 * Two kinds of evidence, kept strictly apart.
 *
 * **Measured here** — a task runs through the session and the adapter's call count
 * is read from an instrumented runner. That is a count, not an estimate.
 *
 * **Recorded baseline** — the vision cost was observed in an earlier session and
 * is carried below as a labelled constant. It is reported as `recorded`, never as
 * `measured`, because this script cannot reproduce it without driving a real
 * desktop through the failing path.
 *
 * Tasks that cannot run here — anything needing Windows, Linux, or an application
 * this machine does not have — are reported as skipped with the reason. A
 * benchmark that quietly omits what it could not run is worse than no benchmark.
 *
 * @module @aeven/computer-use-benchmark/steps
 */

import type { DesktopPlatform } from '@aeven/computer-use-desktop'

/** How a cost was obtained. */
export type Evidence = 'measured' | 'recorded'

/** The two costs being compared for one task. */
export interface StepComparison {
  /** The task, in `domain.action` form. */
  task: string
  platform: DesktopPlatform
  /** Calls this stack needed, when it was run here. */
  measuredCalls?: number
  /** Calls the vision path needed, as recorded earlier, when one was recorded. */
  recordedVisionCalls?: number
  /** How the measured figure was obtained. */
  measuredEvidence: Evidence
  /** How the baseline figure was obtained. */
  baselineEvidence: Evidence
  /** Why no measurement was possible, when none was. */
  skipped?: string
}

/**
 * The vision-path baselines recorded in an earlier session against Pages Creator
 * Studio 15.3.1 on macOS.
 *
 * These are **not** reproducible by this script, which is exactly why they are
 * labelled rather than measured: their purpose is to keep the comparison honest,
 * not to be re-derived.
 */
export const RECORDED_VISION_BASELINES: Readonly<Record<string, number>> = {
  /**
   * Creating a document containing text. The vision path spent more than twenty
   * calls across accessibility reads, screenshots, and pixel clicks, and still did
   * not complete the task: it could not get past the Creator Studio template
   * chooser, whose window exposes two accessibility elements.
   */
  'document.createText': 20,
}

/**
 * Ratio of baseline cost to measured cost.
 * @param comparison - one comparison with both figures present.
 * @returns the ratio, or `undefined` when either figure is missing.
 */
export function stepRatio(comparison: StepComparison): number | undefined {
  const { measuredCalls, recordedVisionCalls } = comparison
  if (measuredCalls === undefined || recordedVisionCalls === undefined || measuredCalls === 0) {
    return undefined
  }
  return recordedVisionCalls / measuredCalls
}

/** The whole report. */
export interface BenchmarkReport {
  comparisons: readonly StepComparison[]
  /** Total calls measured across every task that ran. */
  measuredTotal: number
  /** Tasks that could not be measured here. */
  skipped: number
  /** Sum of recorded baselines that have a measured counterpart, for a ratio. */
  comparedBaselineTotal: number
}

/**
 * Assemble a report.
 * @param comparisons - every task's comparison, measured or skipped.
 * @returns the assembled report with its totals.
 */
export function buildReport(comparisons: readonly StepComparison[]): BenchmarkReport {
  const measured = comparisons.filter(entry => entry.measuredCalls !== undefined)
  const compared = measured.filter(entry => entry.recordedVisionCalls !== undefined)
  return {
    comparisons: [...comparisons],
    /* v8 ignore next -- unreachable: the filter above keeps only entries that carry this figure. */
    measuredTotal: measured.reduce((total, entry) => total + (entry.measuredCalls ?? 0), 0),
    skipped: comparisons.filter(entry => entry.skipped !== undefined).length,
    /* v8 ignore next -- unreachable: the filter above keeps only entries that carry this figure. */
    comparedBaselineTotal: compared.reduce((total, entry) => total + (entry.recordedVisionCalls ?? 0), 0),
  }
}

/**
 * Render a report as fixed-width text.
 * @param report - the report to render.
 * @returns one line per task, then a summary.
 */
export function formatReport(report: BenchmarkReport): string {
  const lines: string[] = []
  lines.push('task                          platform   calls  baseline   evidence')
  lines.push('----------------------------  ---------  -----  ---------  ----------------------')
  for (const entry of report.comparisons) {
    const calls = entry.measuredCalls === undefined ? '    -' : String(entry.measuredCalls).padStart(5)
    const baseline = entry.recordedVisionCalls === undefined ? '        -' : `recorded ${String(entry.recordedVisionCalls)}`.padStart(9)
    const note = entry.skipped === undefined
      ? `${entry.measuredEvidence} / ${entry.baselineEvidence}`
      : `skipped: ${entry.skipped}`
    lines.push(`${entry.task.padEnd(28)}  ${entry.platform.padEnd(9)}  ${calls}  ${baseline}  ${note}`)
  }
  const compared = report.comparisons.filter(entry => entry.measuredCalls !== undefined && entry.recordedVisionCalls !== undefined)
  lines.push('')
  lines.push(`measured total: ${String(report.measuredTotal)} call(s) across ${String(report.comparisons.length - report.skipped)} task(s)`)
  if (report.skipped > 0) {
    lines.push(`skipped: ${String(report.skipped)} task(s), each with its reason above`)
  }
  for (const entry of compared) {
    const ratio = stepRatio(entry)
    if (ratio !== undefined) {
      lines.push(`${entry.task}: ${String(entry.recordedVisionCalls)} recorded vs ${String(entry.measuredCalls)} measured = ${ratio.toFixed(0)}x fewer steps`)
    }
  }
  return lines.join('\n')
}
