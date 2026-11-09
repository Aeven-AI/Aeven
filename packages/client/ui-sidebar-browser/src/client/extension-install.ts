/**
 * The prompt that asks the reader of an Aeven web page to add the Aeven
 * extension when the agent needs their browser and the extension is missing.
 *
 * A tool call waits on the prompt while it is open: the page sees an extension
 * installed while it is open without a reload, so the call goes on as soon as
 * the extension greets. The wait ends before the tool's own deadline; the prompt
 * then stays open, and an install after that offers to continue the task with a
 * message. A browser that cannot run Chromium extensions gets an explanation and
 * the call fails at once.
 */

import { createSnapshotStore, type SnapshotStore } from '@aeven/client-store'
import { AEVEN_EXTENSION_IDS } from './extension-page.ts'

/** The Aeven extension's Chrome Web Store page. */
export const AEVEN_EXTENSION_STORE_URL = `https://chromewebstore.google.com/detail/aeven/${AEVEN_EXTENSION_IDS[0]}`

/** How often an open prompt checks whether the extension arrived, in ms. */
const CHECK_INTERVAL_MS = 1_000
/** How long before the tool's deadline a waiting call gives up, so its own answer reaches the model first, in ms. */
const DEADLINE_MARGIN_MS = 5_000
/** The shortest wait a call gets when its deadline is nearer than the margin, in ms. */
const MIN_WAIT_MS = 1_000

/** What the model is told when the reader declines adding the extension. */
const DECLINED = 'The user chose not to add the Aeven extension, so their browser is unavailable. Do not ask again in this turn; finish without the browser or say briefly what needs it, then end your turn.'
/** What the model is told when the reader has not finished adding the extension in time. */
const NOT_YET = 'The user has not finished adding the Aeven extension to their browser. End your turn now with one short sentence; once the extension is added, the user is offered to continue the task.'
/** What the model is told when the reader's browser cannot run the extension. */
const UNSUPPORTED = "The user's browser cannot run the Aeven extension: only Chrome, Edge, Brave, and other Chromium browsers on a computer can. No browser is available in this session. Tell the user to open Aeven in one of those browsers or to use the Aeven desktop app, and end your turn."

/** The prompt's state; one prompt serves the page. */
export type ExtensionPromptState =
  | { readonly kind: 'closed' }
  /** The extension is missing; `waiting` while a tool call waits for it. */
  | { readonly kind: 'install'; readonly sessionId: string; readonly waiting: boolean }
  /** The extension arrived after the waiting call gave up; continuing sends a message to the session. */
  | { readonly kind: 'connected'; readonly sessionId: string; readonly browser: string }
  /** This browser cannot run the extension. */
  | { readonly kind: 'unsupported'; readonly sessionId: string }

/** A tool call waiting for the extension. */
interface Waiter {
  resolve: () => void
  reject: (error: Error) => void
}

/** The browser this page runs in, as Chromium's client hints describe it. */
interface BrowserHints {
  readonly brands: ReadonlyArray<{ readonly brand: string }>
  readonly mobile: boolean
}

/** Brand names in the order the extension's own browser name prefers them, with the name the prompt shows. */
const BRANDS: ReadonlyArray<readonly [brand: string, shown: string]> = [
  ['Microsoft Edge', 'Edge'], ['Brave', 'Brave'], ['Opera', 'Opera'], ['Vivaldi', 'Vivaldi'], ['Google Chrome', 'Chrome'], ['Chromium', 'Chromium'],
]

/**
 * This page's browser hints; Firefox and Safari expose none.
 * @returns the hints, or undefined.
 */
function browserHints(): BrowserHints | undefined {
  return (navigator as Navigator & { userAgentData?: BrowserHints }).userAgentData
}

/**
 * Whether this page's browser can install the extension from the Chrome Web Store:
 * a Chromium browser on a computer.
 * @returns true when it can.
 */
export function canInstallExtension(): boolean {
  const hints = browserHints()
  return hints !== undefined && !hints.mobile && hints.brands.some(entry => entry.brand === 'Chromium')
}

/**
 * The short name of this page's browser, for the install button.
 * @returns the name, or undefined when the browser does not say.
 */
export function browserLabel(): string | undefined {
  const brands = browserHints()?.brands.map(entry => entry.brand) ?? []
  return BRANDS.find(([brand]) => brands.includes(brand))?.[1]
}

