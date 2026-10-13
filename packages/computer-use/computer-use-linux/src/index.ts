/**
 * The Linux desktop adapter.
 *
 * Linux is the platform where capability genuinely varies, so this adapter is
 * built around **reporting rather than assuming**. Window control is delegated to
 * whichever backend answers (Hyprland, i3/sway, then EWMH), and input to whichever
 * of `xdotool`/`wtype`/`ydotool` is present. `readiness()` names what is missing,
 * because an empty window list and a missing backend are indistinguishable to a
 * caller otherwise.
 *
 * Implemented and covered by tests: `verify()`, `readiness()`, window
 * observation, window focus, and text/key input. The AT-SPI tree and the
 * element-addressed actions are **not** implemented yet; they refuse with
 * `not-implemented` rather than returning an empty tree, since an empty tree
 * cannot be told apart from an application that publishes no accessibility
 * surface — the confusion that cost a measured twenty-plus calls elsewhere.
 *
 * @module @aeven/computer-use-linux
 */

import {
  ComputerUseError,
  type ActionReceipt,
  type ActionTarget,
  type DesktopAction,
  type DesktopNode,
  type DesktopPlatform,
  type DesktopSnapshot,
  type DesktopWindow,
  type Expectation,
  type ObserveResult,
  type ObserveScope,
  type ReadinessReport,
  type VerificationOutcome,
  verifyWithDefaults as verify,
  type VerificationReaders,
} from '@aeven/computer-use-desktop'
import { WINDOW_BACKENDS, type WindowBackend } from './backends.ts'
import { probeLinuxReadiness, type LinuxReadinessOptions } from './readiness.ts'
import { describeLinuxHost, type LinuxCommandRunner, type LinuxHost } from './runner.ts'

/** Options for constructing the adapter. */
export interface LinuxAdapterOptions {
  runner: LinuxCommandRunner
  /** Session facts; derived from the environment when omitted. */
  host?: LinuxHost
  /** Readers the verifier uses for non-filesystem observables. */
  readers?: Partial<VerificationReaders>
}

/** A Linux desktop adapter over a command runner. */
export class LinuxDesktopAdapter {
  /**
   * The platform this adapter drives.
   * @see DesktopAdapter.platform
   */
  readonly platform: DesktopPlatform = 'linux'

  private readonly options: LinuxAdapterOptions

  private readonly host: LinuxHost

  /**
   * @param options - the runner, the session facts, and the verifier's readers.
   */
  constructor(options: LinuxAdapterOptions) {
    this.options = options
    this.host = options.host ?? describeLinuxHost()
  }

  /**
   * Read the host's Linux capability state.
   * @returns the readiness report, naming every backend that was tried.
   */
  async readiness(): Promise<ReadinessReport> {
    const options: LinuxReadinessOptions = { runner: this.options.runner, host: this.host }
    return probeLinuxReadiness(options)
  }

  /* jscpd:ignore-start -- the three adapters verify through one shared helper; only the window source differs. */
  /**
   * Verify by independent read-back against the window list this adapter reads.
   * @param e - the expectations to check.
   * @returns one outcome per expectation, in the same order.
   */
  async verify(e: readonly Expectation[]): Promise<readonly VerificationOutcome[]> {
    return verify(e, this.options.readers, async () => await this.listWindows())
  }
  /* jscpd:ignore-end */

