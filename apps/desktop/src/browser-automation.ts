/**
 * Agent actions on a right sidebar browser guest, ported from t3code's preview
 * automation (`apps/desktop/src/preview/Manager.ts`, `PreviewKeyboard.ts`).
 *
 * Reading and editing run in the page over the guest's CDP debugger; clicks are
 * CDP mouse input at the target's centre. Keys are native input events on the
 * guest itself, because CDP keyboard dispatch follows the embedder's focused
 * renderer and could land in the app's own composer.
 *
 * Each pointer action is shown by the agent pointer, which the app window draws
 * over the guest as ChatGPT's in-app browser does
 * (`browser-sidebar-browser-use-cursor-state`): it survives the guest's
 * navigations. As there, a pointer action is a move the window acknowledges
 * (`browser-use-cursor-arrived`) followed by the input, so the input lands where
 * the pointer visibly is. While the pointer glides, the page receives mouse
 * moves along its path, and typed text arrives a character at a time.
 */

import type { WebContents } from 'electron'
import { DESKTOP_IPC, type DesktopBrowserCursor } from './ipc.ts'

/** Interactive elements a snapshot lists (t3code `MAX_INTERACTIVE_ELEMENTS`). */
const MAX_INTERACTIVE_ELEMENTS = 200
/** Characters kept of each element's name. */
const MAX_INTERACTIVE_ELEMENT_NAME_LENGTH = 120
/** Characters kept of the page's visible text. */
const MAX_VISIBLE_TEXT_LENGTH = 40_000
/** Bytes an evaluated value may serialize to (t3code `MAX_EVALUATION_BYTES`). */
const MAX_EVALUATION_BYTES = 64_000
/** Longest an action waits for the window to report the pointer arrived, in ms. */
const CURSOR_ARRIVAL_TIMEOUT_MS = 1500
/**
 * How long the page's mouse moves take on a short and a long glide, in ms: the
 * overlay's own travel estimates (browser-overlay `CursorMotion.travelTo`).
 */
const HOVER_SHORT_MS = 420
const HOVER_LONG_MS = 700
/**
 * The element an action named, as payload fields, or nothing when it named none.
 * @param input - the tool's arguments.
 * @returns the fields to spread into a cursor payload.
 */
function named(input: BrowserAutomationInput): { selector?: string } {
  return typeof input.selector === 'string' ? { selector: input.selector } : {}
}

/** Glide length from which the overlay arcs, in CSS pixels (browser-overlay `LONG_MOVE_PX`). */
const HOVER_LONG_PX = 196
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
/** Mouse moves dispatched along one glide. */
const HOVER_STEPS = 12
/** Pause between typed characters, in ms. */
const TYPE_CHARACTER_MS = 45
/** Longest one typed string takes; longer text types in larger pieces, in ms. */
const TYPE_MAX_MS = 3000
/** Most insertions one typed string is split into. */
const TYPE_MAX_STEPS = 200

/** Where the pointer last arrived in each guest, in its viewport CSS pixels. */
const pointerAt = new WeakMap<WebContents, { x: number; y: number }>()
/**
 * Guests whose pointer is currently drawn inside the page. A chrome action leaves the pointer on
 * the pane's own controls, where its page coordinates mean nothing: without this, a later scroll
 * would start from a stale in-page point and the pointer would jump out of the chrome row.
 */
const pointerInPage = new WeakSet<WebContents>()
/** Number of the next pointer step; `move` arrivals are matched by it. */
let nextCursorSequence = 1
/** Pending `move` arrivals, keyed by guest id and step number. */
const arrivalWaiters = new Map<string, () => void>()

/**
 * Resolve a pointer move the window reports as finished.
 * @param webContentsId - the guest the move was drawn over.
 * @param sequence - the move's step number.
 */
