/**
 * The macOS accessibility tree walk, and the parser for what it returns.
 *
 * The walk runs through AppleScriptObjC, because that is the only way to reach
 * `AXUIElement` without compiling anything: `ObjC.import` loads ApplicationServices
 * at runtime. Two consequences shape this module.
 *
 * The walk itself needs the **Accessibility grant held by the process that runs
 * it**. A spawned `osascript` does not hold Æven's grant and is measured to
 * receive `-25201 kAXErrorAPIDisabled`, so the script reports that code verbatim
 * instead of returning an empty node list — an empty list would be
 * indistinguishable from an application that publishes no accessibility surface.
 *
 * The walk emits a flat roster and this module does the indexing, so the part
 * that assigns tokens and bounds is ordinary tested TypeScript rather than
 * untestable script text.
 *
 * @module @aeven/computer-use-macos/ax
 */

import { ComputerUseError, type DesktopNode, type DesktopWindow } from '@aeven/computer-use-desktop'

/** A node as the walk reports it, before indexing. */
export interface RawAxNode {
  depth: number
  role: string
  title: string
  description: string
  value: string
  actions: string[]
  x: number
  y: number
  width: number
  height: number
}

/** Envelope the walk emits. */
export interface AxWalkEnvelope {
  ok: boolean
  /** The AX error code when the API is not permitted, e.g. `-25201`. */
  axError?: number
  error?: string
  nodes?: RawAxNode[]
  truncated?: boolean
}

/** How many nodes one walk may return before it stops. */
export const DEFAULT_AX_NODE_CAP = 600

/**
 * AppleScriptObjC source that walks the focused application's accessibility tree.
 *
 * Attributes are read through a tolerant helper because a missing attribute is
 * normal: most nodes have no value, and several have no actions. Reading them
 * defensively keeps one absent attribute from aborting a whole walk.
 *
 * Depth is emitted so a caller could reconstruct shape; the walk itself is
 * depth-first so a truncation cuts from the deepest part of the tree rather than
 * from an arbitrary sibling.
 * @param capExpr - AppleScript expression yielding the node cap.
 * @returns the script body.
 */
export function axWalkScript(capExpr: string): string {
  return `
ObjC.import('ApplicationServices')
ObjC.import('Foundation')

function emit(o) { $.NSFileHandle.fileHandleWithStandardOutput.writeData(
  $(JSON.stringify(o) + '\\n').dataUsingEncoding($.NSUTF8StringEncoding)) }

// osascript has no exit(); the JSON is emitted first and then a throw produces a
// non-zero status, so a caller can read the reason from stdout and the failure
// from the exit code. The thrown error goes to stderr, which the caller ignores.
function fail(message, axError) { emit({ ok: false, error: message, axError: axError }); throw new Error(message) }

function attr(element, name) {
  const ref = Ref()
  const err = $.AXUIElementCopyAttributeValue(element, $(name).js, ref)
  if (err !== 0) { return null }
  const value = ref[0]
  if (value === null || value === undefined) { return null }
  return ObjC.unwrap(value)
}

function attrAll(element, name) {
  const ref = Ref()
  const err = $.AXUIElementCopyAttributeValues(element, $(name).js, 0, 4096, ref)
  if (err !== 0) { return null }
  const value = ref[0]
  if (value === null || value === undefined) { return null }
  return ObjC.unwrap(value)
}

function actionNames(element) {
  const ref = Ref()
  const err = $.AXUIElementCopyActionNames(element, ref)
  if (err !== 0) { return [] }
  const value = ref[0]
  if (value === null || value === undefined) { return [] }
  return ObjC.unwrap(value)
}

function str(value) {
  if (value === null || value === undefined) { return '' }
  if (typeof value === 'string') { return value }
  try { return String(value) } catch (e) { return '' }
}

const system = $.AXUIElementCreateSystemWide()
const appRef = Ref()
const appErr = $.AXUIElementCopyAttributeValue(system, $.kAXFocusedApplicationAttribute, appRef)
if (appErr !== 0 || appRef[0] === null || appRef[0] === undefined) {
  // kAXErrorAPIDisabled (-25201) means the API is reachable but this process is
  // not permitted; that is the one distinction the caller must not lose.
  fail('the accessibility API did not return a focused application', appErr)
}

const app = appRef[0]
const cap = ${capExpr}
const nodes = []
let truncated = false

function visit(element, depth) {
  if (nodes.length >= cap) { truncated = true; return }
  const role = str(attr(element, 'AXRole'))
  if (role.length === 0) { return }
  const position = attr(element, 'AXPosition')
  const size = attr(element, 'AXSize')
  nodes.push({
    depth: depth,
    role: role,
    title: str(attr(element, 'AXTitle')),
    description: str(attr(element, 'AXDescription')),
    value: str(attr(element, 'AXValue')),
    actions: actionNames(element).map(function (name) { return str(name) }),
    x: position === null ? 0 : Number(position.x),
    y: position === null ? 0 : Number(position.y),
    width: size === null ? 0 : Number(size.width),
    height: size === null ? 0 : Number(size.height)
  })
  const children = attrAll(element, 'AXChildren')
  if (children === null) { return }
  for (let i = 0; i < children.length; i++) {
    visit(children[i], depth + 1)
  }
}

visit(app, 0)
emit({ ok: true, nodes: nodes, truncated: truncated })
`
}