  /**
   * Capture one coherent view of the desktop, or of the window the scope names.
   *
   * {@link DesktopAdapter.observe} owns what a scope means; this adapter differs
   * only in which backend answers, which the returned notes name. The AT-SPI tree
   * is not implemented yet, so no accessibility nodes are returned, and a note
   * says so rather than leaving an empty list to read as an application that
   * publishes no tree.
   * @param scope - what to observe; `windowId` narrows the result to that window.
   * @returns the observation and the notes explaining how it was narrowed.
   * @throws {ComputerUseError} `invalid-target` when the named window is absent.
   */
  async observe(scope: ObserveScope): Promise<ObserveResult> {
    const { windows, backend } = await this.listWindowsWithBackend()
    const scoped = scope.windowId === undefined ? windows : windows.filter(window => window.windowId === scope.windowId)
    if (scope.windowId !== undefined && scoped.length === 0) {
      throw new ComputerUseError('invalid-target', `no window with id ${scope.windowId} is present`, { windowId: scope.windowId })
    }
    const notes = [`windows came from the ${backend} backend`]
    if (scope.tree !== false) {
      notes.push('the AT-SPI tree is not implemented yet, so no accessibility nodes are returned')
    }
    const snapshot: DesktopSnapshot = {
      snapshotId: `linux:${String(Date.now())}`,
      platform: 'linux',
      windows: scoped,
      nodes: [],
    }
    return { snapshot, notes }
  }

  /**
   * Attempt one action.
   *
   * Text and key input go through the input ladder; element-addressed actions
   * refuse, because they need a tree this adapter cannot yet read.
   * @param action - the action to attempt.
   * @returns the receipt describing the attempt. Never a success verdict.
   * @throws {ComputerUseError} `not-implemented` for element-addressed actions,
   * `invalid-target` when input names no window.
   */
  async act(action: DesktopAction): Promise<ActionReceipt> {
    switch (action.kind) {
      case 'focusWindow':
        return this.focusWindow(action.target.windowId)
      case 'type':
      case 'key':
        return this.sendInput(action)
      case 'click':
      case 'setValue':
      case 'performAction':
        throw new ComputerUseError(
          'not-implemented',
          `the "${action.kind}" action needs the accessibility tree or a pointer path, neither of which this adapter implements yet`,
          { kind: action.kind },
        )
    }
  }

  /**
   * Focus one window through whichever backend knows it.
   *
   * Each backend uses its own window identifier, so the id is tried against each
   * in turn rather than being assumed to belong to a particular one.
   * @param windowId - the backend's window identifier.
   * @returns the receipt describing the attempt.
   * @throws {ComputerUseError} `capability-unavailable` when no backend could focus it.
   */
  private async focusWindow(windowId: string): Promise<ActionReceipt> {
    const tried: string[] = []
    for (const backend of WINDOW_BACKENDS) {
      const result = await this.options.runner.run(backend.command, backend.focusArgs(windowId), this.host.signal)
      if (result.code === 0) {
        return { route: 'accessibility', notes: [`focus requested through the ${backend.name} backend`] }
      }
      tried.push(`${backend.name} (${result.stderr.trim() || `exit ${String(result.code)}`})`)
    }
    throw new ComputerUseError('capability-unavailable', `no window backend could focus ${windowId}`, { tried })
  }

  /**
   * Send text or a key through the input ladder.
   * @param action - the type or key action.
   * @returns the receipt describing the attempt.
   * @throws {ComputerUseError} `invalid-target` when the action names no window,
   * `capability-unavailable` when no input tool answers.
   */
  private async sendInput(action: Extract<DesktopAction, { kind: 'type' | 'key' }>): Promise<ActionReceipt> {
    if (action.target.kind === 'element') {
      throw new ComputerUseError(
        'not-implemented',
        'element-addressed input needs the accessibility tree, which this adapter cannot read yet',
        { token: action.target.token },
      )
    }
    const window = this.requireWindow(action.target, action.kind)
    await this.focusWindow(window.windowId)
    const text = action.kind === 'type'
      ? action.text
      : this.chord(action.key, action.modifiers)
    // xdotool is preferred where X11 is present: it can address a window directly
    // and resolves keys through the live XKB layout.
    if (this.host.hasX11) {
      const xdotool = await this.options.runner.run('xdotool', ['type', '--window', window.windowId, '--', text], this.host.signal)
      if (xdotool.code === 0) {
        return { route: 'native-input', notes: [`typed through xdotool into window ${window.windowId}`] }
      }
    }
    const wtype = await this.options.runner.run('wtype', ['--', text], this.host.signal)
    if (wtype.code === 0) {
      return { route: 'native-input', notes: [`typed through wtype after focusing window ${window.windowId}`] }
    }
    const ydotool = await this.options.runner.run('ydotool', ['type', '--', text], this.host.signal)
    if (ydotool.code === 0) {
      return { route: 'native-input', notes: [`typed through ydotool after focusing window ${window.windowId}`] }
    }
    throw new ComputerUseError(
      'capability-unavailable',
      'no input tool accepted the text; xdotool, wtype, and ydotool all failed',
      { windowId: window.windowId },
    )
  }

