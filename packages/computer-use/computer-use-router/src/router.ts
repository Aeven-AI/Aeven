/**
 * The router: choosing the rung, and refusing to guess.
 *
 * Three rules shape everything here, each from a measured failure.
 *
 * **Prefer the highest rung available.** The difference between one call and
 * twenty-plus was layer choice, not tuning, so resolution always takes the most
 * preferred rung the recipe declares.
 *
 * **Refuse rather than silently degrade.** If the semantic rung is blind for a
 * task, the router falls *down* the ladder only where the recipe says so
 * explicitly; it never quietly drops to pixels, because a silent fall is
 * indistinguishable from success until the result is wrong.
 *
 * **Never invent coverage.** A platform or application with no recipe resolves to
 * a named failure listing what was searched, rather than an empty answer a caller
 * might mistake for "nothing to do".
 *
 * @module @aeven/computer-use-router
 */

import { ComputerUseError, type DesktopPlatform } from '@aeven/computer-use-desktop'
import { RUNG_ORDER, type PlatformInvocation, type RecipeBook, type RecipeRung, type ResolvedRecipe, type TaskRecipe } from './recipe.ts'

export * from './recipe.ts'

/** What a caller asks for. */
export interface ResolveRequest {
  /** The task name, in `domain.action` form. */
  task: string
  platform: DesktopPlatform
  /**
   * The application to perform it in, by bundle id, executable name, or
   * desktop-entry id. Omit when the task is not application-specific, such as
   * reading a file.
   */
  app?: string
  /**
   * Rungs this host can actually use, from its adapter's readiness report. A
   * rung absent here is treated as unavailable even when a recipe declares it,
   * so an unpermitted host is told why instead of failing later.
   */
  availableRungs?: readonly RecipeRung[]
}

/** The router over a recipe book. */
export class RecipeRouter {
  private readonly book: RecipeBook

  /**
   * @param book - the recipes to route over.
   */
  constructor(book: RecipeBook) {
    this.book = book
  }

  /**
   * Every task name this book knows.
   * @returns the task names, in book order.
   */
  tasks(): string[] {
    return this.book.map(recipe => recipe.task)
  }

  /**
   * Find one task recipe.
   * @param task - the task name.
   * @returns the recipe, or `undefined` when the book has none.
   */
  private find(task: string): TaskRecipe | undefined {
    return this.book.find(recipe => recipe.task === task)
  }

  /**
   * Resolve a task to a concrete invocation, or explain why it cannot.
   *
   * @param request - the task, platform, and optional application.
   * @returns the resolved recipe, including its verification expectations.
   * @throws {ComputerUseError} `unknown-node` when the task is not in the book,
   * `capability-unavailable` when the platform has no invocation, no invocation
   * covers the named application, or every candidate rung is unavailable.
   */
  resolve(request: ResolveRequest): ResolvedRecipe {
    const recipe = this.find(request.task)
    if (recipe === undefined) {
      throw new ComputerUseError('unknown-node', `no recipe for the task "${request.task}"`, {
        task: request.task,
        known: this.tasks(),
      })
    }
    const forPlatform = recipe.on.filter(entry => entry.platform === request.platform)
    if (forPlatform.length === 0) {
      throw new ComputerUseError(
        'capability-unavailable',
        `no recipe for "${request.task}" on ${request.platform}`,
        { task: request.task, platform: request.platform, platforms: [...new Set(recipe.on.map(entry => entry.platform))] },
      )
    }
    const applicable = request.app === undefined
      ? forPlatform
      : forPlatform.filter(entry => entry.apps.includes(request.app as string))
    if (applicable.length === 0) {
      throw new ComputerUseError(
        'capability-unavailable',
        `no recipe for "${request.task}" covers the application "${request.app ?? ''}" on ${request.platform}`,
        { task: request.task, app: request.app, covered: [...new Set(forPlatform.flatMap(entry => [...entry.apps]))] },
      )
    }
    const chosen = this.preferHighestRung(applicable, request.availableRungs)
    return {
      task: recipe.task,
      summary: recipe.summary,
      platform: request.platform,
      app: request.app ?? chosen.apps[0] ?? '',
      rung: chosen.rung,
      invocation: chosen.invocation,
      evidence: chosen.evidence,
      knownBlind: chosen.knownBlind ?? [],
      verify: recipe.verify,
    }
  }

  /**
   * Pick the most preferred rung among the candidates.
   *
   * Ties are broken by book order, so a recipe's own ordering expresses
   * preference between two invocations at the same rung.
   * @param candidates - the invocations that could serve the request.
   * @param available - rungs the host can use; absent means "do not restrict".
   * @returns the chosen invocation.
   * @throws {ComputerUseError} `capability-unavailable` when no candidate's rung
   * is available on this host.
   */
  private preferHighestRung(
    candidates: readonly PlatformInvocation[],
    available: readonly RecipeRung[] | undefined,
  ): PlatformInvocation {
    for (const rung of RUNG_ORDER) {
      const usable = candidates.filter(entry => entry.rung === rung)
      if (usable.length === 0) {
        continue
      }
      if (available === undefined || available.includes(rung)) {
        return usable[0] as PlatformInvocation
      }
    }
    throw new ComputerUseError(
      'capability-unavailable',
      'none of the recipe\'s rungs is available on this host, so the task cannot be performed here',
      { candidateRungs: candidates.map(entry => entry.rung), availableRungs: [...(available ?? [])] },
    )
  }

  /**
   * Report what a task cannot do through its resolved mechanism.
   *
   * Callers use this before asking, so a task that is structurally impossible on
   * the resolved rung is refused with a reason rather than attempted and discovered.
   * @param request - the same request that would be resolved.
   * @returns the blind spots the resolved invocation declares, if it can resolve.
   */
  blindSpots(request: ResolveRequest): readonly string[] {
    try {
      return this.resolve(request).knownBlind
    } catch {
      return []
    }
  }
}
