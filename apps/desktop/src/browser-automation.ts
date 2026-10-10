/** Agent actions on the sidebar guest. Native guest input preserves the app composer's focus; cursor animation runs independently of action completion. */

import type { WebContents } from 'electron'
import { basename, isAbsolute } from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import { DESKTOP_IPC, type DesktopBrowserCursor } from './ipc.ts'

/** Interactive elements a snapshot lists (t3code `MAX_INTERACTIVE_ELEMENTS`). */
const MAX_INTERACTIVE_ELEMENTS = 200
/** Characters kept of each element's name. */
const MAX_INTERACTIVE_ELEMENT_NAME_LENGTH = 120
/** Characters kept of the page's visible text. */
const MAX_VISIBLE_TEXT_LENGTH = 40_000
/** Bytes an evaluated value may serialize to (t3code `MAX_EVALUATION_BYTES`). */
const MAX_EVALUATION_BYTES = 64_000
/** How long one scroll gesture takes on the page, in ms. */
const SCROLL_DURATION_MS = 420
/** How far the pointer travels in the scroll's direction over a gesture, in CSS pixels. */
const SCROLL_DRIFT_RATIO = 0.25
const SCROLL_DRIFT_MIN_PX = 24
const SCROLL_DRIFT_MAX_PX = 120
/** How far inside the page's top edge a scroll's pointer enters when it was outside the page, in CSS pixels. */
const SCROLL_ENTRY_INSET_PX = 24
/** Pointer updates sent during one scroll gesture, so the travel is drawn rather than announced. */
const SCROLL_POINTER_STEPS = 6
/** Where the pointer last arrived in each guest, in its viewport CSS pixels. */
const pointerAt = new WeakMap<WebContents, { x: number; y: number }>()
/**
 * Guests whose pointer is currently drawn inside the page. A chrome action leaves the pointer on
 * the pane's own controls, where its page coordinates mean nothing: without this, a later scroll
 * would start from a stale in-page point and the pointer would jump out of the chrome row.
 */
const pointerInPage = new WeakSet<WebContents>()
/** The selector used to anchor a pointer action to its element. @param input - tool arguments. @returns cursor selector metadata. */
function named(input: BrowserAutomationInput): { selector?: string } {
  return typeof input.selector === 'string' ? { selector: input.selector } : {}
}

/** Number of the next pointer step. */
let nextCursorSequence = 1
/**
 * Wait without blocking the main process.
 * @param ms - how long, in milliseconds.
 */
async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

/** An action's arguments, as the tool validated them. */
export type BrowserAutomationInput = { readonly [key: string]: unknown }

/**
 * Evaluate an expression in the guest's page (t3code `evaluateWithDebugger`).
 * @param guest - the guest whose debugger is attached.
 * @param expression - JavaScript evaluated in the page's main frame.
 * @returns the JSON value the expression produced.
 * @throws {Error} when the expression throws.
 */
async function evaluatePage(guest: WebContents, expression: string): Promise<unknown> {
  const response = await guest.debugger.sendCommand('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, userGesture: true,
  }) as { result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string }; text?: string } }
  if (response.exceptionDetails !== undefined) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'evaluation failed')
  }
  return response.result?.value
}

