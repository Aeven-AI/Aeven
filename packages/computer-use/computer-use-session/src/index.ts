/**
 * The session surface: many actions for one round trip.
 *
 * This is where the largest step saving lives, and it is not in the adapters. A
 * reference implementation exposes computer use as a single code tool over a
 * session rather than as one tool per action, so one model step can perform
 * several actions and re-observe once — its own guidance is to batch related
 * inputs and treat a state capture as expensive.
 *
 * A session therefore does three things a bare adapter cannot:
 *
 * - **Batches.** `run()` takes many steps and returns one result, so N actions
 *   cost one round trip instead of N.
 * - **Remembers the last observation**, so `observe()` can report a diff rather
 *   than a full tree, and a caller can ask whether the interface has stopped moving.
 * - **Carries verification into the batch**, so "it worked" is part of the result
 *   rather than a separate call.
 *
 * @module @aeven/computer-use-session
 */

import {
  ComputerUseError,
  type DesktopAdapter,
  type DesktopNode,
  type ObserveResult,
  type ObserveScope,
  type ReadinessReport,
} from '@aeven/computer-use-desktop'
import { TaskExecutor, type ExecuteRequest, type ExecutionOutcome, type ExecutorOptions } from '@aeven/computer-use-executor'
import { diffNodes, type TreeDiff } from './diff.ts'

export * from './diff.ts'

/** One step in a batch. */
export type SessionStep =
  | { kind: 'execute', request: ExecuteRequest }
  | { kind: 'observe', scope?: ObserveScope }
  | { kind: 'readiness' }

/** What one step produced, tagged by kind so a caller can match them up. */
export type SessionStepResult =
  | { kind: 'execute', outcome: ExecutionOutcome }
  | { kind: 'observe', observation: ObserveResult, diff: TreeDiff }
  | { kind: 'readiness', readiness: ReadinessReport }
  | { kind: 'failed', error: string, step: SessionStep }

/** The result of one batch. */
export interface BatchResult {
  results: readonly SessionStepResult[]
  /** Whether every step completed and every executed task verified. */
  verified: boolean
  /** How many steps the caller performed in one call. */
  steps: number
}

/** Options for opening a session. */
export interface SessionOptions extends ExecutorOptions {
  /** The adapter this session observes and verifies through. */
  adapter?: DesktopAdapter
}

/**
 * A computer-use session over one adapter and one recipe book.
 *
 * Deliberately holds no locks and no desktop exclusivity: a session is the
 * caller's working context, not a claim on the machine.
 */
export class ComputerUseSession {
  private readonly executor: TaskExecutor

  private readonly adapter: DesktopAdapter | undefined

  private lastNodes: readonly DesktopNode[] | undefined

  /** Window ids of the last observation, so a different window resets the diff. */
  private lastWindows: readonly string[] | undefined

  /**
   * @param options - the recipe book, handlers, and the adapter to use.
   */
  constructor(options: SessionOptions) {
    this.executor = new TaskExecutor(options as ExecutorOptions)
    this.adapter = options.adapter
  }

  /**
   * Perform several steps and return one result.
   *
   * Steps run in order and stop at the first failure, because a later step in a
   * batch almost always depends on an earlier one having succeeded; continuing
   * would act on an interface that never reached the expected state.
   * @param steps - the steps to perform.
   * @returns the per-step results and whether everything verified.
   * @throws {ComputerUseError} `capability-unavailable` when a step needs an
   * adapter this session was not given.
   */
  async run(steps: readonly SessionStep[]): Promise<BatchResult> {
    const results: SessionStepResult[] = []
    for (const step of steps) {
      if (step.kind === 'execute') {
        const outcome = await this.executor.execute(step.request)
        results.push({ kind: 'execute', outcome })
        if (!outcome.verified) {
          return { results, verified: false, steps: steps.length }
        }
        continue
      }
      if (step.kind === 'observe') {
        const observation = await this.observe(step.scope)
        results.push({ kind: 'observe', observation: observation.observation, diff: observation.diff })
        continue
      }
      const adapter = this.requireAdapter('readiness')
      const readiness = await adapter.readiness()
      results.push({ kind: 'readiness', readiness })
    }
    return {
      results,
      verified: results.every(entry => entry.kind !== 'execute' || entry.outcome.verified),
      steps: steps.length,
    }
  }

  /**
   * Observe the desktop, reporting a diff against the previous observation.
   *
   * The first observation is complete and later ones are deltas, which is why the
   * diff carries a `complete` flag: a caller must be able to tell "everything is
   * new" from "nothing is new" without inferring it from the contents. An
   * observation covering a different set of windows is also complete, because
   * positions from one window's walk mean nothing in another's.
   * @param scope - what to observe.
   * @returns the observation and its diff.
   * @throws {ComputerUseError} `capability-unavailable` when there is no adapter.
   */
  async observe(scope?: ObserveScope): Promise<{ observation: ObserveResult, diff: TreeDiff }> {
    const adapter = this.requireAdapter('observe')
    const observation = await adapter.observe(scope ?? {})
    const nodes = observation.snapshot?.nodes ?? []
    const windows = (observation.snapshot?.windows ?? []).map(window => window.windowId).sort()
    const sameWindows = this.lastWindows !== undefined
      && windows.length === this.lastWindows.length
      && windows.every((id, position) => id === this.lastWindows?.[position])
    const diff = diffNodes(this.lastNodes, nodes, sameWindows)
    this.lastNodes = nodes
    this.lastWindows = windows
    return { observation, diff }
  }

  /**
   * Forget the last observation, so the next one is complete again.
   *
   * Needed when the caller knows the tree changed wholesale — a different window,
   * a new document — and a delta against the old one would be meaningless.
   */
  resetObservation(): void {
    this.lastNodes = undefined
    this.lastWindows = undefined
  }

  /**
   * The router, so a caller can inspect resolution without executing.
   * @returns the router over this session's book.
   */
  get routing(): TaskExecutor['routing'] {
    return this.executor.routing
  }

  /**
   * Resolve a step to an adapter, refusing when the session has none.
   * @param what - the operation needing an adapter, for the failure message.
   * @returns the adapter.
   * @throws {ComputerUseError} `capability-unavailable` when there is none.
   */
  private requireAdapter(what: string): DesktopAdapter {
    if (this.adapter === undefined) {
      throw new ComputerUseError(
        'capability-unavailable',
        `the session cannot ${what} without an adapter; construct it with one to observe the desktop`,
      )
    }
    return this.adapter
  }
}