/**
 * Parse a walk envelope.
 * @param stdout - the script's captured output.
 * @param what - a label used when the output is unreadable.
 * @returns the parsed envelope.
 * @throws {ComputerUseError} `capability-unavailable` when the output is not the
 * single JSON object the script emits, or when the walk reported an AX error.
 */
export function parseAxEnvelope(stdout: string, what: string): AxWalkEnvelope {
  const line = stdout.trim().split('\n').filter(entry => entry.trim().length > 0).at(-1)
  if (line === undefined) {
    throw new ComputerUseError('capability-unavailable', `${what} produced no output`)
  }
  let envelope: AxWalkEnvelope
  try {
    envelope = JSON.parse(line) as AxWalkEnvelope
  } catch {
    throw new ComputerUseError('capability-unavailable', `${what} produced output that is not JSON`, {
      output: line.slice(0, 200),
    })
  }
  if (envelope.ok) {
    return envelope
  }
  // The AX error code is the actionable part: -25201 is a missing Accessibility
  // grant, which needs a different remedy from a node that has gone away.
  if (envelope.axError === -25201) {
    throw new ComputerUseError(
      'capability-unavailable',
      'the accessibility API is not permitted for the process running the walk (-25201 kAXErrorAPIDisabled); the grant belongs to whoever calls the API, and a spawned helper does not inherit it',
      { axError: -25201 },
    )
  }
  throw new ComputerUseError('capability-unavailable', envelope.error ?? `${what} failed without a reported reason`, {
    axError: envelope.axError,
  })
}

/**
 * AppleScriptObjC source that performs one accessibility action on the node at a
 * given walk index.
 *
 * The index is replayed against the same depth-first walk the snapshot used, so
 * it resolves the same element or fails — never a different one. The node's
 * advertised actions are checked before the call, because an unadvertised action
 * either errors or, worse, does something else under a different name.
 * @param indexExpr - AppleScript expression yielding the walk index.
 * @param actionExpr - AppleScript expression yielding the AX action name.
 * @param valueExpr - AppleScript expression yielding a value, for `AXSetValue`.
 * @param unsetAction - the action name that means "no action, just set a value".
 * @returns the script body.
 */