/** t3code `captureAutomationSnapshot`'s page expression. */
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
    return {
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role"),
      name: (element.getAttribute("aria-label") || element.innerText || element.getAttribute("name") || "").slice(0, ${String(MAX_INTERACTIVE_ELEMENT_NAME_LENGTH)}),
      selector: selectorFor(element),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      editable: element.isContentEditable || element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement,
      disabled: element.disabled === true
    };
  });
  return {
    url: location.href,
    title: document.title,
    loading: document.readyState !== "complete",
    visibleText: (document.body?.innerText || "").slice(0, ${String(MAX_VISIBLE_TEXT_LENGTH)}),
    interactiveElements: elements
  };
})()`

/**
 * Resolve a click target to a viewport point (t3code `resolveClickPoint`).
 * @param guest - the guest to act on.
 * @param input - `selector`, or `x` and `y`.
 * @param evaluate - lifetime-bound page evaluator.
 * @returns the target's centre, scrolled into view.
 * @throws {Error} when the selector matches nothing.
 */
async function resolveClickPoint(guest: WebContents, input: BrowserAutomationInput, evaluate: (guest: WebContents, expression: string) => Promise<unknown>): Promise<{ x: number; y: number }> {
  if (typeof input.selector !== 'string') return { x: Number(input.x), y: Number(input.y) }
  const point = await evaluate(guest, `(() => {
    const matches = document.querySelectorAll(${JSON.stringify(input.selector)});
    if (matches.length > 1) throw new Error("the click selector matches multiple elements");
    const element = matches[0];
    if (!element) return null;
    if (element.disabled || getComputedStyle(element).visibility === "hidden" || element.getClientRects().length === 0) throw new Error("the click target is hidden or disabled");
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    const clamp = (value, limit) => Math.min(Math.max(value, 0), limit);
    return { x: clamp(rect.left + rect.width / 2, innerWidth), y: clamp(rect.top + rect.height / 2, innerHeight) };
  })()`) as { x: number; y: number } | null
  if (point === null) throw new Error(`no element matches ${input.selector}; call preview_snapshot for current selectors`)
  return point
}

/**
 * Where the pointer shows an action on a target: its centre, or the viewport's
 * centre when the action has no target element.
 *
 * The target is scrolled into view and the point clamped to the viewport before
 * it is reported. A point measured from an element that is off screen is a page
 * coordinate wearing viewport clothes: reported as it stands, the pointer is
 * drawn outside the pane the reader is looking at.
 * @param guest - the guest to act on.
 * @param evaluate - lifetime-bound page evaluator.
 * @param target - page expression for the element, or `window`.
 * @returns viewport CSS coordinates, inside the viewport.
 */
async function centreOf(guest: WebContents, target: string, evaluate: (guest: WebContents, expression: string) => Promise<unknown>): Promise<{ x: number; y: number }> {
  return await evaluate(guest, `(() => {
    const element = ${target};
    const clamp = (value, limit) => Math.min(Math.max(value, 0), limit);
    if (!element || element === window) return { x: innerWidth / 2, y: innerHeight / 2 };
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    return { x: clamp(rect.left + rect.width / 2, innerWidth), y: clamp(rect.top + rect.height / 2, innerHeight) };
  })()`) as { x: number; y: number }
}

/**
 * Where a scroll with no named target starts its gesture: the pointer's own last position when it
 * is already inside the page, otherwise a deliberate entry just inside the page's top edge, at the
 * same horizontal position. A bare scroll never moves the pointer to the viewport's centre: that
 * leaves it parked in the middle of the page, unrelated to what the agent was doing.
 * @param guest - the guest to act on.
 * @param evaluate - lifetime-bound page evaluator.
 * @returns viewport CSS coordinates, inside the viewport.
 */
async function scrollOrigin(guest: WebContents, evaluate: (guest: WebContents, expression: string) => Promise<unknown>): Promise<{ x: number; y: number }> {
  const viewport = await evaluate(guest, '({ w: innerWidth, h: innerHeight })') as { w: number; h: number }
  const previous = pointerAt.get(guest)
  const x = previous === undefined ? viewport.w / 2 : Math.min(Math.max(previous.x, 0), viewport.w)
  if (pointerInPage.has(guest) && previous !== undefined) return previous
  return { x, y: SCROLL_ENTRY_INSET_PX }
}

/**
 * t3code `typeIntoAutomationTarget`'s page expression, up to the insertion:
 * focus the target and select what `clear` replaces. Clearing with no text
 * deletes the selection here, as there is nothing to type over it.
 */
function focusExpression(input: BrowserAutomationInput): string {
  const target = typeof input.selector === 'string'
    ? `document.querySelector(${JSON.stringify(input.selector)})`
    : 'document.activeElement'
  return `(() => {
    const element = ${target};
    if (!element) return { notFound: true };
    const textControl =
      element instanceof HTMLTextAreaElement ||
      (element instanceof HTMLInputElement &&
        !new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]).has(element.type));
    const editable = textControl || element.isContentEditable;
    if (!editable || element.disabled || element.readOnly) return { notEditable: true };
    element.focus();
    if (document.activeElement !== element) return { focusFailed: true };
    if (${String(input.clear === true)}) {
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
    if (${String(input.clear === true && String(input.text ?? '') === '')} && !document.execCommand("delete", false)) return { notEditable: true };
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
function press(guest: WebContents, input: BrowserAutomationInput): void {
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
 * Perform one agent action on a guest.
 * @param guest - the browser guest; its debugger is attached here when needed.
 * @param operation - browser operation named by the tool or pane.
 * @param input - the tool's arguments.
 * @param signal - execution lifetime supplied by the owning IPC request.
 * @returns the action's JSON result.
 * @throws {Error} when the operation is unknown or the page refuses the action.
 */
export async function automate(guest: WebContents, operation: string, input: BrowserAutomationInput, signal: AbortSignal = new AbortController().signal): Promise<unknown> {
  signal.throwIfAborted()
  if (!guest.debugger.isAttached()) guest.debugger.attach('1.3')
  const send = async (method: string, params?: object): Promise<unknown> => {
    signal.throwIfAborted()
    const result = await guest.debugger.sendCommand(method, params)
    signal.throwIfAborted()
    return result
  }
  const evaluate = async (target: WebContents, expression: string): Promise<unknown> => {
    signal.throwIfAborted()
    const result = await evaluatePage(target, expression)
    signal.throwIfAborted()
    return result
  }
  /** Draw one pointer step over the guest; returns its step number. */
  const show = (cursor: Omit<DesktopBrowserCursor, 'webContentsId' | 'sequence'>): number => {
    const sequence = nextCursorSequence++
    guest.hostWebContents?.send(DESKTOP_IPC.browserCursor, { webContentsId: guest.id, sequence, ...cursor } satisfies DesktopBrowserCursor)
    return sequence
  }
  /**
   * Announce the animated move and deliver hover input at its destination.
   */
  const moveTo = async (point: { x: number; y: number }): Promise<void> => {
    show({ action: 'move', ...point })
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'none', ...point })
    pointerAt.set(guest, point)
    pointerInPage.add(guest)
  }
  /**
   * The pointer has left the page for the pane's own chrome row.
   *
   * Its page position stops applying, so a later scroll enters the page deliberately at that
   * horizontal position instead of starting from a place the pointer is no longer at.
   */
  const leavePage = (): void => { pointerInPage.delete(guest) }
  switch (operation) {
    case 'upload': {
      const requested = input.paths
      if (!Array.isArray(requested) || requested.length === 0 || !requested.every(path => typeof path === 'string' && isAbsolute(path))) {
        throw new Error('upload requires absolute file paths on the computer running this browser')
      }
      const files = await Promise.all(requested.map(async path => {
        const canonical = await realpath(String(path))
        if (!(await stat(canonical)).isFile()) throw new Error(`not a regular file: ${basename(canonical)}`)
        return canonical
      }))
      signal.throwIfAborted()
      if (typeof input.origin !== 'string' || new URL(guest.getURL()).origin !== input.origin) throw new Error('the page origin changed; request upload approval again')
      let backendNodeId: number | undefined
      let multiple = false
      let chooserFrame: string | undefined
      let resolveChooser: (() => void) | undefined
      let rejectChooser: ((reason: unknown) => void) | undefined
      const chooser = new Promise<void>((resolve, reject) => { resolveChooser = resolve; rejectChooser = reject })
      void chooser.catch(() => { /* The action reports cancellation through its own signal checks. */ })
      const cancelChooser = (): void => { rejectChooser?.(signal.reason) }
      const opened = (_event: Electron.Event, method: string, params: unknown): void => {
        if (method !== 'Page.fileChooserOpened' || typeof params !== 'object' || params === null || !('backendNodeId' in params) || typeof params.backendNodeId !== 'number') return
        backendNodeId = params.backendNodeId
        chooserFrame = 'frameId' in params && typeof params.frameId === 'string' ? params.frameId : undefined
        multiple = 'mode' in params && params.mode === 'selectMultiple'
        resolveChooser?.()
      }
      guest.debugger.on('message', opened)
      try {
        await send('Page.enable')
        const frames = await send('Page.getFrameTree') as { frameTree: { frame: { id: string } } }
        const selector = typeof input.selector === 'string' ? input.selector : 'input[type=file]'
        const expression = `(() => {
          const nodes = document.querySelectorAll(${JSON.stringify(selector)});
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
            if (files.length > 1 && !multiple) throw new Error('the chooser does not accept multiple files')
          }
          if (new URL(guest.getURL()).origin !== input.origin) throw new Error('the page origin changed before upload')
          await send('DOM.setFileInputFiles', { backendNodeId, files })
          return { ok: true, files: files.map(file => basename(file)) }
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
      if (typeof input.selector !== 'string' || input.selector.length === 0) throw new Error('wait requires a selector')
      const timeoutMs = input.timeoutMs ?? 5000
      if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) throw new Error('wait timeout must be between 1 and 60000ms')
      if (input.state !== undefined && input.state !== 'visible' && input.state !== 'hidden') throw new Error('wait state must be visible or hidden')
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const ready = await evaluate(guest, `(() => {
          const nodes = document.querySelectorAll(${JSON.stringify(String(input.selector))});
          if (nodes.length > 1) throw new Error("the wait selector matches multiple elements");
          const element = nodes[0];
          const visible = !!element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
          if (${JSON.stringify(input.state ?? 'visible')} === "hidden") return !visible;
          return visible && !element.disabled;
        })()`)
        if (ready === true) return { ok: true }
        if (Date.now() >= deadline) throw new Error(`timed out waiting for ${String(input.selector)}`)
        await sleep(25)
        signal.throwIfAborted()
      }
    }
    case 'sequence': {
      if (!Array.isArray(input.actions) || input.actions.length === 0 || input.actions.length > 20) throw new Error('sequence requires 1 to 20 actions')
      for (const action of input.actions) {
        if (typeof action !== 'object' || action === null || Array.isArray(action) || !('operation' in action)) throw new Error('sequence actions must name an operation')
        const values = action as BrowserAutomationInput
        if (!['click', 'type', 'press', 'upload', 'wait'].includes(String(values.operation))) throw new Error('sequence supports click, type, press, upload, and wait')
        if ((values.operation === 'click' || values.operation === 'wait') && typeof values.selector !== 'string') throw new Error(`${String(values.operation)} requires a selector`)
        if (values.operation === 'type' && typeof values.text !== 'string') throw new Error('type requires text')
        if (values.operation === 'press' && typeof values.key !== 'string') throw new Error('press requires a key')
        if (values.operation === 'upload' && (!Array.isArray(values.paths) || values.paths.length === 0 || !values.paths.every(path => typeof path === 'string' && isAbsolute(path)))) throw new Error('upload requires absolute file paths')
      }
      let completed = 0
      for (const action of input.actions) {
        try {
          await automate(guest, String((action as BrowserAutomationInput).operation), action as BrowserAutomationInput, signal)
          completed++
        } catch (error) {
          signal.throwIfAborted()
          return { ok: false, completed, failedAction: completed + 1, error: error instanceof Error ? error.message : String(error) }
        }
      }
      return { ok: true, completed }
    }
    case 'snapshot':
      return evaluate(guest, SNAPSHOT)
    case 'click': {
      // Focus emulation lets native input reach a guest while the app composer holds focus.
      await send('Emulation.setFocusEmulationEnabled', { enabled: true })
      const point = await resolveClickPoint(guest, input, evaluate)
      await moveTo(point)
      show({ action: 'click', ...point, ...named(input) })
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
      return { ok: true }
    }
    case 'type': {
      const target = typeof input.selector === 'string' ? `document.querySelector(${JSON.stringify(input.selector)})` : 'document.activeElement'
      const point = await centreOf(guest, target, evaluate)
      await moveTo(point)
      show({ action: 'type', ...point, ...named(input) })
      await send('Emulation.setFocusEmulationEnabled', { enabled: true })
      const result = await evaluate(guest, focusExpression(input)) as { ok?: true; notFound?: true; notEditable?: true; focusFailed?: true }
      if (result.notFound === true) throw new Error('no element matches the target; call preview_snapshot for current selectors')
      if (result.notEditable === true) throw new Error('the target is disabled, read-only, or not editable')
      if (result.focusFailed === true) throw new Error('the target could not take focus')
      const text = String(input.text ?? '')
      const focused = await send('Runtime.evaluate', { expression: target, returnByValue: false }) as { result?: { objectId?: string } }
      const objectId = focused.result?.objectId
      if (objectId === undefined) throw new Error('the editor disappeared before text insertion')
      try {
        if (text !== '') await guest.insertText(text)
        const focus = await send('Runtime.callFunctionOn', {
          objectId, functionDeclaration: 'function(){return this === document.activeElement}', returnByValue: true,
        }) as { result?: { value?: boolean } }
        if (focus.result?.value !== true) throw new Error('focus moved away during text insertion; inspect the editor before continuing')
      } finally {
        if (guest.debugger.isAttached()) await guest.debugger.sendCommand('Runtime.releaseObject', { objectId })
      }
      signal.throwIfAborted()
      return { ok: true, characters: Array.from(text).length }

    }
    case 'press': {
      await send('Emulation.setFocusEmulationEnabled', { enabled: true })
      // A key lands in whatever holds focus, so the pointer shows that element
      // rather than staying where the last action left it.
      const point = await centreOf(guest, 'document.activeElement', evaluate)
      show({ action: 'type', ...point })
      press(guest, input)
      return { ok: true }
    }
    case 'scroll': {
      const target = typeof input.selector === 'string' ? `document.querySelector(${JSON.stringify(input.selector)})` : 'window'
      const deltaX = Number(input.deltaX ?? 0)
      const deltaY = Number(input.deltaY ?? 0)
      const point = typeof input.selector === 'string' ? await centreOf(guest, target, evaluate) : await scrollOrigin(guest, evaluate)
      // A scroll does not wait for the pointer to arrive: the pointer travels
      // with the gesture anyway, so waiting bought nothing and cost a
      // pointer-arrival timeout that stalled consecutive scrolls.
      // Every step of the gesture is announced as a scroll, so the pane knows the
      // pointer is placing itself rather than being left behind by a page that
      // moved: it re-aims a resting pointer, not one that is scrolling.
      show({ action: 'scroll', ...point, ...named(input) })
      const drift = Math.sign(deltaY) * Math.min(
        Math.max(Math.abs(deltaY) * SCROLL_DRIFT_RATIO, SCROLL_DRIFT_MIN_PX),
        SCROLL_DRIFT_MAX_PX,
      )
      // The page scrolls itself, eased over the gesture, so the movement is the
      // page's own rather than the shell stepping it from outside.
      const result = await evaluate(guest, `(() => {
        const target = ${target};
        if (!target) return { notFound: true };
        const scrolls = target === window ? document.scrollingElement ?? document.documentElement : target;
        const from = { left: scrolls.scrollLeft, top: scrolls.scrollTop };
        const started = performance.now();
        const step = () => {
          const progress = Math.min(1, (performance.now() - started) / ${String(SCROLL_DURATION_MS)});
          const eased = 1 - (1 - progress) ** 3;
          scrolls.scrollTo({ left: from.left + ${String(deltaX)} * eased, top: from.top + ${String(deltaY)} * eased, behavior: "instant" });
          if (progress < 1) requestAnimationFrame(step);
        };
        step();
        return { ok: true };
      })()`) as { ok?: true; notFound?: true }
      if (result.notFound === true) throw new Error('no element matches the target; call preview_snapshot for current selectors')
      // The pointer travels with the gesture, in the direction the content is
      // going, so a scroll reads as the pointer performing it.
      for (let step = 1; step <= SCROLL_POINTER_STEPS; step++) {
        const progress = 1 - (1 - step / SCROLL_POINTER_STEPS) ** 3
        show({ action: 'scroll', x: point.x, y: point.y + drift * progress, ...named(input) })
        await sleep(SCROLL_DURATION_MS / SCROLL_POINTER_STEPS)
      }
      // The gesture ends with the pointer where it stopped: a resting pointer's
      // next page scroll is re-aimed at its element, which a gesture in progress
      // would suppress. That resting point is also where the pointer is, so a
      // later target-less scroll starts its own gesture from there rather than
      // from the viewport's middle.
      show({ action: 'move', x: point.x, y: point.y + drift, ...named(input) })
      pointerAt.set(guest, { x: point.x, y: point.y + drift })
      pointerInPage.add(guest)
      return { ok: true }
    }
    case 'back':
    case 'forward':
    case 'reload':
    case 'capture': {
      // A chrome control sits in the pane's own chrome row, not in the page: the
      // pane knows where it is, animates the pointer onto it, and clicks it. No
      // guest input is dispatched here and there is no arrival to wait for, so
      // the coordinates carry no meaning for this action.
      leavePage()
      show({ action: 'control', control: operation === 'reload' ? 'refresh' : operation, x: 0, y: 0 })
      return { ok: true }
    }
    case 'navigate': {
      // The address field belongs to the pane's chrome row: the pane types the
      // address there, then loads it, exactly as the reader doing it by hand.
      leavePage()
      show({ action: 'control', control: 'navigate', url: String(input.url ?? ''), x: 0, y: 0 })
      return { ok: true }
    }
    case 'control': {
      // Any pane chrome control by name, so a new button needs no new operation.
      leavePage()
      show({ action: 'control', control: String(input.control ?? ''), x: 0, y: 0 })
      return { ok: true }
    }
    case 'evaluate': {
      const value = await evaluate(guest, String(input.expression))
      if (Buffer.byteLength(JSON.stringify(value ?? null), 'utf8') > MAX_EVALUATION_BYTES) {
        throw new Error(`the result is larger than ${String(MAX_EVALUATION_BYTES)} bytes`)
      }
      return { value: value ?? null }
    }
    default:
      throw new Error(`unknown browser operation ${operation}`)
  }
}
