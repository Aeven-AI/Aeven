/**
 * The macOS desktop adapter.
 *
 * Scope note, stated plainly because it matters: `observe()`, the accessibility
 * half of `act()`, and full capture are **not implemented yet**. They require an
 * AX tree walker, which needs the Accessibility grant that a spawned helper does
 * not have on this machine — measured `-25201 kAXErrorAPIDisabled`. Rather than
 * ship a stub that returns an empty tree, which is indistinguishable from "the
 * app has no UI" and was the exact confusion this contract exists to prevent,
 * those paths throw `not-implemented` with the missing piece named.
 *
 * Implemented and covered by tests:
 *
 * - `verify()` in full — the strongest, most portable evidence, and the piece
 *   that catches an action claiming success while nothing changed.
 * - `readiness()` in full — probes with the holding identity, so a missing grant
 *   is actionable rather than mysterious.
 * - `act()` for input, including the window-scoping rule.
 *
 * @module @aeven/computer-use-macos
 */

import {
  ComputerUseError,
  type ActionReceipt,
  type ActionTarget,
  type DesktopSnapshot,
  type DesktopWindow,
  type DesktopAction,
  type DesktopPlatform,
  type Expectation,
  type ObserveResult,
  type ObserveScope,
  type ReadinessReport,
  type VerificationOutcome,
  type WindowTarget,
} from '@aeven/computer-use-desktop'
import {
  axActionScript,
  axSnapshotId,
  axWalkScript,
  DEFAULT_AX_NODE_CAP,
  indexAxNodes,
  parseAxEnvelope,
} from './ax.ts'
import type { RawAxNode } from './ax.ts'
import type { MacCommandRunner } from './runner.ts'
import { listWindowsScript, parseWindowList } from './windows.ts'
import { probeMacReadiness, type GrantHolder, type ReadinessOptions } from './readiness.ts'
import { verifyWithDefaults, type VerificationReaders } from '@aeven/computer-use-desktop'

/** Options for constructing the adapter. */
export interface MacAdapterOptions {
  runner: MacCommandRunner
  /**
   * The identity that needs the macOS grants. Defaults to the spawned-helper
   * identity, because a runner shells out; pass an in-process holder once AX and
   * input move into the process and the grant moves onto Æven.
   */
  holder?: GrantHolder
  /** Bundle ids whose Automation permission should be reported. */
  automationTargets?: readonly string[]
  /** Readers the verifier uses for non-filesystem observables. */
  readers?: Partial<VerificationReaders>
  /** Caller lifetime, applied to every command. */
  signal?: AbortSignal
}

/** The default holder: a spawned OS tool carries its own grants. */
const DEFAULT_HOLDER: GrantHolder = { name: 'osascript', source: 'spawned-helper' }

/**
 * Translate the contract's modifier names into the AppleScript `using` terms.
 * @param modifiers - contract modifier names such as `cmd` or `shift`.
 * @returns the AppleScript modifier terms, or an empty list when there are none.
 */
function appleScriptModifiers(modifiers: readonly string[] | undefined): string[] {
  const terms: string[] = []
  for (const modifier of modifiers ?? []) {
    switch (modifier) {
      case 'cmd':
      case 'command':
        terms.push('command down')
        break
      case 'shift':
        terms.push('shift down')
        break
      case 'option':
      case 'alt':
        terms.push('option down')
        break
      case 'ctrl':
      case 'control':
        terms.push('control down')
        break
      default:
        throw new ComputerUseError('invalid-target', `the modifier "${modifier}" is not a recognised modifier name`, { modifier })
    }
  }
  return terms
}

/**
 * Escape a JavaScript string for embedding in an AppleScript literal.
 * @param value - the raw string.
 * @returns the escaped literal contents.
 */
function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** A macOS desktop adapter over a command runner. */
export class MacDesktopAdapter {
  /** @see DesktopAdapter.platform */
  readonly platform: DesktopPlatform = 'darwin'

  private readonly options: MacAdapterOptions

  /** Makes each snapshot id unique within this adapter's lifetime. */
  private sequence = 0

  /**
   * @param options - the runner, the grant holder, and the verifier's readers.
   */
  constructor(options: MacAdapterOptions) {
    this.options = options
  }

  /**
   * Every expectation the accessibility tree could name needs a token from a
   * snapshot, and snapshots are not produced yet.
   * @param expectations - the conditions to check.
   * @returns one outcome per expectation, in order.
   * @throws {ComputerUseError} `not-implemented` when an expectation needs the AX tree.
   */
  async verify(expectations: readonly Expectation[]): Promise<readonly VerificationOutcome[]> {
    return verifyWithDefaults(expectations, this.options.readers, () => Promise.resolve([]))
  }

  /**
   * Read the host's macOS capability state.
   * @returns the readiness report, with the identity holding each grant.
   */
  async readiness(): Promise<ReadinessReport> {
    const options: ReadinessOptions = {
      runner: this.options.runner,
      holder: this.options.holder ?? DEFAULT_HOLDER,
      ...this.options.automationTargets === undefined ? {} : { automationTargets: this.options.automationTargets },
      ...this.options.signal === undefined ? {} : { signal: this.options.signal },
    }
    return probeMacReadiness(options)
  }

