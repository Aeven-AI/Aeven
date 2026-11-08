/**
 * Agent actions on the sidebar guest. Native guest input preserves the app composer's focus;
 * visible cursor arrival precedes discrete input.
 *
 * Action timing follows ChatGPT's browser agent: a pointer action moves the drawn
 * cursor and waits up to {@link CURSOR_ARRIVAL_TIMEOUT_MS} for it to arrive, then
 * moves the page's mouse there and presses. A click watches for a navigation it
 * starts for {@link NAVIGATION_CLASSIFICATION_MS} from the moment the action begins, and
 * waits up to {@link NAVIGATION_TIMEOUT_MS} for that navigation's document to load.
 * A drag waits for the cursor only at its first point. A scroll waits for the cursor,
 * then sends one native wheel event (ChatGPT's `mouseWheel` scroll method: an Electron
 * guest acknowledges `Input.synthesizeScrollGesture` without scrolling), and returns
 * once the scrolled position has settled.
 */

import { randomUUID } from '@aeven/util-crypto'
import { LOCATOR_PRELUDE, MAX_CONTENT_LENGTH, PAGE_MARKDOWN, YOUTUBE_TRANSCRIPT } from './page-scripts.ts'

/** One step of the agent pointer: where it goes and what it shows there. */
export interface CursorStep {
  readonly action: 'move' | 'click' | 'type' | 'scroll' | 'control' | 'cancel'
  readonly x: number
  readonly y: number
  readonly deltaY?: number
  /** Selector of the element the step names, for a host that keeps the pointer on it. */
  readonly selector?: string
  /** A browser chrome control a sidebar pane presses, by name. */
  readonly control?: string
  /** Address a `navigate` control types. */
  readonly url?: string
}

/**
 * What the place the engine runs in provides beyond the page: local files,
 * the Downloads folder, and the clipboard. An operation needing a missing
 * capability fails with a message that says so.
 */
export interface EngineHost {
  /**
   * Canonical paths of local regular files an upload attaches.
   * @param paths - absolute paths the agent named.
   * @returns the files' canonical paths.
   */
  resolveFiles?(paths: readonly string[]): Promise<string[]>
  /**
   * Save an exported document where the user keeps downloads.
   * @param name - the preferred file name.
   * @param bytes - the file's contents.
   * @returns where it was saved.
   */
  saveDownload?(name: string, bytes: Uint8Array): Promise<string>
  /** The computer's clipboard text. */
  readonly clipboard?: { readText(): string | Promise<string>; writeText(text: string): void | Promise<void> }
}

/** Whether a path is absolute on any platform the engine runs on. */
function isAbsolutePath(path: string): boolean {
  return /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(path)
}

/** The last segment of a path. */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** Bytes a value's JSON takes in UTF-8. */
function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).length
}

/**
 * What the engine drives: the slice of Electron's `WebContents` it uses, so a
 * sidebar guest is passed as is and a Chrome tab implements the same calls over
 * its own CDP session. A target without a host window draws its own pointer.
 */
export interface BrowserTarget {
  /** Identity the shell's cancel requests name. */
  readonly id: number | string
  readonly debugger: {
    attach(protocolVersion?: string): void
    isAttached(): boolean
    // CDP results and event parameters differ per method; each caller states the fields it reads.
    // oxlint-disable-next-line typescript/no-explicit-any -- the result's type depends on the method name
    sendCommand(method: string, commandParams?: object): Promise<any>
    // oxlint-disable-next-line typescript/no-explicit-any -- the parameters' type depends on the event name
    on(event: 'message', listener: (event: unknown, method: string, params: any) => void): unknown
    // oxlint-disable-next-line typescript/no-explicit-any -- the parameters' type depends on the event name
    off(event: 'message', listener: (event: unknown, method: string, params: any) => void): unknown
  }
  getURL(): string
  getTitle(): string
  insertText(text: string): Promise<void>
  sendInputEvent(inputEvent: { type: 'keyDown' | 'char' | 'keyUp'; keyCode: string; modifiers?: Array<'alt' | 'control' | 'meta' | 'shift'> }): void
  /** Requests with the target's own cookies. */
  readonly session: { fetch(input: string, init?: { signal?: AbortSignal }): Promise<Response> }
  /** Emit an Electron internal event; a non-Electron target ignores it. */
  emit(event: string): boolean
  /**
   * Draw one pointer step: in the target's own page, or in the window that shows it.
   * @param step - the step.
   * @param wait - whether to wait for the pointer to arrive.
   * @param timeoutMs - the most the wait takes.
   * @param signal - cancels the wait.
   */
  presentCursor(step: CursorStep, wait: boolean, timeoutMs: number, signal: AbortSignal): Promise<void>
  /** Navigate the target itself; a sidebar guest navigates through its pane instead. */
  navigate?(operation: 'navigate' | 'back' | 'forward' | 'reload', url: string, signal: AbortSignal): Promise<void>
}

/** Accessibility handles belong to one observation and one document. */
const accessibilityTargets = new WeakMap<BrowserTarget, { snapshotId: string; loaderId: string; nodes: Map<string, number> }>()

/** Chromium accessibility node fields used by the browser snapshot. */
interface BrowserAxNode {
  ignored: boolean
  backendDOMNodeId?: number
  role?: { value: string }
  name?: { value: string }
  value?: { value: string }
  properties?: Array<{ name: string; value: { value: unknown } }>
}

/** What the type page expression reports about the target it focused. */
interface FocusOutcome {
  ok?: true
  notFound?: true
  notEditable?: true
  focusFailed?: true
}

/** A viewport point in CSS pixels. */
interface Point { x: number; y: number }

/** Interactive elements a snapshot lists (t3code `MAX_INTERACTIVE_ELEMENTS`). */
const MAX_INTERACTIVE_ELEMENTS = 200
/** Characters kept of each element's name. */
const MAX_INTERACTIVE_ELEMENT_NAME_LENGTH = 120
/** Characters kept of the page's visible text. */
const MAX_VISIBLE_TEXT_LENGTH = 40_000
/** Bytes an evaluated value may serialize to (t3code `MAX_EVALUATION_BYTES`). */
const MAX_EVALUATION_BYTES = 64_000
/** Elements a `read` with `all` reports. */
const MAX_READ_ELEMENTS = 200
/** Console entries kept per guest. */
const MAX_CONSOLE_ENTRIES = 500
/** How long a pointer action waits for the drawn cursor to arrive, in ms (ChatGPT `lE`). */
const CURSOR_ARRIVAL_TIMEOUT_MS = 1500
/** How long a pane control gesture may take, which can open the three-dot menu and a submenu first, in ms. */
const CONTROL_GESTURE_TIMEOUT_MS = 10_000
/** How long after an action starts a navigation it caused must have begun, in ms (ChatGPT `classificationTimeoutMs`). */
const NAVIGATION_CLASSIFICATION_MS = 250
/** How long a started navigation is given to load its document, in ms (ChatGPT default `timeout_ms`). */
const NAVIGATION_TIMEOUT_MS = 3000
/** How often a scroll's position is sampled while it settles, in ms. */
const SCROLL_SETTLE_POLL_MS = 50
/** Longest a scroll waits for its position to settle, in ms. */
const SCROLL_SETTLE_MAX_MS = 1000
/** Pause between characters of a sequential type, in ms (ChatGPT `pressSequentially` `WP`). */
const SEQUENTIAL_TYPE_DELAY_MS = 50
/** How far inside the page's top edge a scroll's pointer enters when it was outside the page, in CSS pixels. */
const SCROLL_ENTRY_INSET_PX = 24
/** Where the pointer last arrived in each guest, in its viewport CSS pixels. */
const pointerAt = new WeakMap<BrowserTarget, Point>()
/**
 * Guests whose pointer is currently drawn inside the page. A chrome action leaves the pointer on
 * the pane's own controls, where its page coordinates mean nothing: without this, a later scroll
 * would start from a stale in-page point and the pointer would jump out of the chrome row.
 */
const pointerInPage = new WeakSet<BrowserTarget>()

/** A JavaScript dialog the page is showing, as `Page.javascriptDialogOpening` reported it. */
interface OpenDialog { type: string; message: string; defaultPrompt?: string; url?: string }
/** Dialogs the guests are showing now. */
const openDialogs = new WeakMap<BrowserTarget, OpenDialog>()
/** One console entry a guest's page logged. */
interface ConsoleEntry { level: string; text: string; url?: string; line?: number; time: number }
/** Console entries per guest, newest last. */
const consoleEntries = new WeakMap<BrowserTarget, ConsoleEntry[]>()
/** Operations that still answer while a JavaScript dialog blocks the page. */
const DIALOG_SAFE = new Set(['dialog', 'console', 'screenshot', 'clipboard'])

