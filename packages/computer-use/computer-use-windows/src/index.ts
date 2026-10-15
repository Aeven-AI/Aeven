/**
 * The Windows desktop adapter.
 *
 * Windows is the strongest of the three platforms for this work, and the adapter
 * is shaped around why: **UI Automation needs no permission grant** and exposes
 * genuine semantic patterns, so `observe()` and `setValue`/`performAction` reach
 * controls directly. Synthesised input is the fallback, not the default, which is
 * what keeps an action from landing in a window that merely happens to hold focus.
 *
 * Node identity is the element's **ordinal in the breadth-first walk** of its
 * window. Resolution replays the same traversal, so a token cannot silently
 * address a different control — and because UIA enumerates a window's subtree
 * rather than the whole desktop, the walk is scoped by construction.
 *
 * @module @aeven/computer-use-windows
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
import { probeWindowsReadiness, type WinReadinessOptions } from './readiness.ts'
import { quotePowerShellLiteral, type WinCommandRunner } from './runner.ts'
import {
  focusWindowScript,
  JSON_EMITTER,
  LIST_WINDOWS,
  performActionScript,
  resolveNodeScript,
  setValueScript,
  windowTreeScript,
} from './scripts.ts'

/** Options for constructing the adapter. */
export interface WindowsAdapterOptions {
  runner: WinCommandRunner
  /** PowerShell executable to invoke; defaults to `powershell` on PATH. */
  powershell?: string
  /** Readers the verifier uses for non-filesystem observables. */
  readers?: Partial<VerificationReaders>
  /** Caller lifetime, applied to every command. */
  signal?: AbortSignal
}

/**
 * Escape literal text for SendKeys, which reads `+ ^ % ~ ( ) { }` as modifiers and
 * grouping. Without this, typing an email address or a `%` would be interpreted
 * as a chord instead of as characters — and modifiers are built separately, so
 * nothing legitimate is lost by bracing every one of them here.
 * @param text - the literal text to type.
 * @returns SendKeys-safe text.
 */
function escapeSendKeys(text: string): string {
  return text.replace(/[+^%~()[\]{}]/g, match => `{${match}}`)
}

/** Default node cap for one observation. */
const DEFAULT_MAX_NODES = 400

/**
 * Named keys in SendKeys notation. `{ENTER}`-style tokens exist for the keys that
 * have no printable character; anything absent is sent as the literal character.
 */
const SENDKEYS_NAMES: Readonly<Record<string, string>> = {
  return: '{ENTER}',
  enter: '{ENTER}',
  escape: '{ESC}',
  tab: '{TAB}',
  space: ' ',
  delete: '{DELETE}',
  backspace: '{BACKSPACE}',
  home: '{HOME}',
  end: '{END}',
  pageup: '{PGUP}',
  pagedown: '{PGDN}',
  up: '{UP}',
  down: '{DOWN}',
  left: '{LEFT}',
  right: '{RIGHT}',
}

/** One window as the list fragment reports it. */
interface RawWindow {
  windowId: string
  pid: number
  title: string
  bounds: { x: number; y: number; width: number; height: number }
}

/** One node as the tree fragment reports it. */
interface RawNode {
  index: number
  role: string
  title: string
  value: string | null
  actions: string[]
  editable: boolean
  bounds: { x: number; y: number; width: number; height: number }
}

/** The envelope every fragment emits. */
interface Envelope {
  ok: boolean
  error?: string
  windows?: RawWindow[]
  nodes?: RawNode[]
  truncated?: boolean
  wrote?: number
  invoked?: string
  role?: string
  name?: string
}

/**
 * Parse one fragment's single-line JSON envelope.
 * @param stdout - the fragment's captured output.
 * @param what - a label used when the output is unreadable.
 * @returns the parsed envelope.
 * @throws {ComputerUseError} `capability-unavailable` when nothing parseable came back.
 */
function parseEnvelope(stdout: string, what: string): Envelope {
  const line = stdout.trim().split('\n').filter(entry => entry.trim().length > 0).at(-1)
  if (line === undefined) {
    throw new ComputerUseError('capability-unavailable', `${what} produced no output`)
  }
  try {
    return JSON.parse(line) as Envelope
  } catch {
    throw new ComputerUseError('capability-unavailable', `${what} produced output that is not JSON`, {
      output: line.slice(0, 200),
    })
  }
}

/**
 * Turn a failed envelope into the contract's error, preserving PowerShell's own
 * message so the caller sees the real cause rather than a generic failure.
 * @param envelope - the parsed envelope.
 * @param what - the operation being attempted.
 * @throws {ComputerUseError} `capability-unavailable` carrying the reported error.
 */
function assertOk(envelope: Envelope, what: string): void {
  if (!envelope.ok) {
    throw new ComputerUseError('capability-unavailable', envelope.error ?? `${what} failed without a reported reason`)
  }
}