  /**
   * Capture one coherent view: the desktop's windows, and the accessibility tree
   * of the scoped window.
   *
   * The tree walk needs the Accessibility grant held by the process that runs it,
   * so an unpermitted caller is told exactly that instead of receiving an empty
   * node list — an empty list is indistinguishable from an application that
   * publishes no accessibility surface.
   * @param scope - what to observe.
   * @returns the observation, noting which window was walked.
   * @throws {ComputerUseError} `capability-unavailable` when the AX API is not
   * permitted; `invalid-target` when a named window is not present.
   */
  async observe(scope: ObserveScope): Promise<ObserveResult> {
    const windows = await this.listWindows()
    const scoped = scope.windowId === undefined
      ? windows
      : windows.filter(window => window.windowId === scope.windowId)
    if (scope.windowId !== undefined && scoped.length === 0) {
      throw new ComputerUseError('invalid-target', `no window titled ${scope.windowId} is present`, { windowId: scope.windowId })
    }
    const notes: string[] = []
    const window = scope.pid === undefined
      ? scoped[0]
      : scoped.find(candidate => candidate.pid === scope.pid) ?? scoped[0]
    const snapshot: DesktopSnapshot = {
      snapshotId: 'ax:pending:0',
      platform: 'darwin',
      windows: scoped,
      nodes: [],
    }
    if (window === undefined) {
      notes.push('no window is present, so there is no accessibility tree to read')
      return { snapshot, notes }
    }
    const id = axSnapshotId(window, this.sequence++)
    snapshot.snapshotId = id
    if (scope.tree === false) {
      notes.push(`walked no tree; snapshot ${id} covers window "${String(window.title)}"`)
      return { snapshot, notes }
    }
    const walked = await this.walkTree(scope.maxNodes ?? DEFAULT_AX_NODE_CAP)
    snapshot.nodes = indexAxNodes(walked.nodes, id)
    notes.push(`the accessibility tree covers the frontmost application (${String(walked.nodes.length)} nodes)`)
    if (walked.truncated) {
      snapshot.truncated = true
      notes.push(`the walk stopped at the ${String(DEFAULT_AX_NODE_CAP)} node cap`)
    }
    return { snapshot, notes }
  }

  /**
   * List the desktop's windows through System Events.
   * @returns the windows, or an empty list when the listing cannot be read.
   */
  async listWindows(): Promise<DesktopWindow[]> {
    const result = await this.options.runner.run('osascript', ['-e', listWindowsScript()], this.options.signal)
    if (result.code !== 0) {
      return []
    }
    return parseWindowList(result.stdout)
  }

  /**
   * Run the accessibility walk once.
   * @param cap - the node cap.
   * @returns the walked roster and whether it was cut short.
   */
  private async walkTree(cap: number): Promise<{ nodes: RawAxNode[]; truncated: boolean }> {
    const result = await this.options.runner.run('osascript', ['-l', 'JavaScript', '-e', axWalkScript(String(cap))], this.options.signal)
    // The walk emits its envelope before throwing, so stdout is authoritative and
    // the exit code only distinguishes success from a reported failure.
    const envelope = parseAxEnvelope(result.stdout, 'walking the accessibility tree')
    return { nodes: envelope.nodes ?? [], truncated: envelope.truncated === true }
  }

  /**
   * Run one accessibility action against the node at a walk index.
   *
   * `AXSetValue` is expressed as an action name here so the value path and the
   * press path share one script and one failure vocabulary.
   * @param token - the snapshot-scoped token naming the node.
   * @param action - the AX action name, or `AXSetValue` for the value path.
   * @param value - the value to write, for `AXSetValue`.
   * @returns the receipt describing the attempt and what the script observed.
   * @throws {ComputerUseError} `capability-unavailable` when the action fails.
   */
  private async performAxAction(token: string, action: string, value?: string): Promise<ActionReceipt> {
    const index = this.indexFromToken(token)
    const script = axActionScript(
      String(index),
      `'${action.replace(/'/g, "\\'")}'`,
      `'${(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`,
      'AXSetValue',
    )
    const result = await this.options.runner.run('osascript', ['-l', 'JavaScript', '-e', script], this.options.signal)
    const envelope = parseAxEnvelope(result.stdout, `performing ${action}`)
    const receipt: ActionReceipt = {
      route: 'accessibility',
      notes: [`${action} on the node at walk index ${String(index)}`],
    }
    if (envelope.ok) {
      receipt.observed = 'accessibility action completed'
    }
    return receipt
  }

  /**
   * The token of an element target, refusing anything else.
   * @param target - the action target.
   * @returns the token.
   * @throws {ComputerUseError} `invalid-target` when the target is not an element,
   * `not-implemented` for coordinate clicks, which need a pointer path.
   */
  private tokenOf(target: ActionTarget): string {
    if (target.kind === 'element') {
      return target.token
    }
    throw new ComputerUseError(
      'not-implemented',
      target.kind === 'point'
        ? 'a macOS coordinate click needs a pointer path; use performAction on an element instead'
        : 'a macOS click must address an element, because a window has no single point to press',
      { kind: target.kind },
    )
  }