/** Mouse button masks for `Input.dispatchMouseEvent` `buttons`. */
const BUTTON_MASK = { left: 1, right: 2, middle: 4 } as const
/** Modifier bits for `Input.dispatchMouseEvent` `modifiers`. */
const MODIFIER_BITS: Readonly<Record<string, number>> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }

/**
 * Record a guest's console output and JavaScript dialogs from its debugger events.
 * The caller enables the Runtime and Page domains on the debugger session.
 * @param guest - the guest whose page is observed.
 * @returns disposer removing the listener.
 */
export function observePage(guest: BrowserTarget): () => void {
  const listen = (_event: unknown, method: string, params: unknown): void => {
    const values = params as Record<string, unknown>
    switch (method) {
      case 'Page.javascriptDialogOpening':
        openDialogs.set(guest, {
          type: String(values.type),
          message: textOf(values.message),
          ...typeof values.defaultPrompt === 'string' ? { defaultPrompt: values.defaultPrompt } : {},
          ...typeof values.url === 'string' ? { url: values.url } : {},
        })
        return
      case 'Page.javascriptDialogClosed':
        openDialogs.delete(guest)
        return
      case 'Runtime.consoleAPICalled': {
        const args = Array.isArray(values.args) ? values.args as Array<{ value?: unknown; description?: string; type?: string }> : []
        const text = args.map(arg => arg.value !== undefined ? (typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value)) : arg.description ?? arg.type ?? '').join(' ')
        const frame = (values.stackTrace as { callFrames?: Array<{ url?: string; lineNumber?: number }> } | undefined)?.callFrames?.[0]
        record(guest, { level: String(values.type), text, ...frame?.url === undefined || frame.url === '' ? {} : { url: frame.url }, ...frame?.lineNumber === undefined ? {} : { line: frame.lineNumber + 1 }, time: Date.now() })
        return
      }
      case 'Runtime.exceptionThrown': {
        const details = values.exceptionDetails as
          { text?: string; url?: string; lineNumber?: number; exception?: { description?: string } } | undefined
        record(guest, { level: 'exception', text: details?.exception?.description ?? details?.text ?? 'uncaught exception', ...details?.url === undefined ? {} : { url: details.url }, ...details?.lineNumber === undefined ? {} : { line: details.lineNumber + 1 }, time: Date.now() })
        return
      }
    }
  }
  guest.debugger.on('message', listen)
  return () => {
    guest.debugger.off('message', listen)
    openDialogs.delete(guest)
  }
}

/**
 * Append one console entry, dropping the oldest past {@link MAX_CONSOLE_ENTRIES}.
 * @param guest - the guest that logged it.
 * @param entry - the entry.
 */
function record(guest: BrowserTarget, entry: ConsoleEntry): void {
  const entries = consoleEntries.get(guest) ?? []
  entries.push(entry)
  if (entries.length > MAX_CONSOLE_ENTRIES) entries.splice(0, entries.length - MAX_CONSOLE_ENTRIES)
  consoleEntries.set(guest, entries)
}

/**
 * Wait without blocking the main process.
 * @param ms - how long, in milliseconds.
 * @param signal - abandons the wait.
 */
async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    const abort = (): void => { clearTimeout(timer); reject(signal?.reason as Error) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/** An action's arguments, as the tool validated them. */
export type BrowserAutomationInput = { readonly [key: string]: unknown }

/**
 * Text of a value a page or a tool call reported, without Object's default `[object Object]`.
 * @param value - the value.
 * @returns a string as is, JSON for anything else, and empty for nothing.
 */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  if (value === undefined || value === null) return ''
  return JSON.stringify(value)
}

/** t3code `captureAutomationSnapshot`'s page expression, with each control's value and checked state. */
const SNAPSHOT = `(() => {
  const selectorFor = (element) => {
    if (element.id) return "#" + CSS.escape(element.id);
    for (const attribute of ["data-testid", "name"]) {
      const value = element.getAttribute(attribute);
      if (value) return element.tagName.toLowerCase() + "[" + attribute + "=" + JSON.stringify(value) + "]";
    }
    const buildParts = (current, parts = []) => {
      if (!current || current.nodeType !== Node.ELEMENT_NODE || parts.length >= 8) return parts;
      const parent = current.parentElement;
      const siblings = parent ? Array.from(parent.children).filter((child) => child.tagName === current.tagName) : [];
      const base = current.tagName.toLowerCase();
      const part = siblings.length > 1 ? base + ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")" : base;
      return buildParts(parent, [part, ...parts]);
    };
    return buildParts(element).join(" > ");
  };
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  };
  const elements = Array.from(document.querySelectorAll(
    "a[href],button,input,textarea,select,[role],[tabindex],[contenteditable]:not([contenteditable=false])"
  )).filter(visible).slice(0, ${String(MAX_INTERACTIVE_ELEMENTS)}).map((element) => {
    const rect = element.getBoundingClientRect();
    const control = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
    const checkable = element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio");
    return {
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role"),
      name: (element.getAttribute("aria-label") || element.innerText || element.getAttribute("name") || element.getAttribute("placeholder") || "").slice(0, ${String(MAX_INTERACTIVE_ELEMENT_NAME_LENGTH)}),
      selector: selectorFor(element),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      editable: element.isContentEditable || element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement,
      disabled: element.disabled === true,
      ...(control && !checkable && element.type !== "password" ? { value: String(element.value ?? "").slice(0, ${String(MAX_INTERACTIVE_ELEMENT_NAME_LENGTH)}) } : {}),
      ...(checkable ? { checked: element.checked } : {})
    };
  });
  const frames = Array.from(document.querySelectorAll("iframe,frame")).filter(visible).slice(0, 20).map((frame) => ({ selector: selectorFor(frame), src: frame.src || null, title: frame.title || null }));
  return {
    url: location.href,
    title: document.title,
    loading: document.readyState !== "complete",
    visibleText: (document.body?.innerText || "").slice(0, ${String(MAX_VISIBLE_TEXT_LENGTH)}),
    interactiveElements: elements,
    ...(frames.length > 0 ? { frames } : {})
  };
})()`

/**
 * The page expression for the element an action names.
 * @param input - the action's arguments.
 * @param fallback - expression used when the action names no element.
 * @returns an expression evaluating to the element or null, inside a {@link LOCATOR_PRELUDE} scope.
 */
function targetOf(input: BrowserAutomationInput, fallback: string): string {
  if (typeof input.token === 'string') return '__aevenTarget'
  if (typeof input.selector === 'string') return `__aevenLocate.one(${JSON.stringify(input.selector)})`
  return fallback
}

/**
 * The selector the pane re-measures to keep its pointer on the action's element:
 * plain CSS in the top document only, because the pane reads it with `querySelector`.
 * @param input - the action's arguments.
 * @returns cursor anchor metadata, empty for a locator, a frame, or no selector.
 */
function anchorOf(input: BrowserAutomationInput): { selector?: string } {
  if (typeof input.selector !== 'string' || input.frame !== undefined) return {}
  if (input.selector.includes('>>') || /^(css|xpath|text|role|label|placeholder|alt|title|testid|nth|visible)=/.test(input.selector)) return {}
  return { selector: input.selector }
}

/**
 * The page expression placing the pointer on an element: it scrolls the element
 * into view only when part of it is outside the viewport, then reports its centre,
 * clamped to the viewport. A scroll here is instant, so the point is measured
 * after it lands rather than during a smooth scroll.
 * @param target - expression evaluating to the element.
 * @param actionable - whether a hidden or disabled element is refused.
 * @returns the expression; it evaluates to the point, or null when no element matches.
 */
function pointExpression(target: string, actionable: boolean): string {
  return `(() => {
    ${LOCATOR_PRELUDE}
    const element = ${target};
    if (!element) return null;
    if (${String(actionable)} && (element.disabled || getComputedStyle(element).visibility === "hidden" || element.getClientRects().length === 0)) throw new Error("the target is hidden or disabled");
    const clamp = (value, limit) => Math.min(Math.max(value, 0), limit);
    const before = element.getBoundingClientRect();
    if (before.top < 0 || before.left < 0 || before.bottom > innerHeight || before.right > innerWidth) element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    const rect = element.getBoundingClientRect();
    return { x: clamp(rect.left + rect.width / 2, innerWidth), y: clamp(rect.top + rect.height / 2, innerHeight) };
  })()`
}

