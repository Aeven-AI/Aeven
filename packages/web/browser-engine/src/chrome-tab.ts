/**
 * A browser tab reached over one CDP session, as an engine target: Chrome over
 * its debugging connection, or any Chromium through the Aeven extension's
 * `chrome.debugger`. The agent pointer is the overlay, injected into the page.
 */

import { observePage, type BrowserTarget, type CursorStep } from './engine.ts'

/** How long a navigation the agent starts is given to load, in ms (ChatGPT `navigate_tab_*` default). */
const NAVIGATE_TIMEOUT_MS = 10_000

/** CDP modifier bits for key events. */
const MODIFIER_BITS = { alt: 1, control: 2, meta: 4, shift: 8 } as const

/** Named keys the engine sends, as CDP key fields. */
const NAMED_KEYS: Readonly<Record<string, { key: string; code: string; keyCode: number }>> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13 }, Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 }, Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 }, Insert: { key: 'Insert', code: 'Insert', keyCode: 45 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 }, End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 }, PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  Up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 }, Down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  Left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 }, Right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  ' ': { key: ' ', code: 'Space', keyCode: 32 },
}

/** CDP fields of one key the engine names. */
function keyFields(name: string): { key: string; code: string; windowsVirtualKeyCode: number } {
  const named = NAMED_KEYS[name]
  if (named !== undefined) return { key: named.key, code: named.code, windowsVirtualKeyCode: named.keyCode }
  const upper = name.toUpperCase()
  const code = /^[A-Z]$/.test(upper) ? `Key${upper}` : /^\d$/.test(name) ? `Digit${name}` : ''
  return { key: name, code, windowsVirtualKeyCode: name.length === 1 ? upper.charCodeAt(0) : 0 }
}

/** A listener of a target's CDP events, as the engine registers it. */
type CdpListener = Parameters<BrowserTarget['debugger']['on']>[1]

/** How a tab target reaches its page: one CDP session, through a debugging connection or the extension. */
export interface TabChannel {
  /** Send one CDP command to the tab. */
  send(method: string, params: object): Promise<unknown>
  /** Observe the tab's CDP events; returns the disposer. */
  subscribe(listener: (method: string, params: unknown) => void): () => void
  /** Whether the channel still reaches the tab. */
  isOpen(): boolean
}

/** A Chrome tab as an engine target. */
export class ChromeTab implements BrowserTarget {
  readonly id: string
  readonly #channel: TabChannel
  #url: string
  #title: string
  #detached = false
  #overlayReady = false
  readonly #listeners = new Map<CdpListener, () => void>()
  readonly #overlayScript: string
  readonly #unsubscribe: () => void