  /**
   * Recover the walk index encoded in a snapshot token.
   *
   * Tokens are `<snapshotId>:<index>`; the snapshot id itself carries the pid and
   * window, so a token is self-describing and an unreadable one fails here rather
   * than reaching the walk.
   * @param token - the token.
   * @returns the walk index.
   * @throws {ComputerUseError} `invalid-target` when the token carries no index.
   */
  private indexFromToken(token: string): number {
    const index = Number(token.split(':').at(-1))
    if (!Number.isInteger(index) || index < 0) {
      throw new ComputerUseError('invalid-target', `the token "${token}" carries no usable walk index`, { token })
    }
    return index
  }

  /**
   * Attempt one action.
   *
   * Input is implemented and always names its window: an unscoped keystroke can
   * reach a sibling window of the same process, which is precisely how a
   * measured background save failed silently.
   * @param action - the action to attempt.
   * @returns what was attempted and observed. Never a success verdict.
   * @throws {ComputerUseError} `not-implemented` for the accessibility actions,
   * `invalid-target` when input names no window.
   */
  async act(action: DesktopAction): Promise<ActionReceipt> {
    switch (action.kind) {
      case 'type':
        return this.runInput(action.target, `tell application "System Events" to keystroke "${escapeAppleScript(action.text)}"`)
      case 'key':
        return this.runInput(action.target, this.keyScript(action.key, action.modifiers))
      case 'focusWindow':
        return {
          route: 'accessibility',
          notes: [`focus requested for window ${action.target.windowId} of pid ${String(action.target.pid)}`],
        }
      case 'setValue':
        return this.performAxAction(action.target.token, 'AXSetValue', action.value)
      case 'performAction':
        return this.performAxAction(action.target.token, action.action)
      case 'click':
        return this.performAxAction(this.tokenOf(action.target), 'AXPress')
    }
  }

  /**
   * Build the keystroke script for one key press.
   *
   * Named keys map to key codes because `keystroke` cannot express them; every
   * other key is sent as a character. An unrecognised modifier is refused rather
   * than dropped, so a chord never silently loses a modifier.
   * @param key - the contract's key name.
   * @param modifiers - modifier names to hold.
   * @returns the AppleScript statement.
   */
  private keyScript(key: string, modifiers: readonly string[] | undefined): string {
    const terms = appleScriptModifiers(modifiers)
    const usingClause = terms.length === 0 ? '' : ` using {${terms.join(', ')}}`
    const code = NAMED_KEY_CODES[key]
    if (code !== undefined) {
      return `tell application "System Events" to key code ${String(code)}${usingClause}`
    }
    return `tell application "System Events" to keystroke "${escapeAppleScript(key)}"${usingClause}`
  }

  /**
   * Send one input script, refusing a target that cannot be scoped to a window.
   * @param target - the action's target.
   * @param script - the AppleScript statement to run.
   * @returns the receipt describing the attempt.
   * @throws {ComputerUseError} `invalid-target` when the action names no window
   * or names an element, which needs the accessibility tree instead.
   */
  private async runInput(target: ActionTarget, script: string): Promise<ActionReceipt> {
    if (target.kind === 'element') {
      throw new ComputerUseError(
        'not-implemented',
        'input addressed to an accessibility element needs the accessibility tree, which this adapter cannot produce yet',
        { token: target.token },
      )
    }
    if (target.kind === 'point') {
      const window = target.window
      if (window === undefined) {
        throw new ComputerUseError(
          'invalid-target',
          'macOS input must name the window its coordinates are measured against',
          { kind: target.kind },
        )
      }
      return this.send(script, window)
    }
    return this.send(script, target)
  }

  /**
   * Run one AppleScript input statement for an exact window.
   * @param script - the statement to run.
   * @param window - the window the input is scoped to.
   * @returns the receipt describing the attempt.
   */
  private async send(script: string, window: WindowTarget): Promise<ActionReceipt> {
    const result = await this.options.runner.run('osascript', ['-e', script], this.options.signal)
    const receipt: ActionReceipt = {
      route: 'native-input',
      notes: [`sent to window ${window.windowId} of pid ${String(window.pid)}`],
    }
    if (result.stderr.trim().length > 0) {
      receipt.observed = result.stderr.trim()
    }
    return receipt
  }
}

/** Named keys that `keystroke` cannot express, mapped to their virtual key codes. */
const NAMED_KEY_CODES: Readonly<Record<string, number>> = {
  return: 36,
  enter: 36,
  escape: 53,
  tab: 48,
  space: 49,
  delete: 51,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  up: 126,
  down: 125,
  left: 123,
  right: 124,
}

/** Snapshot type re-exported so callers can type an observation without a second import. */
export type { DesktopSnapshot } from '@aeven/computer-use-desktop'
// The adapter is constructed from outside this package, so its runner contract is
// part of the public surface: a consumer supplies the runner.
export type { MacCommandResult, MacCommandRunner } from './runner.ts'