export function axActionScript(indexExpr: string, actionExpr: string, valueExpr: string, unsetAction: string): string {
  return `
ObjC.import('ApplicationServices')
ObjC.import('Foundation')

function emit(o) { $.NSFileHandle.fileHandleWithStandardOutput.writeData(
  $(JSON.stringify(o) + '\\n').dataUsingEncoding($.NSUTF8StringEncoding)) }
function fail(message, code) { emit({ ok: false, error: message, axError: code }); throw new Error(message) }

function attr(element, name) {
  const ref = Ref()
  const err = $.AXUIElementCopyAttributeValue(element, $(name).js, ref)
  if (err !== 0) { return null }
  if (ref[0] === null || ref[0] === undefined) { return null }
  return ref[0]
}

function attrAll(element, name) {
  const ref = Ref()
  const err = $.AXUIElementCopyAttributeValues(element, $(name).js, 0, 4096, ref)
  if (err !== 0) { return null }
  if (ref[0] === null || ref[0] === undefined) { return null }
  return ref[0]
}

function actionNames(element) {
  const ref = Ref()
  const err = $.AXUIElementCopyActionNames(element, ref)
  if (err !== 0) { return [] }
  if (ref[0] === null || ref[0] === undefined) { return [] }
  return ObjC.unwrap(ref[0])
}

const system = $.AXUIElementCreateSystemWide()
const appRef = Ref()
const appErr = $.AXUIElementCopyAttributeValue(system, $.kAXFocusedApplicationAttribute, appRef)
if (appErr !== 0 || appRef[0] === null || appRef[0] === undefined) {
  fail('the accessibility API did not return a focused application', appErr)
}

const wanted = ${indexExpr}
const wantedAction = ${actionExpr}
const wantedValue = ${valueExpr}
const unsetAction = ${JSON.stringify(unsetAction)}

let seen = 0
let target = null
function visit(element) {
  if (target !== null) { return }
  if (seen === wanted) { target = element; return }
  seen++
  const children = attrAll(element, 'AXChildren')
  if (children === null) { return }
  for (let i = 0; i < children.length; i++) {
    visit(children[i])
    if (target !== null) { return }
  }
}
visit(appRef[0])
if (target === null) { fail('no accessibility element at walk index ' + wanted, 0) }

const advertised = actionNames(target).map(function (name) { return String(name) })
if (wantedAction !== unsetAction && advertised.indexOf(wantedAction) < 0) {
  fail('the element does not advertise ' + wantedAction + '; it advertises: ' + advertised.join(', '), 0)
}

if (wantedAction === unsetAction) {
  const err = $.AXUIElementSetAttributeValue(target, $.kAXValueAttribute, $(wantedValue))
  if (err !== 0) { fail('setting the value failed', err) }
  emit({ ok: true, acted: 'setValue' })
} else {
  const err = $.AXUIElementPerformAction(target, $(wantedAction).js)
  if (err !== 0) { fail('the accessibility action failed', err) }
  emit({ ok: true, acted: wantedAction })
}
`
}

/**
 * Turn a walked roster into indexed nodes.
 *
 * Index is the position in the walk, so replaying the same walk resolves the same
 * element. A node's title falls back to its description, because many controls
 * carry only one of the two and a caller should not have to know which.
 * @param raw - the roster the walk reported.
 * @param snapshotId - the snapshot these tokens belong to.
 * @returns indexed nodes.
 */
export function indexAxNodes(raw: readonly RawAxNode[], snapshotId: string): DesktopNode[] {
  return raw.map((entry, index) => {
    const node: DesktopNode = {
      index,
      token: `${snapshotId}:${String(index)}`,
      role: entry.role,
      actions: entry.actions,
      bounds: { x: entry.x, y: entry.y, width: entry.width, height: entry.height },
    }
    const title = entry.title.length > 0 ? entry.title : entry.description
    if (title.length > 0) {
      node.title = title
    }
    if (entry.value.length > 0) {
      node.value = entry.value
    }
    // Always explicit: "not editable" and "unknown" must not look the same to a
    // caller deciding whether a value write is possible.
    node.editable = entry.actions.includes('AXSetValue')
      || entry.role === 'AXTextArea'
      || entry.role === 'AXTextField'
    return node
  })
}

/**
 * Mint a snapshot id that encodes its window and a monotonic counter.
 *
 * Tokens are `<snapshotId>:<index>`, and the snapshot id carries the window so a
 * token is self-describing: a token from another window's walk can be rejected
 * before any work happens.
 * @param window - the window being walked.
 * @param sequence - a caller-supplied counter making ids unique within a session.
 * @returns the snapshot id.
 */
export function axSnapshotId(window: DesktopWindow, sequence: number): string {
  return `ax:${String(window.pid)}:${window.windowId}:${String(sequence)}`
}
