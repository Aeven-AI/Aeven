/**
 * Validation primitives shared by every platform adapter. These encode the two
 * contract invariants that are easiest to violate by accident: an action must
 * name an unambiguous target, and an element token must belong to the snapshot
 * it is used against. Both fail loudly here rather than at the driver, so a
 * mistake surfaces as a named code instead of a mis-click against whatever now
 * occupies the same position.
 *
 * @module @aeven/computer-use-desktop/guard
 */

import type {
  ActionTarget,
  DesktopNode,
  DesktopPlatform,
  DesktopSnapshot,
  Expectation,
  ReadinessProbe,
  ReadinessReport,
  VerificationOutcome,
} from './types.ts'

/** Closed set of contract failures. */
export type ComputerUseErrorCode =
  | 'invalid-target'
  | 'stale-token'
  | 'unknown-node'
  | 'unknown-action'
  | 'unverified'
  /** The host cannot perform this operation: a missing grant, backend, or tool. */
  | 'capability-unavailable'
  /** The adapter does not implement this operation yet, and says so instead of pretending. */
  | 'not-implemented'

/**
 * A contract violation detected before any platform work happens.
 *
 * `detail` carries the machine-readable specifics (the token, the role) so a
 * caller can render a real explanation instead of a generic failure.
 */
export class ComputerUseError extends Error {
  /**
   * @param code - closed business code of the failure.
   * @param message - operator-facing description.
   * @param detail - structured specifics for the failure, when there are any.
   */
  constructor(
    readonly code: ComputerUseErrorCode,
    message: string,
    readonly detail?: Readonly<Record<string, unknown>>,
  ) {
    super(message)
    this.name = 'ComputerUseError'
  }
}

/**
 * Reject an action target that cannot be resolved unambiguously.
 *
 * The rule that matters: a point target must carry the window it is measured
 * against. Unscoped coordinates are what let a driver deliver input to whichever
 * window happens to hold focus — the failure mode this contract exists to make
 * impossible.
 * @param target - the target to validate.
 * @throws {ComputerUseError} `invalid-target` with the offending field named.
 */
export function assertActionTarget(target: ActionTarget): void {
  if (target.kind === 'element') {
    if (target.token.length === 0) {
      throw new ComputerUseError('invalid-target', 'an element target requires a non-empty token', { kind: target.kind })
    }
    return
  }
  if (target.kind === 'window') {
    if (target.windowId.length === 0) {
      throw new ComputerUseError('invalid-target', 'a window target requires a non-empty windowId', { kind: target.kind, pid: target.pid })
    }
    return
  }
  if (target.window === undefined) {
    throw new ComputerUseError(
      'invalid-target',
      'a point target must name the window its coordinates are measured against; unscoped coordinates can reach the wrong window',
      { kind: target.kind, x: target.x, y: target.y },
    )
  }
}

/**
 * Resolve a node token inside the snapshot that produced it.
 *
 * A token is valid only against its own snapshot. Any other snapshot means the
 * element may have moved, been rebuilt, or been replaced by a different control,
 * so refusing is the only safe answer — this is the guard that makes
 * "refresh state after an action" a protocol rather than advice.
 * @param snapshot - the snapshot the caller intends to act against.
 * @param token - the token from that snapshot's node list.
 * @returns the node the token identifies.
 * @throws {ComputerUseError} `stale-token` when the token belongs to another
 * snapshot, `unknown-node` when it belongs to this one but names no node.
 */
export function resolveNode(snapshot: DesktopSnapshot, token: string): DesktopNode {
  const node = snapshot.nodes.find(candidate => candidate.token === token)
  if (node === undefined) {
    throw new ComputerUseError('stale-token', 'the element token does not belong to this snapshot; re-observe before acting', {
      snapshotId: snapshot.snapshotId,
      token,
    })
  }
  return node
}

/**
 * Reject an accessibility action the node does not advertise.
 *
 * Action names are platform vocabulary. Guessing one produces either a driver
 * error or, worse, a differently-named action that does something else, so an
 * unadvertised name is refused with the advertised set attached.
 * @param node - the node the action would target.
 * @param action - the action name the caller wants to invoke.
 * @throws {ComputerUseError} `unknown-action` listing what the node does expose.
 */
export function assertAdvertisedAction(node: DesktopNode, action: string): void {
  const advertised = node.actions ?? []
  if (!advertised.includes(action)) {
    throw new ComputerUseError('unknown-action', `the node does not advertise the action "${action}"`, {
      token: node.token,
      role: node.role,
      advertised: [...advertised],
    })
  }
}

