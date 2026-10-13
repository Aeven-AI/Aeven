/**
 * Shared value types for the computer-use desktop adapter contract: platform
 * identity, readiness reporting, accessibility snapshots, actions, and
 * verification. The interfaces themselves live in `./contract.ts`; this module
 * carries only the data those interfaces exchange, so a provider package can
 * depend on the wire shape without depending on a peer provider.
 *
 * Two invariants shape every type here:
 *
 * - **Acknowledgements are not proof.** No action result field is named or
 *   treated as success. An action reports only what the adapter attempted and
 *   what it could observe; a caller that needs certainty must call `verify()`
 *   and check an independently read observable.
 * - **Grants belong to an identity.** Readiness reports name the OS identity a
 *   grant attaches to, because on macOS a spawned helper holds its own grants
 *   rather than inheriting the host's.
 *
 * @module @aeven/computer-use-desktop/types
 */

/** Operating systems this contract covers. */
export type DesktopPlatform = 'darwin' | 'win32' | 'linux'

/**
 * Readiness of one capability on one host.
 *
 * `unknown` is distinct from `blocked` on purpose: a probe that could not run
 * (no daemon, no session bus) must not be reported as a missing grant, and must
 * not be reported as ready either.
 */
export type ReadinessState = 'ready' | 'blocked' | 'unknown'

/** The OS identity a permission grant attaches to. */
export interface GrantIdentity {
  /**
   * Human-meaningful owner of the grant, e.g. `Aeven`, `osascript`, `CuaDriver`.
   * Callers surface this verbatim: a grant held by the wrong identity is the
   * most common cause of an apparently empty accessibility tree.
   */
  name: string
  /** How the adapter determined the holder, when it can tell. */
  source?: 'in-process' | 'spawned-helper' | 'driver-daemon'
}

/** One probed capability, with the blocker and remediation a caller can act on. */
export interface ReadinessProbe {
  /** Capability name in `domain.action` form, e.g. `accessibility.read`, `input.type`. */
  name: string
  state: ReadinessState
  /** Present when `state` is `blocked`; a stable machine code, not prose. */
  code?: string
  /** Caller-facing explanation of why the capability is blocked. */
  reason?: string
  /** The identity the grant attaches to, when the capability is grant-gated. */
  grantee?: GrantIdentity
  /** The concrete action that would unblock it, when there is one. */
  remedy?: string
}

/**
 * A host readiness report. Mirrors the `doctor` shape used by
 * `computer-use-linux`: machine-readable, with explicit blockers and a
 * recommended next step, so a caller can render a real explanation instead of
 * guessing why an operation produced nothing.
 */
export interface ReadinessReport {
  platform: DesktopPlatform
  /** Every probed capability in this report. */
  probes: readonly ReadinessProbe[]
  /** Names of the probes that are `blocked`, in probe order. */
  blockers: readonly string[]
  /** Single most useful next action for the operator, when one exists. */
  recommendedNextStep?: string
}

/** Identifier of an application the host can observe. */
export interface DesktopAppId {
  /** Stable OS identifier: bundle id, executable path, or desktop-entry id. */
  id: string
  /** Display name when the OS reports one. */
  displayName?: string
}

/** One on-screen window. */
export interface DesktopWindow {
  /** Window identifier stable for the current host session. */
  windowId: string
  /** Owning process identifier. */
  pid: number
  app: DesktopAppId
  title?: string
  /** Window bounds in desktop coordinates. */
  bounds?: DesktopRect
  /** Whether the window manager currently reports it visible. */
  onScreen?: boolean
}

/** An axis-aligned rectangle in desktop coordinates. */
export interface DesktopRect {
  x: number
  y: number
  width: number
  height: number
}

/** One node of an accessibility tree, flattened for indexing. */
export interface DesktopNode {
  /** Index within the producing snapshot; stable for that snapshot's lifetime only. */
  index: number
  /**
   * Opaque handle valid only against the snapshot that produced it. Callers pass
   * this back to `performAction`/`setValue`; an adapter must fail closed when a
   * token is stale rather than acting on a stale element.
   */
  token: string
  /** Platform role, normalized where the platform names differ. */
  role: string
  title?: string
  /** The node's text value, when it has one. */
  value?: string
  /** Actions the platform advertises for this node. Never guess these. */
  actions?: readonly string[]
  /** Whether the platform reports the node as currently editable. */
  editable?: boolean
  /** Node bounds in desktop coordinates, when available. */
  bounds?: DesktopRect
}

/**
 * A coherent view of part of the desktop, produced in one operation so that its
 * windows, nodes, and focus information describe the same instant.
 */
export interface DesktopSnapshot {
  /** Handle for this observation; every node token belongs to it. */
  snapshotId: string
  platform: DesktopPlatform
  /** Windows included in this observation. */
  windows: readonly DesktopWindow[]
  /** Accessibility nodes, flattened and indexed. */
  nodes: readonly DesktopNode[]
  /** Token of the focused node, when the platform reports focus. */
  focusedToken?: string
  /**
   * True when traversal stopped with nodes unread. A truncated tree must say so;
   * silently reporting a partial tree as complete is how a caller concludes an
   * element does not exist.
   */
  truncated?: boolean
}

/** What to observe. */
export interface ObserveScope {
  /** Limit observation to one process. Omit for the whole desktop. */
  pid?: number
  /** Limit observation to one window; requires `pid`. */
  windowId?: string
  /** Include on-screen pixels. Off by default: a tree is cheaper than a capture. */
  screenshot?: boolean
  /** Include the accessibility tree. On by default. */
  tree?: boolean
  /** Upper bound on returned nodes; adapters report `truncated` when they stop early. */
  maxNodes?: number
}

