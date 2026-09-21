/**
 * The desktop adapter contract: the four operations every platform adapter
 * implements, expressed once so a recipe written against it runs on macOS,
 * Windows and Linux without a platform branch.
 *
 * The two invariants are encoded in the signatures rather than documented
 * beside them:
 *
 * - **`act()` cannot express success.** It returns what was attempted and what
 *   the adapter could observe. A caller that needs certainty must call
 *   `verify()`, because an action's own acknowledgement is not evidence.
 * - **Observation is scoped.** `observe()` takes a {@link ObserveScope}, so the
 *   whole desktop is never the accidental default.
 *
 * @module @aeven/computer-use-desktop
 */

import type {
  ActionReceipt,
  DesktopAction,
  DesktopPlatform,
  Expectation,
  ObserveResult,
  ObserveScope,
  ReadinessReport,
  VerificationOutcome,
} from './types.ts'

export * from './types.ts'
export * from './guard.ts'
export * from './verify.ts'

/**
 * One platform's implementation of the desktop contract.
 *
 * Capability is not assumed uniform: Linux cannot promise a compositor backend
 * on every desktop, so an adapter reports what it can actually do through
 * {@link DesktopAdapter.readiness} instead of pretending parity. A caller checks
 * readiness before relying on an operation.
 */
export interface DesktopAdapter {
  /** The platform this adapter drives. */
  readonly platform: DesktopPlatform

  /**
   * Capture one coherent view: windows, flattened accessibility nodes, focus,
   * and optionally pixels — in a single operation, so every part describes the
   * same instant.
   * @param scope - what to observe, and how much of it.
   * @returns the observation and any notes explaining how it was narrowed.
   */
  observe(scope: ObserveScope): Promise<ObserveResult>

  /**
   * Attempt one action.
   *
   * Returns a receipt, never a verdict: what route was used and what the adapter
   * could observe afterwards. Call {@link DesktopAdapter.verify} to establish
   * that the work actually happened.
   * @param action - the action to attempt.
   * @returns what was attempted and observed. Never a success flag.
   */
  act(action: DesktopAction): Promise<ActionReceipt>

  /**
   * Re-read observables independently of how the action was performed and report
   * each one.
   * @param expectations - the conditions to check.
   * @returns one outcome per expectation, in the same order.
   */
  verify(expectations: readonly Expectation[]): Promise<readonly VerificationOutcome[]>

  /**
   * Report which capabilities work on this host, what blocks the rest, and which
   * OS identity holds each grant.
   * @returns the readiness report for this adapter's platform.
   */
  readiness(): Promise<ReadinessReport>
}