/**
 * Whether a verification run proves the work happened.
 *
 * Deliberately not "no expectation failed": an empty expectation list returns
 * `false`, because a verification that checked nothing must never read as
 * success. This is the mechanical form of the rule that an action's own
 * acknowledgement is not evidence.
 * @param outcomes - per-expectation results from the adapter.
 * @returns true only when at least one expectation was checked and every one held.
 */
export function verificationSatisfied(outcomes: readonly VerificationOutcome[]): boolean {
  return outcomes.length > 0 && outcomes.every(outcome => outcome.satisfied)
}

/**
 * Assert a verification run proved the work happened.
 * @param outcomes - per-expectation results from the adapter.
 * @param expectation - optional label for the operation being verified.
 * @throws {ComputerUseError} `unverified` carrying the failing outcomes, so a
 * caller sees which observable disagreed rather than a bare failure.
 */
export function assertVerified(outcomes: readonly VerificationOutcome[], expectation?: string): void {
  if (verificationSatisfied(outcomes)) {
    return
  }
  // The detail carries every outcome, satisfied or not, so a caller reading the error
  // can see which expectation failed and what the read-back actually observed.
  const summary = outcomes.map(outcome => ({
    expectation: outcome.expectation.kind,
    satisfied: outcome.satisfied,
    observed: outcome.observed,
  }))
  throw new ComputerUseError(
    'unverified',
    expectation === undefined
      ? 'the operation could not be verified by an independent read-back'
      : `"${expectation}" could not be verified by an independent read-back`,
    { outcomes: summary },
  )
}

/**
 * Resolve the host platform for an adapter, or report that it is unsupported.
 * @param platform - a `process.platform` value.
 * @returns the contract's platform identifier.
 * @throws {ComputerUseError} `invalid-target` for an OS this contract does not cover.
 */
export function resolveDesktopPlatform(platform: string): DesktopPlatform {
  if (platform === 'darwin' || platform === 'win32' || platform === 'linux') {
    return platform
  }
  throw new ComputerUseError('invalid-target', `the desktop contract does not cover the "${platform}" platform`, { platform })
}

/**
 * Build a readiness report from probed capabilities.
 *
 * Derives `blockers` from the probes so a report cannot disagree with itself,
 * and only offers a next step when something is actually blocked.
 * @param platform - the host platform the probes describe.
 * @param probes - every capability the adapter probed.
 * @returns the assembled report.
 */
export function composeReadinessReport(
  platform: DesktopPlatform,
  probes: readonly ReadinessProbe[],
): ReadinessReport {
  const blockers = probes.filter(probe => probe.state === 'blocked').map(probe => probe.name)
  const report: ReadinessReport = { platform, probes: [...probes], blockers }
  const first = blockers[0]
  if (first !== undefined) {
    const remedy = probes.find(probe => probe.name === first)?.remedy
    if (remedy !== undefined) {
      report.recommendedNextStep = remedy
    }
  }
  return report
}

/**
 * Format one expectation for a failure message.
 *
 * Kept here so every adapter names the same observable the same way; a caller
 * reading two adapters' errors should not have to learn two vocabularies.
 * @param expectation - the expectation to describe.
 * @returns a short human-readable description.
 */
export function describeExpectation(expectation: Expectation): string {
  switch (expectation.kind) {
    case 'fileExists':
      return `file exists: ${expectation.path}`
    case 'fileContains':
      return `file contains ${JSON.stringify(expectation.text)}: ${expectation.path}`
    case 'fileEquals':
      return `file equals ${JSON.stringify(expectation.text)}: ${expectation.path}`
    case 'fileNewerThan':
      return `file modified after ${String(expectation.sinceMs)}: ${expectation.path}`
    case 'nodeValueEquals':
      return `element value equals ${JSON.stringify(expectation.value)}`
    case 'windowTitled':
      return `a window is titled ${JSON.stringify(expectation.title)}`
    case 'appObject':
      return `${expectation.app} has a ${expectation.collection} matching ${JSON.stringify(expectation.match)}`
    case 'calendarHasEvent':
      return expectation.calendar === undefined
        ? 'a calendar holds the expected event'
        : `the calendar ${JSON.stringify(expectation.calendar)} holds the expected event`
    case 'noteExists':
      return expectation.folder === undefined
        ? `a note named ${JSON.stringify(expectation.name)} exists`
        : `a note named ${JSON.stringify(expectation.name)} exists in ${JSON.stringify(expectation.folder)}`
  }
}
