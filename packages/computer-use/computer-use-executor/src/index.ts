/**
 * The executor: perform a task and establish that it actually worked.
 *
 * It fills the gap the router leaves. The router resolves *what* should happen;
 * the executor resolves the task, hands the invocation to whichever handler owns
 * that mechanism, and then verifies the result independently.
 *
 * The order is deliberate and is the whole reason this package exists. The
 * handler runs, and its own report is treated as **advisory only** — the verdict
 * comes from re-reading observables. Measured experience is blunt about why: an
 * action reported `delivered_count: 42` while the file never changed, and a save
 * reported success while writing nothing. A task that cannot be verified is a
 * task this executor refuses to call done.
 *
 * @module @aeven/computer-use-executor
 */

import {
  ComputerUseError,
  assertVerified,
  checkExpectations,
  type DesktopAdapter,
  type Expectation,
  type VerificationOutcome,
  type VerificationReaders,
} from '@aeven/computer-use-desktop'
import type { DesktopPlatform } from '@aeven/computer-use-desktop'
import { RecipeRouter, type RecipeBook, type ResolvedRecipe } from '@aeven/computer-use-router'
import { resolveExpectations } from './expectations.ts'
import { BUILT_IN_HANDLERS, type MechanismHandler } from './mechanism.ts'

export * from './mechanism.ts'
export * from './expectations.ts'

/** One task to perform. */
export interface ExecuteRequest {
  /** The task name, in `domain.action` form. */
  task: string
  platform: DesktopPlatform
  /** The application to perform it in, when the task is application-specific. */
  app?: string
  /**
   * Values for the recipe's parameters and its expectation placeholders. The same
   * map resolves both, so a check reads the same path the task wrote.
   */
  parameters?: Readonly<Record<string, string>>
  /**
   * Rungs this host can actually use. Pass these from a desktop adapter's
   * readiness report so resolution stays honest about capability.
   */
  availableRungs?: ResolvedRecipe['rung'][]
  /**
   * Check the task's expectations. Defaults to true, and disabling it is a
   * deliberate act: the returned outcome then reports no verification, and a
   * caller must not treat that as success.
   */
  verify?: boolean
}

/** What happened. */
export interface ExecutionOutcome {
  /** The task that ran. */
  task: string
  /** The rung and mechanism that performed it. */
  rung: ResolvedRecipe['rung']
  mechanism: string
  /**
   * Whether the task's own expectations were checked and all held. `false` when
   * verification was skipped, because "not checked" is not "passed".
   */
  verified: boolean
  /** Per-expectation results, empty when verification was skipped. */
  outcomes: readonly VerificationOutcome[]
  /** What the handler reported. Advisory only — never the verdict. */
  observed?: string
  notes: readonly string[]
}

/** Options for constructing the executor. */
export interface ExecutorOptions {
  book: RecipeBook
  /**
   * The adapter used to read observables the filesystem cannot answer, and to
   * supply readiness. Optional: tasks verified purely against files work without
   * one.
   */
  adapter?: DesktopAdapter
  /**
   * Handlers for mechanisms this package does not implement, keyed by mechanism
   * name. A missing handler is reported as a capability failure naming the
   * mechanism, so an unimplemented platform is legible rather than a silent
   * no-op.
   */
  handlers?: Readonly<Record<string, MechanismHandler>>
  /** Session facts for the adapter, when it needs them. */
  readers?: Partial<VerificationReaders>
}

/** Performs tasks and verifies them. */
export class TaskExecutor {
  private readonly router: RecipeRouter

  private readonly handlers: Readonly<Record<string, MechanismHandler>>

  private readonly adapter: DesktopAdapter | undefined

  /**
   * @param options - the recipe book, an optional adapter, and mechanism handlers.
   */
  constructor(options: ExecutorOptions) {
    this.router = new RecipeRouter(options.book)
    this.handlers = { ...BUILT_IN_HANDLERS, ...options.handlers }
    this.adapter = options.adapter
  }

  /**
   * The router, for callers that want to inspect resolution without running.
   * @returns the router over this executor's book.
   */
  get routing(): RecipeRouter {
    return this.router
  }

  /**
   * Perform one task and establish whether it worked.
   *
   * @param request - the task, platform, application, and parameter values.
   * @returns what ran and whether the expectations held.
   * @throws {ComputerUseError} `invalid-target` when the resolved invocation has
   * no handler. `capability-unavailable` when no handler exists for its mechanism
   * or no rung is available. `unverified` when the task ran but an expectation
   * failed — a failure, never a partial success.
   */
  async execute(request: ExecuteRequest): Promise<ExecutionOutcome> {
    const resolved = this.router.resolve({
      task: request.task,
      platform: request.platform,
      ...request.app === undefined ? {} : { app: request.app },
      ...request.availableRungs === undefined ? {} : { availableRungs: request.availableRungs },
    })
    const values = { ...resolved.invocation.parameters, ...request.parameters }
    const handler = this.handlers[resolved.invocation.mechanism]
    if (handler === undefined) {
      throw new ComputerUseError(
        'capability-unavailable',
        `no handler performs the "${resolved.invocation.mechanism}" mechanism; register one to run this task on this host`,
        { mechanism: resolved.invocation.mechanism, task: resolved.task, available: Object.keys(this.handlers) },
      )
    }
    const result = await handler({
      invocation: resolved.invocation,
      parameters: values,
      ...request.app === undefined ? {} : { app: request.app },
    })
    const notes = [...result.notes ?? []]
    const outcome: ExecutionOutcome = {
      task: resolved.task,
      rung: resolved.rung,
      mechanism: resolved.invocation.mechanism,
      verified: false,
      outcomes: [],
      notes,
    }
    if (result.observed !== undefined) {
      outcome.observed = result.observed
    }
    if (request.verify === false) {
      notes.push('verification was skipped, so this outcome does not establish that the task succeeded')
      return outcome
    }
    const expectations = this.resolve(resolved.verify, values)
    const outcomes = await this.check(expectations)
    return {
      ...outcome,
      verified: outcomes.every(entry => entry.satisfied),
      outcomes,
    }
  }

  /**
   * Perform a task and throw unless it verified.
   *
   * The convenience form for callers that treat an unverified task as a failure,
   * which is the default posture this package recommends.
   * @param request - as {@link TaskExecutor.execute}.
   * @returns the outcome, only when every expectation held.
   * @throws {ComputerUseError} `unverified` carrying the failing expectations.
   */
  async executeOrThrow(request: ExecuteRequest): Promise<ExecutionOutcome> {
    const outcome = await this.execute(request)
    assertVerified(outcome.outcomes, request.task)
    return outcome
  }

  /**
   * Resolve placeholders in the recipe's expectations.
   * @param expectations - the recipe's expectations.
   * @param values - this call's resolved parameters.
   * @returns resolved expectations.
   */
  private resolve(expectations: readonly Expectation[], values: Readonly<Record<string, string>>): Expectation[] {
    return resolveExpectations(expectations, values)
  }

  /**
   * Check expectations, preferring the adapter when one is configured.
   * @param expectations - the expectations to check.
   * @returns one outcome per expectation, in order.
   */
  private async check(expectations: readonly Expectation[]): Promise<readonly VerificationOutcome[]> {
    if (this.adapter !== undefined) {
      return this.adapter.verify(expectations)
    }
    return checkExpectations(expectations, {
      nodeValue: { read: () => Promise.resolve(undefined) },
      windowTitles: { list: () => Promise.resolve([]) },
    })
  }
}