  /**
   * @param channel - the tab's CDP session.
   * @param id - the id the agent's tab commands name it by.
   * @param url - its address now.
   * @param title - its title now.
   * @param overlayScript - the agent pointer as a classic page script (the overlay package's IIFE bundle).
   */
  constructor(channel: TabChannel, id: string, url: string, title: string, overlayScript: string) {
    this.id = id
    this.#overlayScript = overlayScript
    this.#channel = channel
    this.#url = url
    this.#title = title
    this.#unsubscribe = channel.subscribe((method, params) => {
      if (method === 'Page.frameNavigated' && (params as { frame?: { parentId?: string } }).frame?.parentId === undefined) this.#overlayReady = false
    })
  }

  /**
   * Record the tab's address and title as its browser reports them.
   * @param url - the address.
   * @param title - the title.
   */
  setInfo(url: string, title: string): void {
    this.#url = url
    this.#title = title
  }

  /** Mark the tab unreachable once its debugger detached, and stop listening to its events. */
  markDetached(): void {
    this.#detached = true
    this.#unsubscribe()
    for (const unsubscribe of this.#listeners.values()) unsubscribe()
    this.#listeners.clear()
  }

  readonly debugger = {
    attach: (): void => {},
    isAttached: (): boolean => !this.#detached && this.#channel.isOpen(),
    sendCommand: async (method: string, params?: object) => await this.#channel.send(method, params ?? {}),
    on: (_event: 'message', listener: CdpListener): void => {
      this.#listeners.set(listener, this.#channel.subscribe((method, params) => { listener(undefined, method, params) }))
    },
    off: (_event: 'message', listener: CdpListener): void => {
      this.#listeners.get(listener)?.()
      this.#listeners.delete(listener)
    },
  }

  readonly session = {
    // A request with the tab's cookies runs in the page, which holds them.
    fetch: async (input: string, init?: { signal?: AbortSignal }): Promise<Response> => {
      init?.signal?.throwIfAborted()
      const reply = await this.debugger.sendCommand('Runtime.evaluate', {
        expression: `(async () => {
          const response = await fetch(${JSON.stringify(input)}, { credentials: "include" });
          const bytes = new Uint8Array(await response.arrayBuffer());
          let binary = "";
          for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
          return { status: response.status, type: response.headers.get("content-type") ?? "", data: btoa(binary) };
        })()`,
        awaitPromise: true, returnByValue: true,
      }) as { result?: { value?: { status: number; type: string; data: string } }; exceptionDetails?: { text?: string } }
      const value = reply.result?.value
      if (value === undefined) throw new Error(reply.exceptionDetails?.text ?? 'the page could not fetch the document')
      return new Response(Uint8Array.from(atob(value.data), character => character.charCodeAt(0)), { status: value.status, headers: { 'content-type': value.type } })
    },
  }

  getURL(): string { return this.#url }
  getTitle(): string { return this.#title }

  async insertText(text: string): Promise<void> {
    await this.debugger.sendCommand('Input.insertText', { text })
  }

  /**
   * Send one key event, as Electron's `sendInputEvent` takes it, through CDP.
   * @param input - the event: down, char, or up, with the key and its modifiers.
   */
  sendInputEvent(input: { type: 'keyDown' | 'char' | 'keyUp'; keyCode: string; modifiers?: Array<'alt' | 'control' | 'meta' | 'shift'> }): void {
    const modifiers = (input.modifiers ?? []).reduce((bits, name) => bits | MODIFIER_BITS[name], 0)
    const params = input.type === 'char'
      ? { type: 'char', text: input.keyCode, unmodifiedText: input.keyCode, modifiers }
      : { type: input.type === 'keyDown' ? 'rawKeyDown' : 'keyUp', ...keyFields(input.keyCode), modifiers }
    // Commands on one connection run in order, so the key's down, char, and up stay ordered.
    void this.debugger.sendCommand('Input.dispatchKeyEvent', params).catch(() => undefined)
  }

  emit(): boolean { return false }

  /** Put the overlay into the tab's page once per document, drawing the pointer alone. */
  async #overlay(): Promise<void> {
    if (this.#overlayReady) return
    await this.debugger.sendCommand('Runtime.evaluate', {
      expression: `if (!window.__aevenOverlay) { ${this.#overlayScript} } window.__aevenOverlay?.attach({ decorations: false }); true`,
      returnByValue: true,
    })
    this.#overlayReady = true
  }

  async presentCursor(step: CursorStep, wait: boolean, timeoutMs: number, signal: AbortSignal): Promise<void> {
    const point = JSON.stringify({ x: step.x, y: step.y })
    const call = step.action === 'move' ? `moveTo(${point})`
      : step.action === 'click' ? `click(${point})`
        : step.action === 'type' ? `type(${point})`
          : step.action === 'scroll' ? `scroll(${point})`
            : step.action === 'cancel' ? 'hide({ immediate: true })'
              : undefined
    if (call === undefined) return
    await this.#overlay()
    // As ChatGPT's agent does, a tab nobody can see gets no pointer to wait for:
    // a background tab barely animates, so every wait would run to its cap.
    const drawn = await this.debugger.sendCommand('Runtime.evaluate', {
      expression: `document.visibilityState === "visible" ? (window.__aevenOverlay?.${call}, true) : false`, returnByValue: true,
    }) as { result?: { value?: boolean } }
    if (!wait || drawn.result?.value !== true) return
    await Promise.race([
      this.debugger.sendCommand('Runtime.evaluate', { expression: 'window.__aevenOverlay?.arrived()', awaitPromise: true, returnByValue: true }),
      new Promise((resolve) => { setTimeout(resolve, timeoutMs) }),
      new Promise((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason as Error)
        else signal.addEventListener('abort', () => { reject(signal.reason as Error) }, { once: true })
      }),
    ])
  }

  async navigate(operation: 'navigate' | 'back' | 'forward' | 'reload', url: string, signal: AbortSignal): Promise<void> {
    let finish: () => void = () => {}
    const loaded = new Promise<void>((resolve) => {
      const timer = setTimeout(() => { finish() }, NAVIGATE_TIMEOUT_MS)
      const listener = (_event: unknown, method: string): void => {
        if (method === 'Page.loadEventFired' || method === 'Page.navigatedWithinDocument') finish()
      }
      finish = (): void => {
        clearTimeout(timer)
        this.debugger.off('message', listener)
        signal.removeEventListener('abort', finish)
        resolve()
      }
      this.debugger.on('message', listener)
      signal.addEventListener('abort', finish, { once: true })
    })
    try {
      if (operation === 'navigate') {
        const address = /^[a-z][a-z\d+.-]*:/i.test(url) ? url : `https://${url}`
        const result = await this.debugger.sendCommand('Page.navigate', { url: address }) as { errorText?: string }
        if (result.errorText !== undefined && result.errorText !== '') throw new Error(`the page did not load: ${result.errorText}`)
      } else if (operation === 'reload') {
        await this.debugger.sendCommand('Page.reload', {})
      } else {
        const history = await this.debugger.sendCommand('Page.getNavigationHistory') as { currentIndex: number; entries: Array<{ id: number }> }
        const entry = history.entries[history.currentIndex + (operation === 'back' ? -1 : 1)]
        if (entry === undefined) throw new Error(`cannot go ${operation}: no ${operation === 'back' ? 'previous' : 'next'} page in history`)
        await this.debugger.sendCommand('Page.navigateToHistoryEntry', { entryId: entry.id })
      }
    } catch (error) {
      finish()
      throw error
    }
    await loaded
    signal.throwIfAborted()
  }
}

/**
 * Make a newly attached tab ready for the engine: the domains its events come
 * from, and the overlay installed in every document it opens.
 * @param tab - the attached tab.
 * @param overlayScript - the agent pointer as a classic page script.
 */
export async function prepareTab(tab: ChromeTab, overlayScript: string): Promise<void> {
  // Dialogs, console output, and navigation events come from these domains.
  await tab.debugger.sendCommand('Page.enable')
  await tab.debugger.sendCommand('Runtime.enable')
  // The script installs the overlay once the document can hold it; the pointer's first step
  // switches it to drawing the pointer alone.
  await tab.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: overlayScript })
  observePage(tab)
}