  /**
   * Resolve the window an input action must name.
   * @param target - the action target.
   * @param kind - the action kind, for the failure message.
   * @returns the window target.
   * @throws {ComputerUseError} `invalid-target` when the action names no window.
   */
  private requireWindow(target: ActionTarget, kind: string): { pid: number; windowId: string } {
    if (target.kind === 'window') {
      return target
    }
    if (target.kind === 'point' && target.window !== undefined) {
      return target.window
    }
    throw new ComputerUseError(
      'invalid-target',
      `a Linux ${kind} action must name the window it targets; input otherwise follows focus`,
      { kind: target.kind },
    )
  }

  /**
   * Build a key chord from the contract's key name and modifiers.
   * @param key - the key name.
   * @param modifiers - modifier names to hold.
   * @returns the chord in `modifier+key` form.
   * @throws {ComputerUseError} `invalid-target` for an unrecognised modifier.
   */
  private chord(key: string, modifiers: readonly string[] | undefined): string {
    const parts: string[] = []
    for (const modifier of modifiers ?? []) {
      switch (modifier) {
        case 'cmd':
        case 'command':
          parts.push('super')
          break
        case 'ctrl':
        case 'control':
          parts.push('ctrl')
          break
        case 'shift':
          parts.push('shift')
          break
        case 'option':
        case 'alt':
          parts.push('alt')
          break
        default:
          throw new ComputerUseError('invalid-target', `the modifier "${modifier}" is not a recognised modifier name`, { modifier })
      }
    }
    parts.push(key)
    return parts.join('+')
  }

  /**
   * List the desktop's windows, reporting which backend answered.
   * @returns the windows and the backend name.
   * @throws {ComputerUseError} `capability-unavailable` when no backend answers.
   */
  async listWindowsWithBackend(): Promise<{ windows: DesktopWindow[]; backend: string }> {
    const tried: string[] = []
    for (const backend of WINDOW_BACKENDS) {
      const parsed = await this.tryBackend(backend, tried)
      if (parsed !== undefined) {
        return { windows: parsed, backend: backend.name }
      }
    }
    throw new ComputerUseError('capability-unavailable', `no window backend answered; tried: ${tried.join('; ')}`, { tried })
  }

  /**
   * List the desktop's windows.
   * @returns the windows, or an empty list when no backend answers.
   */
  async listWindows(): Promise<DesktopWindow[]> {
    try {
      return (await this.listWindowsWithBackend()).windows
    } catch {
      return []
    }
  }

  /**
   * Try one backend, recording why it failed when it does.
   * @param backend - the backend to try.
   * @param tried - accumulator for the failure descriptions.
   * @returns the windows, or `undefined` when this backend could not answer.
   */
  private async tryBackend(backend: WindowBackend, tried: string[]): Promise<DesktopWindow[] | undefined> {
    const result = await this.options.runner.run(backend.command, backend.listArgs, this.host.signal)
    if (result.code !== 0) {
      tried.push(`${backend.name} (${result.stderr.trim() || `exit ${String(result.code)}`})`)
      return undefined
    }
    try {
      return backend.parse(result.stdout).map(window => ({
        windowId: window.windowId,
        pid: window.pid,
        app: { id: String(window.pid) },
        title: window.title,
        bounds: window.bounds,
        onScreen: window.bounds.width > 0 && window.bounds.height > 0,
      }))
    } catch (error) {
      tried.push(`${backend.name} (${error instanceof Error ? error.message : String(error)})`)
      return undefined
    }
  }
}

/** Node type re-exported so a caller can type an observation without a second import. */
export type { DesktopNode }