/** A captured image plus the coordinate space it maps to. */
export interface DesktopScreenshot {
  /** Absolute path of the captured image in a caller-owned temporary location. */
  path: string
  mimeType: string
  /** Pixel dimensions of the captured image. */
  width: number
  height: number
  /**
   * Ratio between image pixels and desktop coordinates. Callers must divide by
   * this before turning a point read off the image into a click coordinate.
   */
  scale: number
  /** Desktop-space origin of the capture. */
  origin?: DesktopRect
}

/** Receipt for an `observe()` call. */
export interface ObserveResult {
  /** The snapshot; absent when `tree` was explicitly disabled. */
  snapshot?: DesktopSnapshot
  /** The capture; absent unless `screenshot` was requested. */
  screenshot?: DesktopScreenshot
  /** Short operator-facing notes, e.g. why a scope was widened. */
  notes?: readonly string[]
}

/** Scope an action to an exact window. */
export interface WindowTarget {
  kind: 'window'
  pid: number
  windowId: string
}

/** Scope an action to an exact accessibility node from a named snapshot. */
export interface ElementTarget {
  kind: 'element'
  token: string
}

/** Scope an action to desktop pixel coordinates. */
export interface PointTarget {
  kind: 'point'
  x: number
  y: number
  /** Window the coordinates are measured against; required for scoped input. */
  window?: WindowTarget
}

/** Where an action applies. */
export type ActionTarget = WindowTarget | ElementTarget | PointTarget

/** Press one mouse button. */
export interface ClickAction {
  kind: 'click'
  target: ActionTarget
  button?: 'left' | 'right' | 'middle'
  /** Click count; defaults to 1. */
  count?: number
}

/** Insert text at the current insertion point. */
export interface TypeTextAction {
  kind: 'type'
  target: ActionTarget
  text: string
}

/** Press one key, optionally with modifiers. */
export interface PressKeyAction {
  kind: 'key'
  target: ActionTarget
  /** Platform-independent key name, e.g. `return`, `escape`, `a`. */
  key: string
  /** Modifiers held during the press, e.g. `['cmd']`. */
  modifiers?: readonly string[]
}

/** Write a value directly through the accessibility API. */
export interface SetValueAction {
  kind: 'setValue'
  target: ElementTarget
  value: string
}

/** Invoke an accessibility action the node itself advertises. */
export interface PerformActionAction {
  kind: 'performAction'
  target: ElementTarget
  /** Must come from the node's advertised `actions`; adapters reject unknown names. */
  action: string
}

/** Move focus to a window. */
export interface FocusWindowAction {
  kind: 'focusWindow'
  target: WindowTarget
}

/** An action an adapter can attempt. */
export type DesktopAction =
  | ClickAction
  | TypeTextAction
  | PressKeyAction
  | SetValueAction
  | PerformActionAction
  | FocusWindowAction

/**
 * How an adapter reached the target. Recorded because the ladder is a
 * performance contract: a semantic or accessibility route is measurable, and a
 * silent fall to pixels should be visible rather than indistinguishable.
 */
export type ActionRoute = 'accessibility' | 'native-input'

/**
 * What an adapter attempted and what it observed. **Not** a success report: see
 * the module note. A caller must call `verify()` for certainty.
 */
export interface ActionReceipt {
  /** The route actually used. */
  route: ActionRoute
  /**
   * What the adapter observed immediately after acting. Absent when it could
   * observe nothing, which is itself meaningful and must not be read as success.
   */
  observed?: string
  /** Operator-facing notes, e.g. that a fallback rung was used. */
  notes?: readonly string[]
}

/**
 * One thing that would be true if the action worked. Verification reads it
 * independently of how the action was performed.
 */
export type Expectation =
  /** A filesystem path exists. */
  | { kind: 'fileExists'; path: string }
  /** A file's contents contain a substring, read fresh from disk. */
  | { kind: 'fileContains'; path: string; text: string }
  /** A file's contents equal a string exactly, read fresh from disk. */
  | { kind: 'fileEquals'; path: string; text: string }
  /** A file's modification time is newer than a caller-supplied instant. */
  | { kind: 'fileNewerThan'; path: string; sinceMs: number }
  /** An accessibility node's value is exactly the expected string. */
  | { kind: 'nodeValueEquals'; token: string; value: string }
  /** A window with this title exists. */
  | { kind: 'windowTitled'; title: string }
  /**
   * An application object exists and matches the named fields.
   *
   * This is the assertion the curated recipes need: a benchmark's end-state check
   * names a semantic fact — a calendar holding an event, a note existing in a
   * folder — and a file-existence check cannot express it. The adapter asks the
   * application itself, so the answer comes from the same authority the user sees.
   */
  | { kind: 'appObject'; app: string; collection: string; match: Readonly<Record<string, string>> }
  /** A named calendar holds at least `count` events, and one matching `match` when given. */
  | { kind: 'calendarHasEvent'; calendar?: string; count?: number; match?: Readonly<Record<string, string>> }
  /** A note with this name exists, in this folder when one is named. */
  | { kind: 'noteExists'; name: string; folder?: string; contains?: string }

/** Outcome of one expectation. */
export interface VerificationOutcome {
  /** The expectation that was checked, echoed for correlation. */
  expectation: Expectation
  /** Whether the independently read observable matched. */
  satisfied: boolean
  /** What was actually read, for a failure message that explains itself. */
  observed?: string
  /** Why the check could not be completed, when it could not. */
  error?: string
}