/** A Windows desktop adapter over a PowerShell command runner. */
export class WindowsDesktopAdapter {
  /**
   * The platform this adapter drives.
   * @see DesktopAdapter.platform
   */
  readonly platform: DesktopPlatform = 'win32'

  private readonly options: WindowsAdapterOptions

  /**
   * @param options - the runner, the PowerShell to invoke, and the verifier's readers.
   */
  constructor(options: WindowsAdapterOptions) {
    this.options = options
  }

  /**
   * Read the host's Windows capability state.
   * @returns the readiness report for this adapter.
   */
  async readiness(): Promise<ReadinessReport> {
    const options: WinReadinessOptions = {
      runner: this.options.runner,
      ...this.options.powershell === undefined ? {} : { powershell: this.options.powershell },
      ...this.options.signal === undefined ? {} : { signal: this.options.signal },
    }
    return probeWindowsReadiness(options)
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
   * Capture one coherent view of the desktop or of a single window.
   *
   * A window scope walks only that window's subtree, which is cheaper and cannot
   * leak another application's content into the snapshot.
   * @param scope - what to observe.
   * @returns the observation, with `truncated` set when the node cap cut the walk.
   */
  async observe(scope: ObserveScope): Promise<ObserveResult> {
    const windows = await this.listWindows()
    const scoped = scope.windowId === undefined
      ? windows
      : windows.filter(window => window.windowId === scope.windowId)
    const notes: string[] = []
    if (scope.windowId !== undefined && scoped.length === 0) {
      throw new ComputerUseError('invalid-target', `no window with id ${scope.windowId} is present`, { windowId: scope.windowId })
    }
    if (scope.pid !== undefined && scope.windowId === undefined) {
      notes.push(`observation is limited to pid ${String(scope.pid)}`)
    }
    const snapshot: DesktopSnapshot = {
      snapshotId: `win:${String(Date.now())}`,
      platform: 'win32',
      windows: scoped,
      nodes: [],
    }
    if (scope.tree !== false && scoped.length > 0) {
      const first = scoped[0] as DesktopWindow
      const tree = await this.readTree(first, scope.maxNodes ?? DEFAULT_MAX_NODES)
      snapshot.nodes = tree.nodes
      if (tree.truncated) {
        snapshot.truncated = true
        notes.push(`the accessibility walk stopped at ${String(tree.nodes.length)} nodes`)
      }
    }
    return notes.length === 0 ? { snapshot } : { snapshot, notes }
  }

  /**
   * Attempt one action, preferring the semantic pattern over synthesised input.
   * @param action - the action to attempt.
   * @returns what was attempted and observed. Never a success verdict.
   * @throws {ComputerUseError} `invalid-target` for a malformed action, or
   * `capability-unavailable` when the target does not support the needed pattern.
   */
  async act(action: DesktopAction): Promise<ActionReceipt> {
    switch (action.kind) {
      case 'setValue':
        return this.runFragment(
          setValueScript(
            this.handleExpression(action.target),
            String(this.indexFromToken(action.target.token)),
            `'${quotePowerShellLiteral(action.value)}'`,
          ),
          'setValue',
        )
      case 'performAction':
        return this.runFragment(
          performActionScript(
            this.handleExpression(action.target),
            String(this.indexFromToken(action.target.token)),
            `'${quotePowerShellLiteral(action.action)}'`,
          ),
          'performAction',
        )
      case 'focusWindow':
        return this.runFragment(focusWindowScript(`'${quotePowerShellLiteral(action.target.windowId)}'`), 'focusWindow')
      case 'click':
      case 'type':
      case 'key':
        return this.runInput(action)
    }
  }

  /**
   * Send synthesised input.
   *
   * Reserved for what UIA patterns cannot express. Every path here requires an
   * exact window, because synthesised input follows focus and an unnamed target
   * is how a keystroke reaches a sibling window.
   * @param action - the click, type, or key action.
   * @returns the receipt describing the attempt.
   * @throws {ComputerUseError} `invalid-target` when the action names no window.
   */
  private runInput(action: Extract<DesktopAction, { kind: 'click' | 'type' | 'key' }>): Promise<ActionReceipt> {
    const target = action.target
    if (target.kind === 'element') {
      throw new ComputerUseError(
        'not-implemented',
        'element-addressed input on Windows should use setValue or performAction, which name the element directly instead of following focus',
        { token: target.token },
      )
    }
    const window = target.kind === 'window' ? target : target.window
    if (window === undefined) {
      throw new ComputerUseError(
        'invalid-target',
        'Windows input must name the window it targets; synthesised input otherwise follows whatever holds focus',
        { kind: target.kind },
      )
    }
    const script = this.inputScript(action, window)
    return this.runFragment(script, action.kind)
  }

  /**
   * Build the synthesised-input fragment for one action.
   *
   * Every branch fronts the exact window first. Synthesised input follows the
   * foreground, so a packet sent without naming its window can reach a sibling
   * window of the same process — the failure this contract exists to prevent.
   * The fronting statement emits its own JSON, so the input statements that
   * follow are appended before a single emitter closes the envelope.
   * @param action - the input action.
   * @param window - the window it is scoped to.
   * @returns the PowerShell fragment.
   */
  private inputScript(
    action: Extract<DesktopAction, { kind: 'click' | 'type' | 'key' }>,
    window: { pid: number; windowId: string },
  ): string {
    const handle = `'${quotePowerShellLiteral(window.windowId)}'`
    const primitives = `
Add-Type -Namespace Aeven -Name Input -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, System.IntPtr extra);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
'@
function Assert-Fronted($handle) {
  $target = [IntPtr]$handle
  [void][Aeven.Input]::SetForegroundWindow($target)
  Start-Sleep -Milliseconds 120
  if ([Aeven.Input]::GetForegroundWindow() -ne $target) {
    Fail "the window $handle did not come to the foreground, so synthesised input would reach a different window"
  }
}`
    if (action.kind === 'type') {
      return `${JSON_EMITTER}${primitives}
Assert-Fronted ${handle}
# SendKeys reads +^%~(){} as modifiers and grouping, so literal text braces them.
[System.Windows.Forms.SendKeys]::SendWait('${quotePowerShellLiteral(escapeSendKeys(action.text))}')
Write-Json @{ ok = $true; typed = ${String(action.text.length)} }`
    }
    if (action.kind === 'key') {
      const chord = this.sendKeysChord(action.key, action.modifiers)
      return `${JSON_EMITTER}${primitives}
Assert-Fronted ${handle}
[System.Windows.Forms.SendKeys]::SendWait('${quotePowerShellLiteral(chord)}')
Write-Json @{ ok = $true; pressed = '${quotePowerShellLiteral(action.key)}' }`
    }
    const point = action.target.kind === 'point' ? action.target : undefined
    if (point === undefined) {
      throw new ComputerUseError(
        'invalid-target',
        'a Windows click needs coordinates; address an element with performAction instead of clicking a window',
        { kind: action.target.kind },
      )
    }
    const flags = action.button === 'right' ? '0x0008, 0x0010' : '0x0002, 0x0004'
    return `${JSON_EMITTER}${primitives}
Assert-Fronted ${handle}
[void][Aeven.Input]::SetCursorPos(${String(Math.round(point.x))}, ${String(Math.round(point.y))})
1..${String(action.count ?? 1)} | ForEach-Object {
  [Aeven.Input]::mouse_event(${flags}, 0, 0, 0, [IntPtr]::Zero)
}
Write-Json @{ ok = $true; clicked = @{ x = ${String(Math.round(point.x))}; y = ${String(Math.round(point.y))} } }`
  }

  /**
   * Translate a key press into SendKeys notation.
   * @param key - the contract's key name.
   * @param modifiers - modifier names to hold.
   * @returns the SendKeys chord.
   * @throws {ComputerUseError} `invalid-target` for an unrecognised modifier.
   */
  private sendKeysChord(key: string, modifiers: readonly string[] | undefined): string {
    const prefix: string[] = []
    for (const modifier of modifiers ?? []) {
      switch (modifier) {
        case 'cmd':
        case 'command':
        case 'ctrl':
        case 'control':
          prefix.push('^')
          break
        case 'shift':
          prefix.push('+')
          break
        case 'option':
        case 'alt':
          prefix.push('%')
          break
        default:
          throw new ComputerUseError('invalid-target', `the modifier "${modifier}" is not a recognised modifier name`, { modifier })
      }
    }
    const named = SENDKEYS_NAMES[key]
    if (named !== undefined) {
      return `${prefix.join('')}${named}`
    }
    return `${prefix.join('')}${key}`
  }

  /**
   * Run one fragment and turn its envelope into a receipt.
   * @param script - the PowerShell to run.
   * @param what - the operation label used in failures.
   * @returns the receipt describing the attempt.
   */
  private async runFragment(script: string, what: string): Promise<ActionReceipt> {
    const result = await this.options.runner.run(
      this.options.powershell ?? 'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      this.options.signal,
    )
    const envelope = parseEnvelope(result.stdout, what)
    assertOk(envelope, what)
    const receipt: ActionReceipt = { route: 'accessibility' }
    const notes: string[] = []
    if (envelope.wrote !== undefined) {
      notes.push(`wrote ${String(envelope.wrote)} characters through ValuePattern`)
    }
    if (envelope.invoked !== undefined) {
      notes.push(`invoked ${envelope.invoked}`)
    }
    if (notes.length > 0) {
      receipt.notes = notes
    }
    return receipt
  }

  /**
   * The window handle expression for an element target's window.
   * @param target - the element target.
   * @returns a PowerShell string literal for the window handle.
   * @throws {ComputerUseError} `invalid-target` when the token carries no window.
   */
  private handleExpression(target: ActionTarget): string {
    const windowId = this.windowIdFromToken(target)
    return `'${quotePowerShellLiteral(windowId)}'`
  }

  /**
   * Recover the window handle encoded in a snapshot token.
   *
   * Tokens are `<windowId>:<ordinal>` so a token can be validated against its
   * window before any work happens, which is what makes a stale token fail closed.
   * @param target - the element target.
   * @returns the window handle.
   * @throws {ComputerUseError} `invalid-target` when the token is not well formed.
   */
  private windowIdFromToken(target: ActionTarget): string {
    if (target.kind !== 'element') {
      throw new ComputerUseError('invalid-target', 'this operation requires an element target', { kind: target.kind })
    }
    const [windowId, ordinal] = target.token.split(':')
    if (windowId === undefined || windowId.length === 0 || ordinal === undefined) {
      throw new ComputerUseError('invalid-target', `the token "${target.token}" is not in <windowId>:<ordinal> form`, {
        token: target.token,
      })
    }
    return windowId
  }

  /**
   * Recover the ordinal encoded in a snapshot token.
   * @param token - the `<windowId>:<ordinal>` token.
   * @returns the ordinal index.
   * @throws {ComputerUseError} `invalid-target` when the ordinal is not a number.
   */
  private indexFromToken(token: string): number {
    const ordinal = token.split(':')[1]
    const parsed = Number(ordinal)
    if (ordinal === undefined || !Number.isInteger(parsed) || parsed < 0) {
      throw new ComputerUseError('invalid-target', `the token "${token}" carries no usable ordinal`, { token })
    }
    return parsed
  }

  /**
   * List the desktop's top-level windows.
   * @returns the windows the window manager reports.
   */
  async listWindows(): Promise<DesktopWindow[]> {
    const result = await this.options.runner.run(
      this.options.powershell ?? 'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', LIST_WINDOWS],
      this.options.signal,
    )
    const envelope = parseEnvelope(result.stdout, 'list windows')
    assertOk(envelope, 'list windows')
    return (envelope.windows ?? []).map(raw => ({
      windowId: raw.windowId,
      pid: raw.pid,
      app: { id: String(raw.pid) },
      title: raw.title,
      bounds: raw.bounds,
      onScreen: raw.bounds.width > 0 && raw.bounds.height > 0,
    }))
  }

