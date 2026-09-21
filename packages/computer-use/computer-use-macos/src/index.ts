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
  type DesktopAction,
  type DesktopPlatform,
  type Expectation,
  type ObserveResult,
  type ObserveScope,
  type ReadinessReport,
  type VerificationOutcome,
  type WindowTarget,
} from '@aeven/computer-use-desktop'
import type { MacCommandRunner } from './runner.ts'
import { probeMacReadiness, type GrantHolder, type ReadinessOptions } from './readiness.ts'
import { checkExpectations, type VerificationReaders } from '@aeven/computer-use-desktop'

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

/** A reader that reports the observable as unavailable rather than guessing. */
const ABSENT_NODE_VALUES: VerificationReaders['nodeValue'] = {
  read: () => Promise.resolve(undefined),
}

/** A reader that reports no windows rather than inventing titles. */
const NO_WINDOWS: VerificationReaders['windowTitles'] = {
  list: () => Promise.resolve([]),
}

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
    return checkExpectations(expectations, {
      nodeValue: this.options.readers?.nodeValue ?? ABSENT_NODE_VALUES,
      windowTitles: this.options.readers?.windowTitles ?? NO_WINDOWS,
    })
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
   * Observation requires the accessibility tree.
   * @param scope - the requested scope; echoed in the failure so a caller can see
   * which observation was refused.
   * @returns never.
   * @throws {ComputerUseError} `not-implemented` naming the missing piece.
   */
  observe(scope: ObserveScope): Promise<ObserveResult> {
    return Promise.reject(
      new ComputerUseError(
        'not-implemented',
        'macOS observation needs an AX tree walker, which requires the Accessibility grant held by the calling process; a spawned helper does not have it, so no tree can be produced yet',
        { scope },
      ),
    )
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
      case 'click':
      case 'setValue':
      case 'performAction':
        throw new ComputerUseError('not-implemented', `the "${action.kind}" action needs the accessibility tree, which this adapter cannot produce yet`, {
          kind: action.kind,
        })
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