export function notifyCursorArrived(webContentsId: number, sequence: number): void {
  arrivalWaiters.get(`${String(webContentsId)}:${String(sequence)}`)?.()
}

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
async function evaluate(guest: WebContents, expression: string): Promise<unknown> {
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
    "a[href],button,input,textarea,select,[role],[tabindex]"
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
      height: rect.height
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
 * @returns the target's centre, scrolled into view.
 * @throws {Error} when the selector matches nothing.
 */
async function resolveClickPoint(guest: WebContents, input: BrowserAutomationInput): Promise<{ x: number; y: number }> {
  if (typeof input.selector !== 'string') return { x: Number(input.x), y: Number(input.y) }
  const point = await evaluate(guest, `(() => {
    const element = document.querySelector(${JSON.stringify(input.selector)});
    if (!element) return null;
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
 * @param target - page expression for the element, or `window`.
 * @returns viewport CSS coordinates, inside the viewport.
 */
async function centreOf(guest: WebContents, target: string): Promise<{ x: number; y: number }> {
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
 * @returns viewport CSS coordinates, inside the viewport.
 */
async function scrollOrigin(guest: WebContents): Promise<{ x: number; y: number }> {
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
    if (document.activeElement !== element) return { notEditable: true };
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
    if (${String(String(input.text ?? '') === '')} && !document.execCommand("delete", false)) return { notEditable: true };
    return { ok: true };
  })()`
}

/**
 * Split text into the pieces typed one after another: single characters, or
 * larger pieces when the text would otherwise take more than
 * {@link TYPE_MAX_STEPS} insertions.
 * @param text - the text to type.
 * @returns the pieces, in order, never splitting a code point.
 */
function typingPieces(text: string): string[] {
  const characters = Array.from(text)
  const size = Math.max(1, Math.ceil(characters.length / TYPE_MAX_STEPS))
  const pieces: string[] = []
  for (let at = 0; at < characters.length; at += size) pieces.push(characters.slice(at, at + size).join(''))
  return pieces
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
 * @param operation - `snapshot`, `click`, `type`, `press`, `scroll`, or `evaluate`.
 * @param input - the tool's arguments.
 * @returns the action's JSON result.
 * @throws {Error} when the operation is unknown or the page refuses the action.
 */
export async function automate(guest: WebContents, operation: string, input: BrowserAutomationInput): Promise<unknown> {
  if (!guest.debugger.isAttached()) guest.debugger.attach('1.3')
  const send = (method: string, params?: object) => guest.debugger.sendCommand(method, params)
  /** Draw one pointer step over the guest; returns its step number. */
  const show = (cursor: Omit<DesktopBrowserCursor, 'webContentsId' | 'sequence'>): number => {
    const sequence = nextCursorSequence++
    guest.hostWebContents?.send(DESKTOP_IPC.browserCursor, { webContentsId: guest.id, sequence, ...cursor } satisfies DesktopBrowserCursor)
    return sequence
  }
  /**
   * Glide the pointer to a point and wait until the window reports it there.
   * The page receives mouse moves along the way, so hover states follow it.
   */
  const moveTo = async (point: { x: number; y: number }): Promise<void> => {
    const from = pointerAt.get(guest) ?? point
    const sequence = show({ action: 'move', ...point })
    const key = `${String(guest.id)}:${String(sequence)}`
    // Only a guest with a host renderer has a window to draw the pointer, and so
    // a report to wait for. Waiting anyway would be waiting for a report that
    // cannot arrive.
    const arrived = guest.hostWebContents === null ? Promise.resolve() : new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        arrivalWaiters.delete(key)
        resolve()
      }
      const timer = setTimeout(done, CURSOR_ARRIVAL_TIMEOUT_MS)
      arrivalWaiters.set(key, done)
    })
    const duration = Math.hypot(point.x - from.x, point.y - from.y) >= HOVER_LONG_PX ? HOVER_LONG_MS : HOVER_SHORT_MS
    for (let step = 1; step <= HOVER_STEPS; step++) {
      // Ease out, as the pointer's spring decelerates into its target.
      const progress = 1 - (1 - step / HOVER_STEPS) ** 3
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', button: 'none',
        x: from.x + (point.x - from.x) * progress, y: from.y + (point.y - from.y) * progress,
      })
      await sleep(duration / HOVER_STEPS)
    }
    await arrived
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
    case 'snapshot':
      return evaluate(guest, SNAPSHOT)
    case 'click': {
      // ChatGPT's in-app browser enables focus emulation before every `Input.*`
      // command, so input reaches a guest the window has not focused.
      await send('Emulation.setFocusEmulationEnabled', { enabled: true })
      const point = await resolveClickPoint(guest, input)
      await moveTo(point)
      show({ action: 'click', ...point, ...named(input) })
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
      return { ok: true }
    }
    case 'type': {
      const target = typeof input.selector === 'string' ? `document.querySelector(${JSON.stringify(input.selector)})` : 'document.activeElement'
      const point = await centreOf(guest, target)
      await moveTo(point)
      show({ action: 'type', ...point, ...named(input) })
      const result = await evaluate(guest, focusExpression(input)) as { ok?: true; notFound?: true; notEditable?: true }
      if (result.notFound === true) throw new Error('no element matches the target; call preview_snapshot for current selectors')
      if (result.notEditable === true) throw new Error('the target is not an editable element')
      const pieces = typingPieces(String(input.text ?? ''))
      const pause = Math.min(TYPE_CHARACTER_MS, TYPE_MAX_MS / Math.max(1, pieces.length))
      for (const piece of pieces) {
        const inserted = await evaluate(guest, `document.execCommand("insertText", false, ${JSON.stringify(piece)})`)
        if (inserted !== true) throw new Error('the target is not an editable element')
        await sleep(pause)
      }
      await evaluate(guest, 'document.activeElement?.dispatchEvent(new Event("change", { bubbles: true })), true')
      return { ok: true }
    }
    case 'press': {
      await send('Emulation.setFocusEmulationEnabled', { enabled: true })
      // A key lands in whatever holds focus, so the pointer shows that element
      // rather than staying where the last action left it.
      const point = await centreOf(guest, 'document.activeElement')
      show({ action: 'type', ...point })
      press(guest, input)
      return { ok: true }
    }
    case 'scroll': {
      const target = typeof input.selector === 'string' ? `document.querySelector(${JSON.stringify(input.selector)})` : 'window'
      const deltaX = Number(input.deltaX ?? 0)
      const deltaY = Number(input.deltaY ?? 0)
      const point = typeof input.selector === 'string' ? await centreOf(guest, target) : await scrollOrigin(guest)
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