/**
 * t3code `typeIntoAutomationTarget`'s page expression, up to the insertion:
 * focus the target and select what `clear` replaces. Clearing with no text
 * deletes the selection here, as there is nothing to type over it.
 */
function focusExpression(input: BrowserAutomationInput): string {
  const target = targetOf(input, 'document.activeElement')
  const clear = input.clear === true
  const text = typeof input.text === 'string' ? input.text : undefined
  return `(() => {
    ${LOCATOR_PRELUDE}
    const element = ${target};
    if (!element) return { notFound: true };
    const textControl =
      element instanceof HTMLTextAreaElement ||
      (element instanceof HTMLInputElement &&
        !new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]).has(element.type));
    const editable = textControl || element.isContentEditable;
    if (!editable || element.disabled || element.readOnly) return { notEditable: true };
    element.focus();
    if (element.getRootNode().activeElement !== element) return { focusFailed: true };
    if (${String(clear)}) {
      if (textControl) {
        element.select();
      } else {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = document.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
    if (${String(clear && text === undefined)} && !document.execCommand("delete", false)) return { notEditable: true };
    return { ok: true };
  })()`
}

/** t3code `NAMED_KEYS`, reduced to the key names the native event needs. */
const NAMED_KEYS: Readonly<Record<string, { readonly key: string; readonly text?: string }>> = {
  Escape: { key: 'Escape' }, Backspace: { key: 'Backspace' }, Tab: { key: 'Tab' }, Enter: { key: 'Enter', text: '\r' },
  Space: { key: ' ', text: ' ' }, PageUp: { key: 'PageUp' }, PageDown: { key: 'PageDown' }, End: { key: 'End' },
  Home: { key: 'Home' }, ArrowLeft: { key: 'ArrowLeft' }, ArrowUp: { key: 'ArrowUp' }, ArrowRight: { key: 'ArrowRight' },
  ArrowDown: { key: 'ArrowDown' }, Insert: { key: 'Insert' }, Delete: { key: 'Delete' },
}

/**
 * Press one key on the guest's own widget (t3code `makePreviewAutomationNativeKeySequence`).
 * @param guest - the guest to type into.
 * @param input - `key` and optional `modifiers`.
 */
function press(guest: BrowserTarget, input: BrowserAutomationInput): void {
  const named = NAMED_KEYS[input.key === ' ' ? 'Space' : String(input.key)]
  const requested = (Array.isArray(input.modifiers) ? input.modifiers : []).map(String)
  const shifted = requested.includes('Shift')
  const key = named?.key ?? (/^[a-z]$/i.test(String(input.key)) && shifted ? String(input.key).toUpperCase() : String(input.key))
  // Modifiers other than Shift make a key a command, which inserts no text.
  const text = requested.some(modifier => modifier !== 'Shift') ? '' : named?.text ?? (key.length === 1 ? key : '')
  const modifiers = requested.map(modifier => modifier.toLowerCase()) as Array<'alt' | 'control' | 'meta' | 'shift'>
  const keyCode = key.startsWith('Arrow') ? key.slice(5) : key
  guest.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
  try {
    if (text !== '') guest.sendInputEvent({ type: 'char', keyCode: text, modifiers })
  } finally {
    guest.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }
}

/**
 * The modifier bit mask a mouse action holds.
 * @param input - the action's arguments; `modifiers` lists Alt, Control, Meta, or Shift.
 * @returns the CDP modifier bits.
 */
function modifierMask(input: BrowserAutomationInput): number {
  return (Array.isArray(input.modifiers) ? input.modifiers : [])
    .reduce<number>((mask, name) => mask | (MODIFIER_BITS[textOf(name)] ?? 0), 0)
}

/**
 * Watch for a navigation an action starts, as ChatGPT's `waitForPageLoadEvent` does:
 * a main-frame load that begins within {@link NAVIGATION_CLASSIFICATION_MS} of this call is
 * waited for until its DOMContentLoaded or load event, up to {@link NAVIGATION_TIMEOUT_MS};
 * a same-document navigation or a back-forward cache restore settles at once.
 * @param guest - the guest whose main frame is watched.
 * @param mainFrameId - the main frame's id now.
 * @param signal - abandons the watch.
 * @returns the settlement, which never rejects, and a cancel that settles it early.
 */
