/**
 * What a recipe is.
 *
 * A recipe is **data, not code**: it declares, for one task on one application,
 * which rung to use, how to invoke that rung, what must be independently true
 * afterwards, and — where the application's automation surface is blind — what it
 * cannot do. The router reads recipes; it never contains per-application logic
 * itself, which is what keeps "which layer wins here" reviewable in one place
 * instead of scattered through conditionals.
 *
 * `knownBlind` carries as much weight as `rung`. It is what stops the router
 * discovering a blind spot in front of a user: measured experience on Pages was
 * twenty-plus vision calls before it emerged that content was reachable in one
 * call and formatting was not reachable at all. A recipe that cannot do something
 * says so up front.
 *
 * @module @aeven/computer-use-router/recipe
 */

import type { DesktopPlatform, Expectation } from '@aeven/computer-use-desktop'

/**
 * The layers a task can be performed with, ordered from cheapest and most
 * reliable to most expensive.
 *
 * The ordering is the whole point: a caller asks for the highest rung that can do
 * the job, and only falls down when the recipe says the rung above is blind.
 */
export type RecipeRung = 'semantic' | 'accessibility' | 'vision'

/** The rungs, most preferred first. */
export const RUNG_ORDER: readonly RecipeRung[] = ['semantic', 'accessibility', 'vision']

/** How one platform performs a task. */
export interface RecipeInvocation {
  /**
   * The mechanism this invocation uses, which is what a consumer switches on to
   * actually run it. Kept as a name rather than a function so a recipe stays
   * serializable and testable without a host.
   */
  mechanism: 'apple-events' | 'com' | 'dbus' | 'ax' | 'uia' | 'atspi' | 'filesystem' | 'pixels'
  /**
   * The operation to perform, in the mechanism's own vocabulary — an AppleScript
   * verb, a COM member, an accessibility action name.
   *
   * Deliberately a string: the router selects and explains, while the consumer
   * that owns the mechanism decides how to execute the operation.
   */
  operation: string
  /**
   * Values the operation needs, as literal data. A consumer substitutes its own
   * arguments where a value is a placeholder such as `{text}`.
   */
  parameters?: Readonly<Record<string, string>>
}

/**
 * One platform's implementation of a task.
 *
 * `mechanism` lives on the invocation, not here — an entry chooses a *rung*, and
 * the invocation it points at names the mechanism. The field is prohibited rather
 * than merely absent because it was added here by mistake three times, and a type
 * that rejects it is what stops the fourth.
 */
export interface PlatformInvocation {
  platform: DesktopPlatform
  rung: RecipeRung
  invocation: RecipeInvocation
  /** Not a field: see this interface's note. */
  mechanism?: never
  /**
   * Applications this invocation applies to, by bundle id, executable name, or
   * desktop-entry id. A list rather than a single id, because the same mechanism
   * covers a family — Apple Events serve every iWork application.
   */
  apps: readonly string[]
  /**
   * Evidence for this entry. `verified` means it was run on this machine;
   * `documented` means it comes from a published API and still needs checking.
   * A consumer must not present the two as equivalent.
   */
  evidence: 'verified' | 'documented'
  /**
   * Tasks this application's mechanism cannot do, in `task` form. Populated from
   * measurement or from a published limitation; never guessed.
   */
  knownBlind?: readonly string[]
}

/**
 * What the task is actually for.
 *
 * This is the question that decides between two layers which are otherwise equally
 * plausible, and it is not a rung: a rung says *how* work is done, this says *what
 * the work must affect*.
 *
 * - `file` — the outcome is a file on disk. Nothing needs to be installed or
 *   running, the layer works identically on every platform, and the result is
 *   verified by reading it back.
 * - `open-application` — the outcome is the state of an application the user is
 *   working in. Unsaved edits are only reachable this way, and a file-level tool
 *   cannot see them at all.
 *
 * Skipped when unset, rather than assuming one: a caller who states no intent is
 * not asking to be routed by a guess.
 */
export type Deliverable = 'file' | 'open-application'

/** One task, as performed across platforms. */
export interface TaskRecipe {
  /**
   * Stable task name in `domain.action` form, e.g. `document.createText`,
   * `mail.readRecent`. This is the key a caller looks up.
   */
  task: string
  /** One-line description of the user-visible outcome, not the mechanism. */
  summary: string
  /** How each platform performs it. A platform absent here has no recipe yet. */
  on: readonly PlatformInvocation[]
  /**
   * What the task must affect. Unset means the recipe is agnostic, and a caller
   * that requires a specific deliverable is refused rather than served by a guess.
   */
  deliverable?: Deliverable
  /**
   * What must be independently true after the task succeeded. Every recipe has at
   * least one, because a recipe that cannot be verified cannot be trusted.
   */
  verify: readonly Expectation[]
}

/** The full recipe set. */
export type RecipeBook = readonly TaskRecipe[]

/** A recipe resolved for one platform and one application. */
export interface ResolvedRecipe {
  task: string
  summary: string
  platform: DesktopPlatform
  app: string
  /** What the task must affect, when the recipe states it. */
  deliverable?: Deliverable
  rung: RecipeRung
  invocation: RecipeInvocation
  evidence: 'verified' | 'documented'
  /** Tasks this mechanism cannot perform, so a caller can avoid asking. */
  knownBlind: readonly string[]
  /** The expectations to check after the task runs. */
  verify: readonly Expectation[]
}