/** The page's extension prompt and the tool calls waiting on it. */
export class ExtensionPrompt {
  readonly state: SnapshotStore<ExtensionPromptState> = createSnapshotStore<ExtensionPromptState>({ kind: 'closed' })
  readonly #connected: () => Promise<ReadonlyArray<{ readonly browser: string }>>
  readonly #waiters = new Set<Waiter>()
  #timer: ReturnType<typeof setInterval> | undefined
  #checking = false

  /**
   * @param connected - the browsers the extension is connected in now; empty when none is.
   */
  constructor(connected: () => Promise<ReadonlyArray<{ readonly browser: string }>>) {
    this.#connected = connected
  }

  /**
   * Resolve once the extension is connected, asking the reader to add it when it is missing.
   * @param sessionId - the session whose agent needs the browser.
   * @param signal - the agent's wait; aborting it withdraws the prompt.
   * @param timeoutMs - the tool's deadline, from which the wait's own end is derived; absent waits until the signal or the reader ends it.
   * @returns once the extension greets.
   * @throws {Error} when the browser cannot run the extension, the reader declines, the wait ends first, or the signal aborts.
   */
  async require(sessionId: string, signal: AbortSignal | undefined, timeoutMs: number | undefined): Promise<void> {
    if ((await this.#connected()).length > 0) return
    signal?.throwIfAborted()
    if (!canInstallExtension()) {
      this.state.set({ kind: 'unsupported', sessionId })
      throw new Error(UNSUPPORTED)
    }
    this.state.set({ kind: 'install', sessionId, waiting: true })
    this.#watch()
    await new Promise<void>((resolve, reject) => {
      const wait = timeoutMs === undefined ? undefined : Math.max(timeoutMs - DEADLINE_MARGIN_MS, MIN_WAIT_MS)
      const giveUp = wait === undefined ? undefined : setTimeout(() => { settle(new Error(NOT_YET)) }, wait)
      const abort = (): void => {
        settle(signal?.reason instanceof Error ? signal.reason : new Error('the agent stopped waiting for the Aeven extension'))
      }
      const settle = (error?: Error): void => {
        clearTimeout(giveUp)
        signal?.removeEventListener('abort', abort)
        this.#waiters.delete(waiter)
        if (error === undefined) resolve()
        else reject(error)
        if (error !== undefined && this.#waiters.size === 0) this.#stopWaiting(error.message === NOT_YET)
      }
      const waiter: Waiter = { resolve: () => { settle() }, reject: (error) => { settle(error) } }
      this.#waiters.add(waiter)
      signal?.addEventListener('abort', abort, { once: true })
    })
  }

  /** The reader declined or closed the prompt: waiting calls fail and the prompt closes. */
  dismiss(): void {
    for (const waiter of [...this.#waiters]) waiter.reject(new Error(DECLINED))
    this.#close()
  }

  /**
   * Check now, as when the reader returns to the page after installing.
   */
  check(): void {
    if (this.#timer === undefined || this.#checking) return
    this.#checking = true
    void this.#connected().then((browsers) => {
      const [first] = browsers
      if (first !== undefined) this.#arrived(first.browser)
    }, () => undefined).finally(() => { this.#checking = false })
  }

  /** Close the prompt and stop checking. */
  close(): void {
    this.#close()
  }

  #watch(): void {
    if (this.#timer !== undefined) return
    this.#timer = setInterval(() => { this.check() }, CHECK_INTERVAL_MS)
  }

  /**
   * The last waiting call ended without the extension: a call that ran out of time leaves the prompt open, any other end closes it.
   * @param keepOpen - whether the reader may still be installing.
   */
  #stopWaiting(keepOpen: boolean): void {
    const state = this.state.getSnapshot()
    if (state.kind !== 'install') return
    if (keepOpen) this.state.set({ ...state, waiting: false })
    else this.#close()
  }

  #arrived(browser: string): void {
    const state = this.state.getSnapshot()
    if (state.kind !== 'install') return
    clearInterval(this.#timer)
    this.#timer = undefined
    if (this.#waiters.size > 0) {
      for (const waiter of [...this.#waiters]) waiter.resolve()
      this.state.set({ kind: 'closed' })
    } else {
      this.state.set({ kind: 'connected', sessionId: state.sessionId, browser })
    }
  }

  #close(): void {
    clearInterval(this.#timer)
    this.#timer = undefined
    this.state.set({ kind: 'closed' })
  }
}