export function watchNavigation(
  guest: BrowserTarget, mainFrameId: string, signal: AbortSignal,
): { settled: Promise<void>; cancel: () => void } {
  let finish: () => void = () => {}
  const settled = new Promise<void>((resolve) => {
    let started = false
    let timer = setTimeout(() => { finish() }, NAVIGATION_CLASSIFICATION_MS)
    const listen = (_event: unknown, method: string, params: unknown): void => {
      const values = params as { frameId?: string; frame?: { id?: string; parentId?: string }; type?: string }
      switch (method) {
        case 'Page.navigatedWithinDocument':
          if (values.frameId === mainFrameId) finish()
          return
        case 'Page.frameStartedLoading':
        case 'Page.frameNavigated': {
          const main = method === 'Page.frameNavigated' ? values.frame?.parentId === undefined : values.frameId === mainFrameId
          if (!main) return
          if (method === 'Page.frameNavigated' && values.type === 'BackForwardCacheRestore') {
            finish()
            return
          }
          if (started) return
          started = true
          clearTimeout(timer)
          timer = setTimeout(() => { finish() }, NAVIGATION_TIMEOUT_MS)
          return
        }
        case 'Page.domContentEventFired':
        case 'Page.loadEventFired':
          if (started) finish()
          return
      }
    }
    finish = (): void => {
      clearTimeout(timer)
      guest.debugger.off('message', listen)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    guest.debugger.on('message', listen)
    signal.addEventListener('abort', finish, { once: true })
  })
  return { settled, cancel: () => { finish() } }
}

/**
 * Watch for a JavaScript dialog an action opens. A dialog blocks the page, so the
 * input that opened it does not complete until the dialog is answered; the action
 * returns when the dialog opens instead, and the agent answers it next.
 * @param guest - the guest whose page is watched.
 * @returns the dialog once one opens, and the disposer of the watch.
 */
function watchDialog(guest: BrowserTarget): { opened: Promise<OpenDialog>; dispose: () => void } {
  let dispose: () => void = () => {}
  const opened = new Promise<OpenDialog>((resolve) => {
    const listen = (_event: unknown, method: string, params: unknown): void => {
      if (method !== 'Page.javascriptDialogOpening') return
      const values = params as { type?: unknown; message?: unknown }
      resolve({ type: textOf(values.type), message: textOf(values.message) })
    }
    guest.debugger.on('message', listen)
    dispose = (): void => { guest.debugger.off('message', listen) }
  })
  return { opened, dispose }
}

/** The result fields that report a dialog an action opened. */
function dialogReport(dialog: OpenDialog): { dialog: OpenDialog; next: string } {
  return { dialog, next: `the page opened a JavaScript ${dialog.type} dialog; answer it with preview_dialog before anything else` }
}

/** File extensions and Google export formats a document kind accepts. */
const GOOGLE_EXPORTS: Readonly<Record<string, readonly string[]>> = {
  document: ['docx', 'pdf', 'md', 'txt', 'odt', 'rtf', 'epub'],
  spreadsheets: ['xlsx', 'csv', 'pdf', 'ods', 'tsv'],
  presentation: ['pptx', 'pdf', 'txt', 'odp'],
}

/**
 * Perform one agent action on a guest.
 * @param guest - the browser guest; its debugger is attached here when needed.
 * @param operation - browser operation named by the tool or pane.
 * @param input - the tool's arguments.
 * @param signal - execution lifetime supplied by the owning request.
 * @param host - local files, downloads, and clipboard where the engine runs.
 * @returns the action's JSON result.
 * @throws {Error} when the operation is unknown or the page refuses the action.
 */
export async function automate(
  guest: BrowserTarget,
  operation: string,
  input: BrowserAutomationInput,
  signal: AbortSignal = new AbortController().signal,
  host: EngineHost = {},
): Promise<unknown> {
  signal.throwIfAborted()
  if (!guest.debugger.isAttached()) guest.debugger.attach('1.3')
  const send = async (method: string, params?: object): Promise<unknown> => {
    signal.throwIfAborted()
    const result: unknown = await guest.debugger.sendCommand(method, params)
    signal.throwIfAborted()
    return result
  }
  const dialog = openDialogs.get(guest)
  if (dialog !== undefined && !DIALOG_SAFE.has(operation)) {
    throw new Error(`a JavaScript ${dialog.type} dialog is open ("${dialog.message}") and blocks the page; call preview_dialog to accept or dismiss it`)
  }
  let targetObjectId: string | undefined
  if (input.token !== undefined) {
    if (!['click', 'type', 'hover', 'check', 'read', 'select'].includes(operation) || typeof input.token !== 'string' || input.selector !== undefined || input.x !== undefined || input.y !== undefined || input.frame !== undefined) {
      throw new Error('an accessibility token is an exclusive target for click, type, hover, check, select, or read')
    }
    const targets = accessibilityTargets.get(guest)
    const tree = await send('Page.getFrameTree') as { frameTree: { frame: { loaderId: string } } }
    const backendNodeId = targets?.nodes.get(input.token)
    if (backendNodeId === undefined || tree.frameTree.frame.loaderId !== targets?.loaderId) {
      throw new Error('stale accessibility token; take a new preview_snapshot with mode ax')
    }
    const resolved = await send('DOM.resolveNode', { backendNodeId }) as { object: { objectId?: string } }
    targetObjectId = resolved.object.objectId
    if (targetObjectId === undefined) throw new Error('the accessibility target disappeared; take a new snapshot')
    const current = await send('Runtime.callFunctionOn', {
      objectId: targetObjectId,
      functionDeclaration: 'function(){return this.nodeType === 1 && this.isConnected && !this.disabled && this.getClientRects().length > 0 && getComputedStyle(this).visibility !== "hidden"}',
      returnByValue: true,
    }) as { result?: { value?: boolean } }
    if (current.result?.value !== true) {
      await guest.debugger.sendCommand('Runtime.releaseObject', { objectId: targetObjectId })
      accessibilityTargets.delete(guest)
      throw new Error('the accessibility target is detached, hidden, or disabled; take a new snapshot')
    }
  }
  if (operation !== 'snapshot') accessibilityTargets.delete(guest)

  // An action inside an iframe evaluates in an isolated world of that frame, and
  // its points are moved into the top viewport by the iframe's own position.
  let frameContextId: number | undefined
  let frameObjectId: string | undefined
  if (input.frame !== undefined) {
    if (typeof input.frame !== 'string' || input.frame === '') throw new Error('frame must be a selector of an iframe')
    const owner = await send('Runtime.evaluate', {
      expression: `(() => { ${LOCATOR_PRELUDE} const frame = __aevenLocate.one(${JSON.stringify(input.frame)}); if (!frame) throw new Error("no iframe matches the frame selector"); if (!(frame instanceof HTMLIFrameElement || frame instanceof HTMLFrameElement)) throw new Error("the frame selector matches an element that is not an iframe"); return frame; })()`,
      returnByValue: false,
    }) as { result?: { objectId?: string }; exceptionDetails?: { exception?: { description?: string }; text?: string } }
    if (owner.exceptionDetails !== undefined) throw new Error(owner.exceptionDetails.exception?.description ?? owner.exceptionDetails.text ?? 'the frame selector failed')
    frameObjectId = owner.result?.objectId
    if (frameObjectId === undefined) throw new Error('no iframe matches the frame selector')
    const described = await send('DOM.describeNode', { objectId: frameObjectId }) as { node: { frameId?: string } }
    if (described.node.frameId === undefined) throw new Error('the iframe has no document yet')
    const world = await send('Page.createIsolatedWorld', { frameId: described.node.frameId, worldName: 'aeven-browser', grantUniveralAccess: false }) as { executionContextId: number }
    frameContextId = world.executionContextId
  }

  const evaluate = async (expression: string): Promise<unknown> => {
    signal.throwIfAborted()
    if (targetObjectId !== undefined) {
      const response = await send('Runtime.callFunctionOn', {
        objectId: targetObjectId,
        functionDeclaration: `function(){return ${expression.replaceAll('__aevenTarget', 'this')}}`,
        returnByValue: true, awaitPromise: true, userGesture: true,
      }) as { result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string }; text?: string } }
      if (response.exceptionDetails !== undefined) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'accessibility target evaluation failed')
      return response.result?.value
    }
    const response = await send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, userGesture: true,
      ...frameContextId === undefined ? {} : { contextId: frameContextId },
    }) as { result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string }; text?: string } }
    if (response.exceptionDetails !== undefined) {
      throw new Error((response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'evaluation failed').split('\n')[0]?.replace(/^Error: /, ''))
    }
    return response.result?.value
  }
  /** Move a point measured inside the action's frame into the top viewport. */
  const toTop = async (point: Point): Promise<Point> => {
    if (frameObjectId === undefined) return point
    const box = await send('Runtime.callFunctionOn', {
      objectId: frameObjectId,
      functionDeclaration: 'function(){const r=this.getBoundingClientRect();return {x:r.left+this.clientLeft,y:r.top+this.clientTop}}',
      returnByValue: true,
    }) as { result?: { value?: Point } }
    const offset = box.result?.value ?? { x: 0, y: 0 }
    return { x: point.x + offset.x, y: point.y + offset.y }
  }
  /** Where an action's target is, or its x and y; scrolled into view when needed. */
  const pointFor = async (target: BrowserAutomationInput, fallback: string | null, actionable: boolean): Promise<Point> => {
    if (typeof target.token !== 'string' && typeof target.selector !== 'string' && typeof target.x === 'number' && typeof target.y === 'number') {
      return { x: target.x, y: target.y }
    }
    if (typeof target.token !== 'string' && typeof target.selector !== 'string' && fallback === null) throw new Error('name the target with selector, token, or x and y')
    const point = await evaluate(pointExpression(targetOf(target, fallback ?? 'null'), actionable)) as Point | null
    if (point === null) throw new Error(`no element matches ${textOf(target.selector) || 'the target'}; call preview_snapshot for current selectors`)
    return await toTop(point)
  }
  /** Discrete actions wait for the pointer to arrive; continuous updates do not. */
  const show = (cursor: CursorStep, wait = false, timeoutMs = CURSOR_ARRIVAL_TIMEOUT_MS): Promise<void> => {
    signal.throwIfAborted()
    return guest.presentCursor(cursor, wait, timeoutMs, signal)
  }
  /** ChatGPT `dispatchMouseMove`: the drawn cursor arrives, then the page's mouse moves there. */
  const moveTo = async (point: Point, anchor: { selector?: string } = {}, modifiers = 0): Promise<void> => {
    await show({ action: 'move', ...point, ...anchor }, true)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'none', buttons: 0, modifiers, ...point })
    pointerAt.set(guest, point)
    pointerInPage.add(guest)
  }
  /**
   * ChatGPT `clickPoint`: arrival, mouse move, one press and release per click count, then the navigation wait.
   * @returns the dialog the click opened, or null.
   */
  const clickAt = async (point: Point, anchor: { selector?: string }, options: { button: 'left' | 'right' | 'middle'; clickCount: number; modifiers: number }): Promise<OpenDialog | null> => {
    const frame = await send('Page.getFrameTree') as { frameTree: { frame: { id: string } } }
    const navigation = watchNavigation(guest, frame.frameTree.frame.id, signal)
    const dialog = watchDialog(guest)
    try {
      await send('Emulation.setFocusEmulationEnabled', { enabled: true })
      await moveTo(point, anchor, options.modifiers)
      const pressing = (async (): Promise<null> => {
        for (let count = 1; count <= options.clickCount; count++) {
          await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: options.button, buttons: BUTTON_MASK[options.button], clickCount: count, modifiers: options.modifiers })
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: options.button, buttons: 0, clickCount: count, modifiers: options.modifiers })
        }
        return null
      })()
      const opened = await Promise.race([pressing, dialog.opened])
      if (opened !== null) {
        // The release completes once the dialog is answered; its outcome belongs to that later answer.
        void pressing.catch(() => undefined)
        navigation.cancel()
        return opened
      }
      const settled = await Promise.race([navigation.settled.then(() => null), dialog.opened])
      signal.throwIfAborted()
      return settled
    } catch (error) {
      navigation.cancel()
      throw error
    } finally {
      dialog.dispose()
    }
  }
  /**
   * The pointer has left the page for the pane's own chrome row.
   *
   * Its page position stops applying, so a later scroll enters the page deliberately at that
   * horizontal position instead of starting from a place the pointer is no longer at.
   */
  const leavePage = (): void => { pointerInPage.delete(guest) }
  /** Where a scroll with no named target starts: the pointer's own place when it is in the page, else just inside the top edge. */
  const scrollOrigin = async (): Promise<Point> => {
    const viewport = await evaluate('({ w: innerWidth, h: innerHeight })') as { w: number; h: number }
    const previous = pointerAt.get(guest)
    if (pointerInPage.has(guest) && previous !== undefined) return previous
    const x = previous === undefined ? viewport.w / 2 : Math.min(Math.max(previous.x, 0), viewport.w)
    return { x, y: SCROLL_ENTRY_INSET_PX }
  }
  try {
    switch (operation) {
      case 'upload': {
        if (frameContextId !== undefined) throw new Error('upload inside an iframe is unsupported; use a main-page file input')
        const requested = input.paths
        if (!Array.isArray(requested) || requested.length === 0 || !requested.every(path => typeof path === 'string' && isAbsolutePath(path))) {
          throw new Error('upload requires absolute file paths on the computer running this browser')
        }
        if (host.resolveFiles === undefined) throw new Error('this browser cannot attach files from the computer')
        const files = await host.resolveFiles(requested as string[])
        signal.throwIfAborted()
        if (typeof input.origin !== 'string' || new URL(guest.getURL()).origin !== input.origin) throw new Error('the page origin changed; request upload approval again')
        const selector = typeof input.selector === 'string' ? input.selector : 'input[type=file]'
        const point = await pointFor({ selector }, null, false)
        await moveTo(point, anchorOf(input))
        let backendNodeId: number | undefined
        /** The chooser's own selection mode, recorded by the debugger handler that owns the frame. */
        const chooserMode = { multiple: false }
        let chooserFrame: string | undefined
        let resolveChooser: (() => void) | undefined
        let rejectChooser: ((reason: unknown) => void) | undefined
        const chooser = new Promise<void>((resolve, reject) => { resolveChooser = resolve; rejectChooser = reject })
        void chooser.catch(() => { /* The action reports cancellation through its own signal checks. */ })
        const cancelChooser = (): void => { rejectChooser?.(signal.reason) }
        const opened = (_event: unknown, method: string, params: unknown): void => {
          if (method !== 'Page.fileChooserOpened' || typeof params !== 'object' || params === null || !('backendNodeId' in params) || typeof params.backendNodeId !== 'number') return
          backendNodeId = params.backendNodeId
          chooserFrame = 'frameId' in params && typeof params.frameId === 'string' ? params.frameId : undefined
          chooserMode.multiple = 'mode' in params && params.mode === 'selectMultiple'
          resolveChooser?.()
        }
        guest.debugger.on('message', opened)
        try {
          await send('Page.enable')
          const frames = await send('Page.getFrameTree') as { frameTree: { frame: { id: string } } }
          const expression = `(() => {
            ${LOCATOR_PRELUDE}
            const nodes = __aevenLocate.all(${JSON.stringify(selector)});
            if (nodes.length > 1) throw new Error("the upload selector matches multiple elements; choose one file input");
            return nodes[0] ?? null;
          })()`
          const node = await send('Runtime.evaluate', { expression, returnByValue: false }) as { result?: { objectId?: string }; exceptionDetails?: { text?: string } }
          if (node.exceptionDetails !== undefined) throw new Error('the upload selector is invalid or ambiguous; choose one target')
          if (node.result?.objectId === undefined) throw new Error('no upload target matches; provide the file input or Upload button selector')
          const objectId = node.result.objectId
          try {
            const info = await send('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function(){return {file:this instanceof HTMLInputElement && this.type === "file",multiple:this.multiple,disabled:this.disabled}}', returnByValue: true }) as { result?: { value?: { file?: boolean; multiple?: boolean; disabled?: boolean } } }
            if (info.result?.value?.disabled === true) throw new Error('the upload target is disabled')
            if (info.result?.value?.file === true) {
              if (files.length > 1 && info.result.value.multiple !== true) throw new Error('the file input does not accept multiple files')
              const description = await send('DOM.describeNode', { objectId }) as { node: { backendNodeId: number } }
              backendNodeId = description.node.backendNodeId
            } else {
              signal.addEventListener('abort', cancelChooser, { once: true })
              await send('Page.setInterceptFileChooserDialog', { enabled: true })
              await send('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function(){this.click()}', userGesture: true })
              let timer: ReturnType<typeof setTimeout> | undefined
              try {
                await Promise.race([chooser, new Promise<never>((_resolve, reject) => {
                  timer = setTimeout(() => { reject(new Error('the upload control did not open a file chooser; provide the file input selector')) }, 5000)
                })])
                signal.throwIfAborted()
              } finally {
                if (timer !== undefined) clearTimeout(timer)
              }
              if (chooserFrame !== frames.frameTree.frame.id) throw new Error('upload choosers in embedded frames are unsupported; use a main-page file input')
              if (files.length > 1 && !chooserMode.multiple) throw new Error('the chooser does not accept multiple files')
            }
            if (new URL(guest.getURL()).origin !== input.origin) throw new Error('the page origin changed before upload')
            await send('DOM.setFileInputFiles', { backendNodeId, files })
            return { ok: true, files: files.map(file => baseName(file)) }
          } finally {
            if (guest.debugger.isAttached()) await guest.debugger.sendCommand('Runtime.releaseObject', { objectId })
          }
        } finally {
          signal.removeEventListener('abort', cancelChooser)
          guest.debugger.off('message', opened)
          if (guest.debugger.isAttached()) await guest.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false })
        }
      }
      case 'wait': {
        const timeoutMs = input.timeoutMs ?? 5000
        if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) throw new Error('wait timeout must be between 1 and 60000ms')
        if (input.state !== undefined && input.state !== 'visible' && input.state !== 'hidden' && input.state !== 'attached' && input.state !== 'detached') throw new Error('wait state must be visible, hidden, attached, or detached')
        if (input.load !== undefined && input.load !== 'load' && input.load !== 'domcontentloaded') throw new Error('wait load must be load or domcontentloaded')
        const hasSelector = typeof input.selector === 'string' && input.selector.length > 0
        const hasUrl = typeof input.url === 'string' && input.url.length > 0
        if (!hasSelector && !hasUrl && input.load === undefined) throw new Error('wait requires a selector, a url, or a load state')
        const urlMatches = (url: string): boolean => {
          const wanted = String(input.url)
          const regex = /^\/(.*)\/([a-z]*)$/s.exec(wanted)
          return regex === null ? url.includes(wanted) : new RegExp(regex[1] ?? '', regex[2]).test(url)
        }
        const deadline = Date.now() + timeoutMs
        for (;;) {
          let ready = true
          if (hasUrl) ready &&= urlMatches(guest.getURL())
          if (ready && input.load !== undefined) {
            const state = await evaluate('document.readyState')
            ready = input.load === 'load' ? state === 'complete' : state !== 'loading'
          }
          if (ready && hasSelector) {
            ready = await evaluate(`(() => {
              ${LOCATOR_PRELUDE}
              const nodes = __aevenLocate.all(${JSON.stringify(input.selector)});
              const state = ${JSON.stringify(input.state ?? 'visible')};
              if (state === "attached") return nodes.length > 0;
              if (state === "detached") return nodes.length === 0;
              if (nodes.length > 1) throw new Error("the wait selector matches multiple elements");
              const element = nodes[0];
              const visible = !!element && __aevenLocate.visible(element);
              if (state === "hidden") return !visible;
              return visible && !element.disabled;
            })()`) === true
          }
          if (ready) return { ok: true, url: guest.getURL() }
          if (Date.now() >= deadline) {
            const awaited = [hasSelector ? textOf(input.selector) : '', hasUrl ? `url ${textOf(input.url)}` : '', textOf(input.load)]
            throw new Error(`timed out after ${String(timeoutMs)}ms waiting for ${awaited.filter(part => part !== '').join(', ')}`)
          }
          await sleep(25, signal)
        }
      }
      case 'sequence': {
        if (!Array.isArray(input.actions) || input.actions.length === 0 || input.actions.length > 20) throw new Error('sequence requires 1 to 20 actions')
        const allowed = ['click', 'type', 'press', 'upload', 'wait', 'hover', 'select', 'check', 'scroll']
        for (const action of input.actions) {
          if (typeof action !== 'object' || action === null || Array.isArray(action) || !('operation' in action)) throw new Error('sequence actions must name an operation')
          const values = action as BrowserAutomationInput
          if (!allowed.includes(String(values.operation))) throw new Error(`sequence supports ${allowed.join(', ')}`)
          if (['click', 'hover', 'select', 'check'].includes(String(values.operation)) && typeof values.selector !== 'string') throw new Error(`${String(values.operation)} requires a selector`)
          if (values.operation === 'type' && typeof values.text !== 'string') throw new Error('type requires text')
          if (values.operation === 'press' && typeof values.key !== 'string') throw new Error('press requires a key')
          if (values.operation === 'select' && !Array.isArray(values.values)) throw new Error('select requires values')
          if (values.operation === 'check' && typeof values.checked !== 'boolean') throw new Error('check requires checked')
          if (values.operation === 'upload' && (!Array.isArray(values.paths) || values.paths.length === 0 || !values.paths.every(path => typeof path === 'string' && isAbsolutePath(path)))) throw new Error('upload requires absolute file paths')
        }
        let completed = 0
        for (const action of input.actions) {
          try {
            await automate(guest, String((action as BrowserAutomationInput).operation), action as BrowserAutomationInput, signal, host)
            completed++
          } catch (error) {
            signal.throwIfAborted()
            return { ok: false, completed, failedAction: completed + 1, error: error instanceof Error ? error.message : String(error) }
          }
        }
        return { ok: true, completed }
      }
      case 'screenshot': {
        const capture = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80, captureBeyondViewport: false }) as { data: string }
        return { data: capture.data, mimeType: 'image/jpeg' }
      }
      case 'snapshot': {
        accessibilityTargets.delete(guest)
        if (input.mode !== 'ax') return await evaluate(SNAPSHOT)
        if (frameContextId !== undefined) throw new Error('mode ax reads the top document; use mode dom inside a frame')
        const tree = await send('Page.getFrameTree') as { frameTree: { frame: { loaderId: string } } }
        await send('Accessibility.enable')
        const result = await send('Accessibility.getFullAXTree') as { nodes: BrowserAxNode[] }
        const snapshotId = randomUUID()
        const targets = new Map<string, number>()
        const visible = result.nodes.filter(node => !node.ignored)
        const nodes = visible.slice(0, MAX_INTERACTIVE_ELEMENTS).map((node, index) => {
          const token = `${snapshotId}:${index}`
          if (node.backendDOMNodeId !== undefined) targets.set(token, node.backendDOMNodeId)
          const properties = new Map(node.properties?.map(property => [property.name, property.value.value]))
          return { index, token, role: node.role?.value ?? 'unknown', title: node.name?.value.slice(0, MAX_INTERACTIVE_ELEMENT_NAME_LENGTH),
            value: node.value?.value.slice(0, MAX_INTERACTIVE_ELEMENT_NAME_LENGTH), editable: properties.get('editable') !== undefined,
            ...properties.has('checked') ? { checked: properties.get('checked') } : {},
            ...properties.get('disabled') === true ? { disabled: true } : {} }
        })
        const after = await send('Page.getFrameTree') as { frameTree: { frame: { loaderId: string } } }
        if (after.frameTree.frame.loaderId !== tree.frameTree.frame.loaderId) throw new Error('the page navigated during observation; take a new snapshot')
        accessibilityTargets.set(guest, { snapshotId, loaderId: tree.frameTree.frame.loaderId, nodes: targets })
        return { url: guest.getURL(), title: guest.getTitle(), snapshotId, nodes, truncated: visible.length > MAX_INTERACTIVE_ELEMENTS }
      }
      case 'click': {
        const clickCount = input.clickCount === undefined ? 1 : Number(input.clickCount)
        if (!Number.isInteger(clickCount) || clickCount < 1 || clickCount > 3) throw new Error('clickCount must be 1, 2, or 3')
        const button = input.button === undefined ? 'left' : input.button
        if (button !== 'left' && button !== 'right' && button !== 'middle') throw new Error('button must be left, right, or middle')
        const point = await pointFor(input, null, true)
        const dialog = await clickAt(point, anchorOf(input), { button, clickCount, modifiers: modifierMask(input) })
        return { ok: true, url: guest.getURL(), ...dialog === null ? {} : dialogReport(dialog) }
      }
      case 'hover': {
        const point = await pointFor(input, null, false)
        await moveTo(point, anchorOf(input), modifierMask(input))
        return { ok: true }
      }
      case 'drag': {
        const from = input.from as BrowserAutomationInput | null | undefined
        const to = input.to as BrowserAutomationInput | null | undefined
        if (typeof from !== 'object' || from === null || typeof to !== 'object' || to === null) throw new Error('drag requires from and to, each a selector or x and y')
        const start = await pointFor(from, null, false)
        const end = await pointFor(to, null, false)
        const modifiers = modifierMask(input)
        await send('Emulation.setFocusEmulationEnabled', { enabled: true })
        // ChatGPT `dragPath`: the cursor arrives at the first point only; the pressed moves do not wait.
        await moveTo(start, {}, modifiers)
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1, modifiers })
        let released = false
        let last = start
        try {
          void show({ action: 'move', ...end })
          last = end
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...end, button: 'left', buttons: 1, modifiers })
          released = true
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', buttons: 0, clickCount: 1, modifiers })
        } finally {
          if (!released && guest.debugger.isAttached()) {
            await guest.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...last, button: 'left', buttons: 0, clickCount: 1, modifiers }).catch(() => undefined)
          }
        }
        pointerAt.set(guest, end)
        return { ok: true }
      }
      case 'select': {
        const values = input.values
        if (!Array.isArray(values) || values.length === 0 || !values.every(value => typeof value === 'string')) throw new Error('select requires values: option values or labels')
        const point = await pointFor(input, null, true)
        await moveTo(point, anchorOf(input))
        const result = await evaluate(`(() => {
          ${LOCATOR_PRELUDE}
          const element = ${targetOf(input, 'null')};
          if (!element) return { notFound: true };
          if (!(element instanceof HTMLSelectElement)) return { notSelect: true };
          if (element.disabled) return { disabled: true };
          const wanted = ${JSON.stringify(values)};
          const options = [...element.options];
          const picked = wanted.map((value) => options.find((option) => option.value === value)
            ?? options.find((option) => option.label.trim() === value.trim())
            ?? options.find((option) => option.label.trim().toLowerCase() === value.trim().toLowerCase()));
          if (picked.some((option) => !option)) return { missing: wanted.filter((_value, index) => !picked[index]), available: options.slice(0, 50).map((option) => ({ value: option.value, label: option.label })) };
          if (!element.multiple && picked.length > 1) return { notMultiple: true };
          for (const option of options) option.selected = picked.includes(option);
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          return { selected: picked.map((option) => option.value) };
        })()`) as { notFound?: true; notSelect?: true; disabled?: true; notMultiple?: true; missing?: string[]; available?: unknown; selected?: string[] }
        if (result.notFound === true) throw new Error('no element matches the target; call preview_snapshot for current selectors')
        if (result.notSelect === true) throw new Error('the target is not a <select>; open the custom dropdown with preview_click and click its option')
        if (result.disabled === true) throw new Error('the select is disabled')
        if (result.notMultiple === true) throw new Error('the select accepts one option')
        if (result.missing !== undefined) throw new Error(`no option matches ${result.missing.join(', ')}; available: ${JSON.stringify(result.available)}`)
        return { ok: true, selected: result.selected }
      }
      case 'check': {
        if (typeof input.checked !== 'boolean') throw new Error('check requires checked: true or false')
        const stateExpression = `(() => {
          ${LOCATOR_PRELUDE}
          const element = ${targetOf(input, 'null')};
          if (!element) return { notFound: true };
          const native = element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio");
          const aria = element.getAttribute("aria-checked");
          if (!native && aria === null) return { notCheckable: true };
          return { checked: native ? element.checked : aria === "true" };
        })()`
        const before = await evaluate(stateExpression) as { notFound?: true; notCheckable?: true; checked?: boolean }
        if (before.notFound === true) throw new Error('no element matches the target; call preview_snapshot for current selectors')
        if (before.notCheckable === true) throw new Error('the target is not a checkbox, radio, or aria-checked control')
        if (before.checked === input.checked) return { ok: true, checked: input.checked, changed: false }
        const point = await pointFor(input, null, true)
        const dialog = await clickAt(point, anchorOf(input), { button: 'left', clickCount: 1, modifiers: 0 })
        if (dialog !== null) return { ok: true, changed: true, ...dialogReport(dialog) }
        const after = await evaluate(stateExpression) as { checked?: boolean }
        if (after.checked !== input.checked) throw new Error(`clicking the control did not make it ${input.checked ? 'checked' : 'unchecked'}`)
        return { ok: true, checked: input.checked, changed: true }
      }
      case 'read': {
        const property = input.property ?? 'text'
        if (typeof property !== 'string' || !['text', 'innerText', 'html', 'value', 'attribute', 'count', 'visible', 'enabled', 'checked', 'box'].includes(property)) throw new Error('read property must be text, innerText, html, value, attribute, count, visible, enabled, checked, or box')
        if (property === 'attribute' && typeof input.name !== 'string') throw new Error('read attribute requires name')
        if (targetObjectId === undefined && typeof input.selector !== 'string') throw new Error('read requires a selector or token')
        const value = await evaluate(`(() => {
          ${LOCATOR_PRELUDE}
          const nodes = ${targetObjectId === undefined ? `__aevenLocate.all(${JSON.stringify(input.selector)})` : '[__aevenTarget]'};
          const property = ${JSON.stringify(property)};
          if (property === "count") return nodes.length;
          const read = (element) => {
            switch (property) {
              case "text": return (element.textContent ?? "").replace(/\\s+/g, " ").trim();
              case "innerText": return element.innerText ?? element.textContent ?? "";
              case "html": return element.outerHTML;
              case "value": return "value" in element ? String(element.value) : null;
              case "attribute": return element.getAttribute(${JSON.stringify(input.name ?? '')});
              case "visible": return __aevenLocate.visible(element);
              case "enabled": return !element.disabled && element.getAttribute("aria-disabled") !== "true";
              case "checked": return element instanceof HTMLInputElement ? element.checked : element.getAttribute("aria-checked") === "true";
              case "box": { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; }
            }
          };
          if (${String(input.all === true)}) return { values: nodes.slice(0, ${String(MAX_READ_ELEMENTS)}).map(read), count: nodes.length };
          if (nodes.length === 0) throw new Error("no element matches the target; call preview_snapshot for current selectors");
          if (nodes.length > 1) throw new Error(nodes.length + " elements match; pass all: true or refine the selector");
          return { value: read(nodes[0]) };
        })()`)
        if (jsonBytes(value) > MAX_EVALUATION_BYTES) throw new Error(`the result is larger than ${String(MAX_EVALUATION_BYTES)} bytes; narrow the selector`)
        return typeof value === 'number' ? { count: value } : value
      }
      case 'content': {
        const format = input.format ?? 'markdown'
        if (format === 'youtube_transcript') {
          const transcript = await evaluate(YOUTUBE_TRANSCRIPT) as
            { title: string; language: string | null; lines: Array<{ seconds: number; text: string }> }
          const stamp = (seconds: number): string => `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`
          const text = transcript.lines.map(line => `[${stamp(line.seconds)}] ${line.text}`).join('\n')
          return {
            title: transcript.title, language: transcript.language,
            text: text.slice(0, MAX_CONTENT_LENGTH), truncated: text.length > MAX_CONTENT_LENGTH,
          }
        }
        const expression = format === 'markdown' ? PAGE_MARKDOWN
          : format === 'text' ? '(document.body?.innerText ?? "")'
            : format === 'html' ? 'document.documentElement.outerHTML'
              : undefined
        if (expression === undefined) throw new Error('content format must be markdown, text, html, or youtube_transcript')
        const text = textOf(await evaluate(expression))
        return {
          url: guest.getURL(), title: guest.getTitle(), format,
          text: text.slice(0, MAX_CONTENT_LENGTH), truncated: text.length > MAX_CONTENT_LENGTH, length: text.length,
        }
      }
      case 'export': {
        const page = new URL(guest.getURL())
        const match = /^\/(document|spreadsheets|presentation)\/d\/([^/]+)/.exec(page.pathname)
        if (page.hostname !== 'docs.google.com' || match === null) throw new Error('export works on an open Google Docs, Sheets, or Slides document')
        const kind = match[1] ?? 'document'
        const id = match[2] ?? ''
        const formats = GOOGLE_EXPORTS[kind] ?? []
        const format = typeof input.format === 'string' ? input.format : formats[0]
        if (format === undefined || !formats.includes(format)) throw new Error(`a ${kind} exports as ${formats.join(', ')}`)
        const gid = /[#&?]gid=(\d+)/.exec(page.href)?.[1]
        const url = `https://docs.google.com/${kind}/d/${id}/export?format=${format}${gid !== undefined && (format === 'csv' || format === 'tsv') ? `&gid=${gid}` : ''}`
        const response = await guest.session.fetch(url, { signal })
        if (!response.ok) throw new Error(`Google answered the export with HTTP ${String(response.status)}; the document may not allow downloads`)
        if ((response.headers.get('content-type') ?? '').startsWith('text/html')) throw new Error('Google answered with a page instead of the file; sign in or ask the owner for download access')
        const bytes = new Uint8Array(await response.arrayBuffer())
        const title = guest.getTitle().replace(/ - Google (Docs|Sheets|Slides)$/, '').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'export'
        const textual = ['md', 'txt', 'csv', 'tsv'].includes(format)
        const text = textual ? new TextDecoder().decode(bytes) : undefined
        if (host.saveDownload === undefined && text === undefined) throw new Error('this browser cannot save files; export as md, txt, csv, or tsv to read the content')
        const path = host.saveDownload === undefined ? undefined : await host.saveDownload(`${title}.${format}`, bytes)
        return {
          ok: true, format, bytes: bytes.length, ...path === undefined ? {} : { path },
          ...text === undefined ? {} : { text: text.slice(0, MAX_CONTENT_LENGTH), truncated: text.length > MAX_CONTENT_LENGTH },
        }
      }
      case 'clipboard': {
        if (host.clipboard === undefined) throw new Error("this browser cannot reach the computer's clipboard")
        if (input.action === 'read') return { text: await host.clipboard.readText() }
        if (input.action === 'write') {
          if (typeof input.text !== 'string') throw new Error('clipboard write requires text')
          await host.clipboard.writeText(input.text)
          return { ok: true }
        }
        throw new Error('clipboard action must be read or write')
      }
      case 'console': {
        const entries = consoleEntries.get(guest) ?? []
        const levels = Array.isArray(input.levels) ? input.levels.map(String) : undefined
        const limit = typeof input.limit === 'number' && Number.isInteger(input.limit) && input.limit > 0 ? Math.min(input.limit, MAX_CONSOLE_ENTRIES) : 100
        const matching = entries.filter(entry => levels === undefined || levels.includes(entry.level))
        const result = {
          entries: matching.slice(-limit).map(entry => ({ ...entry, text: entry.text.slice(0, 2000) })), total: matching.length,
        }
        if (input.clear === true) consoleEntries.delete(guest)
        return result
      }
      case 'dialog': {
        const open = openDialogs.get(guest)
        if (input.action === undefined) return open === undefined ? { open: false } : { open: true, ...open }
        if (input.action !== 'accept' && input.action !== 'dismiss') throw new Error('dialog action must be accept or dismiss')
        if (open === undefined) throw new Error('no JavaScript dialog is open')
        await send('Page.handleJavaScriptDialog', { accept: input.action === 'accept', ...typeof input.promptText === 'string' ? { promptText: input.promptText } : {} })
        // The page is answered, but Electron's own message box for it stays on screen:
        // its `-cancel-dialogs` handler (lib/browser/api/web-contents.ts) aborts that box.
        guest.emit('-cancel-dialogs')
        openDialogs.delete(guest)
        return { ok: true, handled: { ...open, action: input.action } }
      }
      case 'webmcp': {
        if (input.action !== 'list' && input.action !== 'invoke') throw new Error('webmcp action must be list or invoke')
        if (input.action === 'invoke' && typeof input.name !== 'string') throw new Error('webmcp invoke requires the tool name')
        // WebMCP tools the page registered: the native `document.modelContext`
        // (getTools, executeTool), or Chrome's `navigator.modelContextTesting`
        // (listTools, executeTool by name with JSON input).
        const value = await evaluate(`(async () => {
          const native = Reflect.get(document, "modelContext");
          const testing = Reflect.get(navigator, "modelContextTesting");
          const describe = (tool) => ({ name: tool.name, title: tool.title ?? null, description: tool.description ?? null,
            inputSchema: typeof tool.inputSchema === "string" ? JSON.parse(tool.inputSchema) : tool.inputSchema ?? null,
            annotations: tool.annotations ?? null });
          const list = async () => {
            if (native && typeof native.getTools === "function") return (await native.getTools()).filter((tool) => tool.window === undefined || tool.window === window);
            if (testing && typeof testing.listTools === "function") return await testing.listTools();
            return null;
          };
          const tools = await list();
          if (tools === null) return { supported: false, tools: [] };
          if (${JSON.stringify(input.action)} === "list") return { supported: true, tools: tools.map(describe) };
          const name = ${JSON.stringify(input.name ?? '')};
          const tool = tools.find((candidate) => candidate.name === name);
          if (!tool) throw new Error("the page has no WebMCP tool " + name + "; list the tools first");
          const input = ${JSON.stringify(input.input ?? {})};
          let result;
          if (native && typeof native.executeTool === "function") {
            result = await native.executeTool(tool, native.executeTool.length === 2 ? JSON.stringify(input) : input, { signal: AbortSignal.timeout(${String(30_000)}) });
          } else {
            result = await testing.executeTool(name, JSON.stringify(input));
          }
          if (typeof result === "string") { try { result = JSON.parse(result) } catch {} }
          return { supported: true, result: result ?? null };
        })()`)
        if (jsonBytes(value) > MAX_EVALUATION_BYTES) throw new Error(`the result is larger than ${String(MAX_EVALUATION_BYTES)} bytes`)
        return { origin: new URL(guest.getURL()).origin, ...value as object }
      }
      case 'type': {
        const target = targetOf(input, 'document.activeElement')
        const point = await toTop(await evaluate(pointExpression(target, false)) as Point | null ?? await evaluate('({ x: innerWidth / 2, y: innerHeight / 2 })') as Point)
        await moveTo(point, anchorOf(input))
        await send('Emulation.setFocusEmulationEnabled', { enabled: true })
        const result = await evaluate(focusExpression(input)) as FocusOutcome
        if (result.notFound === true) throw new Error('no element matches the target; call preview_snapshot for current selectors')
        if (result.notEditable === true) throw new Error('the target is disabled, read-only, or not editable')
        if (result.focusFailed === true) throw new Error('the target could not take focus')
        const text = typeof input.text === 'string' ? input.text : ''
        const focused = targetObjectId === undefined
          ? await send('Runtime.evaluate', { expression: `(() => { ${LOCATOR_PRELUDE} return ${target}; })()`, returnByValue: false, ...frameContextId === undefined ? {} : { contextId: frameContextId } }) as { result?: { objectId?: string } }
          : { result: { objectId: targetObjectId } }
        const objectId = focused.result?.objectId
        if (objectId === undefined) throw new Error('the editor disappeared before text insertion')
        try {
          if (input.sequential === true) {
            // ChatGPT `pressSequentially`: one character at a time, a line break or tab as its key.
            const characters = Array.from(text)
            for (const [index, character] of characters.entries()) {
              if (character === '\n') press(guest, { key: 'Enter' })
              else if (character === '\t') press(guest, { key: 'Tab' })
              else await guest.insertText(character)
              if (index < characters.length - 1) await sleep(SEQUENTIAL_TYPE_DELAY_MS, signal)
            }
          } else if (text !== '') {
            await guest.insertText(text)
          }
          const focus = await send('Runtime.callFunctionOn', {
            objectId, functionDeclaration: 'function(){return this === this.getRootNode().activeElement}', returnByValue: true,
          }) as { result?: { value?: boolean } }
          if (focus.result?.value !== true) throw new Error('focus moved away during text insertion; inspect the editor before continuing')
        } finally {
          if (targetObjectId === undefined && guest.debugger.isAttached()) await guest.debugger.sendCommand('Runtime.releaseObject', { objectId })
        }
        signal.throwIfAborted()
        return { ok: true, characters: Array.from(text).length }
      }
      case 'press': {
        await send('Emulation.setFocusEmulationEnabled', { enabled: true })
        // A key lands in whatever holds focus, so the pointer shows that element
        // rather than staying where the last action left it.
        const point = await toTop(await evaluate(pointExpression('document.activeElement', false)) as Point | null ?? await evaluate('({ x: innerWidth / 2, y: innerHeight / 2 })') as Point)
        await show({ action: 'type', ...point }, true)
        signal.throwIfAborted()
        const frame = await send('Page.getFrameTree') as { frameTree: { frame: { id: string } } }
        const navigation = watchNavigation(guest, frame.frameTree.frame.id, signal)
        const dialog = watchDialog(guest)
        try {
          press(guest, input)
          const opened = await Promise.race([navigation.settled.then(() => null), dialog.opened])
          if (opened !== null) navigation.cancel()
          return { ok: true, ...opened === null ? {} : dialogReport(opened) }
        } finally {
          dialog.dispose()
        }
      }
      case 'scroll': {
        const deltaX = Number(input.deltaX ?? 0)
        const deltaY = Number(input.deltaY ?? 0)
        if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) throw new Error('scroll deltas must be numbers')
        const point = typeof input.selector === 'string' || typeof input.token === 'string'
          ? await pointFor(input, null, false)
          : typeof input.x === 'number' && typeof input.y === 'number' ? { x: input.x, y: input.y } : await scrollOrigin()
        // ChatGPT `scrollPoint` with its `mouseWheel` method: the cursor arrives and the
        // mouse moves there, then one wheel event scrolls whatever is under the point.
        // The step is announced as a scroll, so the pane does not re-aim the pointer
        // while the page moves under it.
        await show({ action: 'scroll', ...point, ...anchorOf(input) }, true)
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'none', buttons: 0, ...point })
        const position = `(() => { const at = document.elementFromPoint(${String(point.x)}, ${String(point.y)}); let node = at; while (node && node !== document.documentElement && !(node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)) node = node.parentElement; const scroller = node && node !== document.documentElement ? node : document.scrollingElement ?? document.documentElement; return scroller.scrollLeft + "," + scroller.scrollTop })()`
        await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX, deltaY })
        // Chromium animates a wheel scroll; the call returns once the position stops moving.
        const settleBy = Date.now() + SCROLL_SETTLE_MAX_MS
        let last = await evaluate(position)
        while (Date.now() < settleBy) {
          await sleep(SCROLL_SETTLE_POLL_MS, signal)
          const now = await evaluate(position)
          if (now === last) break
          last = now
        }
        void show({ action: 'move', ...point })
        pointerAt.set(guest, point)
        pointerInPage.add(guest)
        return { ok: true }
      }
      case 'status':
        return { open: true, url: guest.getURL(), title: guest.getTitle() }
      case 'back':
      case 'forward':
      case 'reload':
      case 'navigate':
        if (guest.navigate !== undefined) {
          await guest.navigate(operation, typeof input.url === 'string' ? input.url : '', signal)
          return { ok: true, url: guest.getURL(), title: guest.getTitle() }
        }
        if (operation === 'navigate') {
          // The address field belongs to the pane's chrome row: the pane types the
          // address there, then loads it, exactly as the reader doing it by hand.
          leavePage()
          await show({ action: 'control', control: 'navigate', url: typeof input.url === 'string' ? input.url : '', x: 0, y: 0 }, true, CONTROL_GESTURE_TIMEOUT_MS)
          return { ok: true }
        }
        // The app renderer owns chrome input and acknowledges it after cursor arrival.
        leavePage()
        await show({ action: 'control', control: operation === 'reload' ? 'refresh' : operation, x: 0, y: 0 }, true, CONTROL_GESTURE_TIMEOUT_MS)
        return { ok: true }
      case 'capture': {
        // The app renderer owns chrome input and acknowledges it after cursor arrival.
        leavePage()
        await show({ action: 'control', control: 'capture', x: 0, y: 0 }, true, CONTROL_GESTURE_TIMEOUT_MS)
        return { ok: true }
      }
      case 'control': {
        // Any pane chrome control by name, so a new button needs no new operation.
        leavePage()
        const control = typeof input.control === 'string' ? input.control : ''
        await show({ action: 'control', control, x: 0, y: 0 }, true, CONTROL_GESTURE_TIMEOUT_MS)
        return { ok: true }
      }
      case 'evaluate': {
        const dialog = watchDialog(guest)
        const evaluation = evaluate(String(input.expression))
        let opened: OpenDialog | null
        try {
          opened = await Promise.race([evaluation.then(() => null), dialog.opened])
        } finally {
          dialog.dispose()
        }
        if (opened !== null) {
          void evaluation.catch(() => undefined)
          return { value: null, ...dialogReport(opened) }
        }
        const value = await evaluation
        if (jsonBytes(value) > MAX_EVALUATION_BYTES) {
          throw new Error(`the result is larger than ${String(MAX_EVALUATION_BYTES)} bytes`)
        }
        return { value: value ?? null }
      }
      default:
        throw new Error(`unknown browser operation ${operation}`)
    }
  } finally {
    if (targetObjectId !== undefined && guest.debugger.isAttached()) await guest.debugger.sendCommand('Runtime.releaseObject', { objectId: targetObjectId })
    if (frameObjectId !== undefined && guest.debugger.isAttached()) await guest.debugger.sendCommand('Runtime.releaseObject', { objectId: frameObjectId }).catch(() => undefined)
  }
}