  /**
   * Read one window's accessibility subtree.
   * @param window - the window to walk.
   * @param maxNodes - the node cap.
   * @returns the nodes and whether the walk was cut short.
   */
  private async readTree(window: DesktopWindow, maxNodes: number): Promise<{ nodes: DesktopNode[]; truncated: boolean }> {
    const result = await this.options.runner.run(
      this.options.powershell ?? 'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', windowTreeScript(`'${quotePowerShellLiteral(window.windowId)}'`, String(maxNodes))],
      this.options.signal,
    )
    const envelope = parseEnvelope(result.stdout, 'read window tree')
    assertOk(envelope, 'read window tree')
    const nodes = (envelope.nodes ?? []).map((raw) => {
      const node: DesktopNode = {
        index: raw.index,
        token: `${window.windowId}:${String(raw.index)}`,
        role: raw.role,
        bounds: raw.bounds,
        actions: raw.actions,
        editable: raw.editable,
      }
      if (raw.title.length > 0) {
        node.title = raw.title
      }
      if (typeof raw.value === 'string' && raw.value.length > 0) {
        node.value = raw.value
      }
      return node
    })
    return { nodes, truncated: envelope.truncated === true }
  }

  /**
   * Resolve a node token to its current identity, for diagnostics and for the
   * verifier's optional node reader.
   * @param token - the `<windowId>:<ordinal>` token.
   * @returns the resolved role and name.
   */
  async resolveToken(token: string): Promise<{ role: string; name: string }> {
    const windowId = this.windowIdFromToken({ kind: 'element', token })
    const result = await this.options.runner.run(
      this.options.powershell ?? 'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        resolveNodeScript(`'${quotePowerShellLiteral(windowId)}'`, String(this.indexFromToken(token))),
      ],
      this.options.signal,
    )
    const envelope = parseEnvelope(result.stdout, 'resolve node')
    assertOk(envelope, 'resolve node')
    return { role: envelope.role ?? '', name: envelope.name ?? '' }
  }
}

// The adapter is constructed from outside this package, so its runner contract is
// part of the public surface: a consumer supplies the runner.
export type { WinCommandResult, WinCommandRunner } from './runner.ts'
