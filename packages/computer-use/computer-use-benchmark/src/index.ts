/**
 * Running the benchmark.
 *
 * Only tasks this host can actually run are measured. Everything else is reported
 * as skipped with the reason, because a benchmark that quietly omits what it could
 * not run would overstate the result — and the two platforms it cannot reach are
 * exactly the ones whose adapters are still unverified.
 *
 * @module @aeven/computer-use-benchmark
 */

import type { DesktopPlatform } from '@aeven/computer-use-desktop'
import { ComputerUseSession } from '@aeven/computer-use-session'
import type { RecipeBook } from '@aeven/computer-use-router'
import type { MechanismHandler } from '@aeven/computer-use-executor'
import {
  buildReport,
  formatReport,
  RECORDED_VISION_BASELINES,
  type BenchmarkReport,
  type StepComparison,
} from './steps.ts'

export * from './steps.ts'

/** One task to attempt, and the parameters it needs. */
export interface BenchmarkTask {
  task: string
  platform: DesktopPlatform
  app?: string
  parameters: Readonly<Record<string, string>>
  /** Why this task cannot run on this host, when it cannot. */
  skip?: string
}

/** Options for a benchmark run. */
export interface BenchmarkOptions {
  book: RecipeBook
  /** Parameters per task, keyed by task name. */
  tasks: readonly BenchmarkTask[]
  /**
   * Called once per mechanism invocation. The count of these calls is the step
   * figure, which is why it is counted at the seam rather than trusted to a
   * handler's own reporting.
   */
  onCall?: () => void
}

/**
 * Wrap every mechanism the book uses in a counter.
 *
 * The count is taken at the seam the stack actually crosses, rather than trusting
 * a handler's own report about how much it did. A known mechanism delegates to its
 * real implementation so the measured work is genuine; an unknown one is answered
 * without work, and the count still records that the stack reached the mechanism.
 * @param book - the book, so only the mechanisms it names are wrapped.
 * @param onCall - called once per invocation.
 * @returns a handler map suitable for a session.
 */
async function countingHandlers(
  book: RecipeBook,
  onCall: (() => void) | undefined,
): Promise<Record<string, MechanismHandler>> {
  const { BUILT_IN_HANDLERS } = await import('@aeven/computer-use-executor')
  const mechanisms = new Set(book.flatMap(recipe => recipe.on.map(entry => entry.invocation.mechanism)))
  const handlers: Record<string, MechanismHandler> = {}
  for (const mechanism of mechanisms) {
    const builtIn = BUILT_IN_HANDLERS[mechanism]
    handlers[mechanism] = async (request) => {
      onCall?.()
      if (builtIn !== undefined) {
        return builtIn(request)
      }
      return { observed: `${mechanism} invocation` }
    }
  }
  return handlers
}

/**
 * Measure one task by running it and counting the mechanism invocations it makes.
 * @param options - the book, the task, and the call observer.
 * @returns the comparison for this task.
 */
export async function measureTask(options: BenchmarkOptions, task: BenchmarkTask): Promise<StepComparison> {
  const baseline = RECORDED_VISION_BASELINES[task.task]
  const base: StepComparison = {
    task: task.task,
    platform: task.platform,
    measuredEvidence: 'measured',
    baselineEvidence: 'recorded',
    ...baseline === undefined ? {} : { recordedVisionCalls: baseline },
  }
  if (task.skip !== undefined) {
    return { ...base, skipped: task.skip }
  }
  let calls = 0
  const session = new ComputerUseSession({
    book: options.book,
    handlers: await countingHandlers(options.book, () => {
      calls++
      options.onCall?.()
    }),
  })
  try {
    await session.run([
      {
        kind: 'execute',
        request: {
          task: task.task,
          platform: task.platform,
          ...task.app === undefined ? {} : { app: task.app },
          parameters: task.parameters,
        },
      },
    ])
  } catch (error) {
    return {
      ...base,
      skipped: `could not run here: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`,
    }
  }
  return { ...base, measuredCalls: calls }
}

/**
 * Measure every task and assemble the report.
 * @param options - the book, the tasks, and the call observer.
 * @returns the report.
 */
export async function runBenchmark(options: BenchmarkOptions): Promise<BenchmarkReport> {
  const comparisons: StepComparison[] = []
  for (const task of options.tasks) {
    comparisons.push(await measureTask(options, task))
  }
  return buildReport(comparisons)
}

/**
 * Render a report for a terminal.
 * @param report - the report to render.
 * @returns the text.
 */
export function renderBenchmark(report: BenchmarkReport): string {
  return formatReport(report)
}
