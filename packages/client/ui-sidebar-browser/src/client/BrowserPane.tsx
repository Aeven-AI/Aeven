/**
 * The right sidebar's browser: t3code's chrome row over an Electron
 * `<webview>` guest that holds the visited page.
 *
 * The guest is the only surface that can show a cross-origin page and still be
 * read: an iframe is refused by `X-Frame-Options` and cannot be inspected
 * across origins. Its storage partition is per Aeven account, so signing in to a
 * site once carries into every session, and the shell refuses to attach a guest
 * naming any other partition (desktop `browser-guests.ts`).
 *
 * The selection keys this pane by session, so a session switch mounts a fresh
 * guest, reopened at the address that session's guest last showed.
 * The tag exists only in the desktop shell, so the plugin registers this pane
 * only there (index.ts) and a browser tab never lists the kind at all.
 */
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { BrowserOverlay } from '@aeven/experimental-browser-overlay/src/overlay.ts'
import { acquireColumnPointer } from '@aeven/experimental-browser-overlay/src/column-pointer.ts'
import { IconWarningOutline16, Toast } from '@aeven/client-ui-primitives'
import type { TranslateNS } from '@aeven/client-locale/client'
import { ChromeRow } from './ChromeRow.tsx'
import {
  browserPartition, desktopBrowser, liveGuests, livePaneCursors, onPointerHold, readColorScheme, readLastUrl, webContentsIdOf,
  writeColorScheme, writeLastUrl, PANE_CONTROLS, type BrowserColorScheme, type BrowserGuest, type PaneControl, type PaneCursorPresentation,
} from './guest.ts'
import { SEARCH_PLACEHOLDER_KEYS } from './locales.ts'
import type { SearchEnginePreference } from './search-engine.ts'
import { MoreMenu } from './MoreMenu.tsx'
import { HandoffModal } from './HandoffModal.tsx'
import { recordTitle, recordVisit, searchHistory } from './history.ts'
import { centreOf, leftOf, type AimBox } from './aim.ts'
import { parseSuggestions } from '../search-engines.ts'
import { resolveTarget } from './url.ts'
import css from './BrowserPane.module.css'

/** Chromium's zoom levels, which the zoom controls step through. */
const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]

/** How long the capture control shows its check after a copied screenshot, in ms. */
const CAPTURED_FEEDBACK_MS = 1500

/**
 * How many completions the field offers. The card states its own height from
 * the rows it holds, so an engine answering with more than this is cut off
 * rather than scrolled: a scroll container would draw a bar over the page.
 */
const SUGGESTION_LIMIT = 7

/**
 * How long typing must pause before the pane asks the engine for completions,
 * in ms. One request per pause rather than one per keystroke keeps the engine's
 * rate limit off a fast typist.
 */
const SUGGEST_DEBOUNCE_MS = 120

/**
 * How long the agent pointer stays after its last action before it fades, in
 * ms. The pointer outlives the turn that moved it — the reader who just watched
 * it work is still looking at the page — so no activity for this long is what
 * ends its stay; closing the column ends it at once.
 */
const CURSOR_IDLE_HIDE_MS = 30_000
/** Visited pages the address bar's suggestions lead with. */
const HISTORY_SUGGESTION_LIMIT = 3
/** How long a pointer gesture through the three-dot menu waits for a row to render, in ms. */
const MENU_WAIT_MS = 1500
/** Three-dot menu rows by control, as their labels read. */
const MENU_ROW_KEYS = {
  'hard-reload': 'menu.hardReload',
  'devtools': 'menu.devtools',
  'clear-cache': 'menu.clearCache',
  'clear-cookies': 'menu.clearCookies',
} as const

/**
 * How long the layout is left to settle before the pointer is re-projected onto
 * its element, in ms. A drag and a page scroll both report per frame, and
 * re-placing the pointer per report would read layout and restart its glide for
 * every one of them.
 */
const PROJECT_SETTLE_MS = 120
/**
 * How often a moving layout projects the pointer back onto its element, in ms.
 * The throttled pass keeps the pointer on the element while the layout moves, and
 * the settle pass after it stops lands it exactly.
 */
const PROJECT_THROTTLE_MS = 50

/** Where in the address field the typed address begins, from its left edge, in CSS pixels. */
const ADDRESS_TEXT_INSET_PX = 14
/** Reference sprite geometry anchors the cursor tip at the reported coordinate. */
const CURSOR_TIP_OFFSET_PX = 0

/** How long the capture banner holds before it fades, in ms. */
const CAPTURE_TOAST_HOLD_MS = 1500

/** Navigation state the toolbar reads from the guest. */
interface GuestState {
  readonly url: string
  readonly loading: boolean
  readonly canGoBack: boolean
  readonly canGoForward: boolean
}

/** Props of the browser pane. */
export interface BrowserPaneProps {
  /** Session whose storage partition and last address the guest uses. */
  readonly sessionId: string
  /** The tab's pill id, under which its address is remembered and the agent names it. */
  readonly tabId: string
  /** Whether this tab's pill is shown, which makes it the session's current tab. */
  readonly active: boolean
  /** Close this tab's pill. */
  readonly closeTab: () => void
  /** Translate function bound to the `sidebarBrowser` dictionary. */
  readonly t: TranslateNS<'sidebarBrowser'>
  /** Open an address in the Host's Chrome, the profile the agent's DevTools tools drive. */
  readonly openInChrome: (sessionId: string, url: string) => void
  /** Whether the pane is on screen; the agent pointer draws only then and leaves the moment it is not. */
  readonly visible: boolean
  /** The reader's search engine: what a query searches with, and where completions come from. */
  readonly search: SearchEnginePreference
}

/**
 * Render one browser tab of a session.
 * @param props - see {@link BrowserPaneProps}.
 * @returns the browser element tree.
 */
export function BrowserPane({ sessionId, tabId, active, closeTab, t, openInChrome, visible, search }: BrowserPaneProps): ReactNode {
  const guestRef = useRef<BrowserGuest | null>(null)
  // The column hands a fresh callback each render; the guest's registration reads the latest.
  const closeTabRef = useRef(closeTab)
  closeTabRef.current = closeTab
  const rootRef = useRef<HTMLDivElement | null>(null)
  /** Whether the agent is working, which holds the pointer on screen. */
  const holdRef = useRef(false)
  /** Selector of the element the pointer is on, when the last action named one. */
  const anchorRef = useRef<string | undefined>(undefined)
  /** The address field, so the pointer can be shown typing into it. */
  const addressRef = useRef<HTMLInputElement | null>(null)
  const [state, setState] = useState<GuestState>({ url: '', loading: false, canGoBack: false, canGoForward: false })
  const [typingUrl, setTypingUrl] = useState<string | undefined>()
  useEffect(() => { setTypingUrl(undefined) }, [state.url, state.loading])
  const [suggestions, setSuggestions] = useState<readonly string[]>([])
  const engine = useSyncExternalStore(
    listener => search.engine.subscribe(listener),
    () => search.engine.getSnapshot(),
  )
  const [zoomFactor, setZoomFactor] = useState(1)
  const zoomRef = useRef(1)
  zoomRef.current = zoomFactor
  const [colorScheme, setColorScheme] = useState<BrowserColorScheme>(() => readColorScheme(sessionId) ?? 'system')
  const [captured, setCaptured] = useState(false)
  // Keyed by sequence so a second capture restarts the banner rather than
  // extending the first.
  const [captureToast, setCaptureToast] = useState<{ readonly seq: number; readonly ok: boolean } | null>(null)
  const captureSeq = useRef(0)
  const closeCaptureToast = useCallback(() => { setCaptureToast(null) }, [])

  // The appearance the guest is shown with: the shell emulates
  // `prefers-color-scheme` on that guest's web contents, so the choice is applied
  // there and re-applied whenever a guest attaches — it does not survive one.
  const schemeRef = useRef(colorScheme)
  schemeRef.current = colorScheme
  const applyScheme = useCallback((scheme: BrowserColorScheme) => {
    const guest = guestRef.current
    const bridge = desktopBrowser()
    const id = guest === null ? undefined : webContentsIdOf(guest)
    if (id === undefined || bridge === undefined) return
    bridge.setColorScheme(id, scheme).catch((error: unknown) => {
      console.error('ui-sidebar-browser: appearance failed', error)
    })
  }, [])

  // The guest owns its own history, so the toolbar reads that rather than
  // tracking navigations of its own: a page can move without the address bar.
  useEffect(() => {
    const guest = guestRef.current
    if (guest === null) return
    const sync = (loading: boolean) => () => {
      const url = guest.getURL()
      const shown = url === 'about:blank' ? '' : url
      setState({ url: shown, loading, canGoBack: guest.canGoBack(), canGoForward: guest.canGoForward() })
      if (shown !== '') writeLastUrl(sessionId, shown, tabId)
    }
    const visit = (): void => { recordVisit(guest.getURL(), guest.getTitle()) }
    const title = (): void => { recordTitle(guest.getURL(), guest.getTitle()) }
    const listeners: Array<[string, () => void]> = [
      // The shell forces the appearance on the guest's own web contents, so a
      // guest the pane has just created has no override yet: re-apply the stored
      // choice as soon as its contents are ready.
      ['dom-ready', () => { applyScheme(schemeRef.current) }],
      ['did-start-loading', () => { setState(current => ({ ...current, loading: true })) }],
      ['did-stop-loading', sync(false)],
      ['did-navigate', sync(true)],
      ['did-navigate-in-page', sync(false)],
      ['did-navigate', visit],
      ['did-navigate-in-page', visit],
      ['page-title-updated', title],
      ['did-stop-loading', title],
    ]
    for (const [name, listener] of listeners) guest.addEventListener(name, listener)
    const unmount = liveGuests.mount(sessionId, { tabId, guest, close: () => { closeTabRef.current() } })
    return () => {
      for (const [name, listener] of listeners) guest.removeEventListener(name, listener)
      unmount()
    }
  }, [sessionId, tabId, applyScheme])

  // The tab shown is the session's current one, which agent actions address.
  useEffect(() => {
    if (active) liveGuests.activate(sessionId, tabId)
  }, [active, sessionId, tabId])

  // The agent pointer is drawn by this window over the guest, as ChatGPT's
  // in-app browser draws it, so it holds its place across the guest's
  // navigations. The shell reports each action in the guest's own CSS pixels.
  // The overlay spans the window, so it draws only while the pane is visible
  // and the guest intersects the viewport, clipped to the guest's frame: a
  // hidden pill's guest has no box to place the pointer against. Closing the
  // column hides the pointer at once rather than when its slide ends.
  const overlayRef = useRef<BrowserOverlay | null>(null)
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  useEffect(() => {
    const bridge = desktopBrowser()
    const guest = guestRef.current
    const column = rootRef.current?.closest<HTMLElement>('[data-sidebar-right-surfaces]') ?? rootRef.current
    if (bridge === undefined || guest === null || column === null) return
    // One pointer serves the whole sidebar column, shared with its other panes, so
    // the cursor the reader follows travels from the page to a pill or a terminal.
    // It draws the pointer alone: a box, ring, or caret the agent put on the page
    // would be a mark on someone else's page.
    const pointer = acquireColumnPointer(column, CURSOR_IDLE_HIDE_MS)
    const layer = pointer.layer
    const overlay = pointer.overlay
    overlayRef.current = overlay
    // The agent working is what keeps the pointer on screen: the idle fade
    // applies once it has stopped, so a long action never loses its pointer.
    const stopHold = onPointerHold(sessionId, (hold) => {
      holdRef.current = hold
      overlay.setHold(hold)
    })
    // The pointer belongs to the pane's own canvas: its position is a fraction of
    // the pane, so resizing the pane moves it with the layout instead of leaving
    // it at the pixel it was put on. A pointer at the centre stays at the centre.
    /** One measurement as a plain box: the aiming rule takes numbers, not elements. */
    const measured = (element: Element): AimBox => {
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    /** The box the pointer and its tip offset are expressed in. */
    const panelBox = (): AimBox => {
      const rect = layer.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    /**
     * Where the pointer's tip goes for a control or link: the centre of its box, so the arrow lands
     * on the middle of what it presses. The address field's text is the one target that takes
     * {@link aimedTextStart} instead.
     */
    const aimedCentre = (element: Element | null): { x: number; y: number } | null =>
      element instanceof HTMLElement ? centreOf(measured(element), panelBox(), CURSOR_TIP_OFFSET_PX) : null
    /**
     * Where the pointer's tip goes for the address field: the start of the text it holds.
     */
    const aimedTextStart = (element: Element | null, inset: number): { x: number; y: number } | null =>
      element instanceof HTMLElement ? leftOf(measured(element), panelBox(), inset, CURSOR_TIP_OFFSET_PX) : null
    /**
     * A chrome control by its `data-control` name. The pane's own chrome row is the first place
     * to look, but the three-dot menu's rows are portaled to the page, so a visible control
     * anywhere in the document is a legitimate target.
     */
    const findControl = (name: string): HTMLElement | null => {
      const own = rootRef.current?.querySelector(`[data-control="${name}"]`)
      if (own instanceof HTMLElement) return own
      const anywhere = document.querySelector(`[data-control="${name}"]`)
      return anywhere instanceof HTMLElement && anywhere.getClientRects().length > 0 ? anywhere : null
    }
    /** Glide the pointer onto an element of the pane's chrome, show the press, then press it. */
    const pressAt = async (element: HTMLElement, signal?: AbortSignal): Promise<void> => {
      const point = aimedCentre(element)
      if (point !== null && visibleRef.current) {
        overlay.click(point)
        await overlay.arrived(signal)
      }
      signal?.throwIfAborted()
      element.click()
    }
    /**
     * An element once a menu has placed it: on screen and at the same box for two
     * frames, because a portaled menu renders a measuring frame off screen first and
     * the pointer must aim at where the row ends up. Null after {@link MENU_WAIT_MS}.
     */
    const waitForElement = async (find: () => HTMLElement | null, signal?: AbortSignal): Promise<HTMLElement | null> => {
      const deadline = performance.now() + MENU_WAIT_MS
      let previous = ''
      for (;;) {
        const element = find()
        if (element !== null) {
          const box = element.getBoundingClientRect()
          const onScreen = box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0
            && box.right <= window.innerWidth && box.bottom <= window.innerHeight
          const key = `${String(box.left)},${String(box.top)},${String(box.width)},${String(box.height)}`
          if (onScreen && key === previous) return element
          previous = onScreen ? key : ''
        }
        if (performance.now() > deadline) return null
        await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve() }) })
        signal?.throwIfAborted()
      }
    }
    /** A visible menu row by its label. */
    const menuRow = (label: string): HTMLElement | null => {
      for (const row of document.querySelectorAll('[role="menuitem"]')) {
        if (row instanceof HTMLElement && row.getClientRects().length > 0 && row.textContent.trim() === label) return row
      }
      return null
    }
    const pressControl = async (control: PaneControl, signal?: AbortSignal): Promise<void> => {
      const unavailable = (): Error => new Error(`the ${control} control is unavailable now`)
      const direct = control === 'back' || control === 'forward' || control === 'refresh' || control === 'capture' || control === 'open-in-chrome'
      if (direct) {
        const element = findControl(control)
        if (element === null || (element instanceof HTMLButtonElement && element.disabled)) throw unavailable()
        await pressAt(element, signal)
        return
      }
      const more = findControl('more')
      if (more === null) throw unavailable()
      if (more.getAttribute('aria-expanded') !== 'true') await pressAt(more, signal)
      if (control.startsWith('zoom-')) {
        const stepper = await waitForElement(() => findControl(control), signal)
        if (stepper === null) throw unavailable()
        await pressAt(stepper, signal)
        // The zoom row keeps the menu open for further steps; the reader's own menu closes on Escape.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        return
      }
      if (control.startsWith('appearance:')) {
        const parent = await waitForElement(() => menuRow(t('menu.appearance')), signal)
        if (parent === null || (parent as HTMLButtonElement).disabled) throw unavailable()
        await pressAt(parent, signal)
        const scheme = control.slice('appearance:'.length) as BrowserColorScheme
        const row = await waitForElement(() => menuRow(t(`scheme.${scheme}`)), signal)
        if (row === null) throw unavailable()
        await pressAt(row, signal)
        return
      }
      const row = await waitForElement(() => menuRow(t(MENU_ROW_KEYS[control as keyof typeof MENU_ROW_KEYS])), signal)
      if (row === null || (row as HTMLButtonElement).disabled) throw unavailable()
      await pressAt(row, signal)
    }
    const presentation: PaneCursorPresentation = {
      pressControl,
      async pressElement(find, signal) {
        const element = await waitForElement(find, signal)
        if (element === null) throw new Error('the control to press is not on screen')
        await pressAt(element, signal)
      },
      async announceControl(controlName, signal) {
        const control = findControl(controlName)
        const point = aimedCentre(control)
        if (point === null || !visibleRef.current) return
        overlay.click(point)
        await overlay.arrived(signal)
      },
      async announceNavigation(url, signal) {
        // The pointer targets the start of the address text; the caller owns the load.
        const point = aimedTextStart(addressRef.current, ADDRESS_TEXT_INSET_PX)
        if (point === null || !visibleRef.current) return
        overlay.type(point)
        await overlay.arrived(signal)
        signal?.throwIfAborted()
        setTypingUrl(url)
      },
    }
    livePaneCursors.set(guest, presentation)
    let onScreen = false
    // The shared pointer hides itself when the column closes; this tab only tracks
    // whether its page is the one on screen.
    const visibility = new IntersectionObserver((entries) => {
      onScreen = entries.at(-1)?.isIntersecting ?? false
    })
    visibility.observe(guest)
    // A resize reflows the page, so the pointer goes back to the element it is on
    // rather than staying at a pixel whose meaning the layout just changed. The
    // guest is asked, because only the page knows where that element moved to.
    // A drag reports a resize per frame: projecting on a small throttle keeps the
    // pointer on its element while the layout moves, and the settle pass lands it
    // exactly once the drag stops.
    let settle: ReturnType<typeof setTimeout> | undefined
    let projectedAt = 0
    /** Put the pointer back on the element it names, throttled, then once the layout stops. */
    const project = (): void => {
      const now = performance.now()
      if (now - projectedAt >= PROJECT_THROTTLE_MS) {
        projectedAt = now
        void followAnchor()
      }
      if (settle !== undefined) clearTimeout(settle)
      settle = setTimeout(() => {
        settle = undefined
        void followAnchor()
      }, PROJECT_SETTLE_MS)
    }
    const resizes = new ResizeObserver(project)
    /**
     * The box of the element a selector names, in the pane's own coordinates.
     *
     * The page is drawn by another process: its element measures against the
     * guest's own viewport, so the stage's origin and the guest's zoom are what
     * move that measurement into the frame the pointer and the ring are drawn in.
     * @param selector - selector of the element to measure.
     * @returns the rectangle in pane coordinates, or null when the page no longer has it.
     */
    const boxOf = async (selector: string): Promise<{ x: number; y: number; width: number; height: number } | null> => {
      const id = webContentsIdOf(guest)
      if (id === undefined) return null
      // An evaluate answers with the value it produced, wrapped: read through the
      // wrapper, or every measurement arrives as undefined and nothing moves.
      const reply = await bridge.automate(id, 'evaluate', {
        expression: `(() => {
          const element = document.querySelector(${JSON.stringify(selector)});
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        })()`,
      }).catch(() => null) as { value?: { x: number; y: number; width: number; height: number } | null } | null
      const measured = reply?.value ?? null
      if (measured === null || !Number.isFinite(measured.x) || !Number.isFinite(measured.y)) return null
      const stage = guest.getBoundingClientRect()
      const panel = layer.getBoundingClientRect()
      const scale = zoomRef.current
      return {
        x: stage.left - panel.left + measured.x * scale,
        y: stage.top - panel.top + measured.y * scale,
        width: measured.width * scale,
        height: measured.height * scale,
      }
    }
    /**
     * Put the pointer back on the element it names after the layout moved. The page reports only
     * where its element is, so that one measurement decides the point the tip takes.
     */
    const followAnchor = async (): Promise<void> => {
      const selector = anchorRef.current
      if (selector === undefined || !overlay.showing || !visibleRef.current) return
      const box = await boxOf(selector)
      if (box === null) return
      overlay.reposition({
        // The shell reports the element's centre; the tip takes that point, not the box.
        x: box.x + box.width / 2 + CURSOR_TIP_OFFSET_PX,
        y: box.y + box.height / 2 + CURSOR_TIP_OFFSET_PX,
      })
    }
    resizes.observe(layer)
    // Whether the pointer is mid scroll gesture. The shell announces each step of
    // one as a scroll, and the page moves under the pointer while it happens: that
    // movement is the gesture, not the layout leaving a resting pointer behind, so
    // re-aiming the pointer through it would fight the gesture's own placement.
    let scrolling = false
    // A page that scrolls moves the element under a pointer that is resting, and
    // only the page knows where it went.
    const stopPageScroll = bridge.onPageScroll((id) => {
      if (id !== webContentsIdOf(guest) || scrolling) return
      project()
    })
    let latestSequence = 0
    let disposed = false
    let chromeAction: AbortController | undefined
    const stop = bridge.onCursor((cursor) => {
      const id = webContentsIdOf(guest)
      if (id !== cursor.webContentsId || cursor.sequence < latestSequence) return
      if (cursor.action === 'cancel') {
        chromeAction?.abort()
        setTypingUrl(undefined)
        latestSequence = cursor.sequence + 1
        overlay.hide({ immediate: true })
        return
      }
      if (cursor.sequence > latestSequence) chromeAction?.abort()
      latestSequence = cursor.sequence
      const acknowledge = (): void => { bridge.cursorArrived(cursor.webContentsId, cursor.sequence) }
      const current = (): boolean => !disposed && cursor.sequence === latestSequence
      const shown = visibleRef.current && onScreen
      anchorRef.current = cursor.selector
      scrolling = cursor.action === 'scroll'
      if (cursor.action === 'control') {
        chromeAction = new AbortController()
        if (cursor.control === 'navigate') {
          const address = cursor.url ?? ''
          const target = resolveTarget(address)
          void presentation.announceNavigation(address, chromeAction.signal).then(() => {
            if (current() && target !== undefined) void guest.loadURL(target.kind === 'url' ? target.url : search.search(target.query))
            acknowledge()
          }, acknowledge)
          return
        }
        const name = cursor.control ?? 'refresh'
        if ((PANE_CONTROLS as readonly string[]).includes(name) && name !== 'back' && name !== 'forward' && name !== 'refresh' && name !== 'capture') {
          void pressControl(name as PaneControl, chromeAction.signal).then(acknowledge, acknowledge)
          return
        }
        const control = findControl(name)
        const spot = aimedCentre(control)
        if (shown && spot !== null) overlay.click(spot)
        void (shown ? overlay.arrived(chromeAction.signal) : Promise.resolve()).then(() => {
          if (current() && control instanceof HTMLElement && !(control instanceof HTMLButtonElement && control.disabled)) control.click()
          acknowledge()
        }, acknowledge)
        return
      }
      if (!shown) { acknowledge(); return }
      const stage = guest.getBoundingClientRect()
      const panel = layer.getBoundingClientRect()
      const point = {
        x: stage.left - panel.left + cursor.x * zoomRef.current,
        y: stage.top - panel.top + cursor.y * zoomRef.current,
      }
      switch (cursor.action) {
        case 'move': overlay.moveTo(point); break
        case 'click': overlay.click(point); break
        case 'type': overlay.type(point); break
        case 'scroll': overlay.scroll(point); break
      }
      void overlay.arrived().then(acknowledge)
    })
    return () => {
      disposed = true
      chromeAction?.abort()
      stop()
      stopHold()
      stopPageScroll()
      livePaneCursors.delete(guest)
      visibility.disconnect()
      resizes.disconnect()
      if (settle !== undefined) clearTimeout(settle)
      overlayRef.current = null
      pointer.release()
    }
  }, [sessionId])

  // A re-show while the agent is still working brings the pointer back where it
  // was, since the reader who closed the column to make room has not ended the work.
  useEffect(() => {
    const overlay = overlayRef.current
    if (overlay === null || !visible) return
    const spot = overlay.point
    if (spot === undefined || !holdRef.current) return
    overlay.moveTo(spot)
  }, [visible])

  const zoom = useCallback((direction: -1 | 0 | 1) => {
    const index = ZOOM_LEVELS.indexOf(zoomFactor)
    const next = direction === 0
      ? 1
      : ZOOM_LEVELS[Math.min(Math.max(index + direction, 0), ZOOM_LEVELS.length - 1)] ?? zoomFactor
    guestRef.current?.setZoomFactor(next)
    setZoomFactor(next)
  }, [zoomFactor])

  // Completions come from the shell, which is the only side that may call the
  // engine: no engine sends CORS headers, so a page-origin request is refused.
  // A slower answer never replaces a newer one, and a failed request only
  // closes the list — the field still enters what the reader typed.
  const suggestSeq = useRef(0)
  const suggestTimer = useRef<number | undefined>(undefined)
  const requestSuggestions = useCallback((text: string) => {
    const seq = ++suggestSeq.current
    window.clearTimeout(suggestTimer.current)
    const query = text.trim()
    const bridge = desktopBrowser()
    if (bridge === undefined || query === '') {
      setSuggestions([])
      return
    }
    // Pages visited before lead the list, then the engine's completions.
    const visited = searchHistory(query, HISTORY_SUGGESTION_LIMIT).map(entry => entry.url)
    suggestTimer.current = window.setTimeout(() => {
      bridge.suggest(search.suggest(query)).then((body) => {
        const engine = parseSuggestions(body).filter(entry => !visited.includes(entry))
        if (seq === suggestSeq.current) setSuggestions([...visited, ...engine].slice(0, SUGGESTION_LIMIT))
      }, (error: unknown) => {
        console.error('ui-sidebar-browser: completions failed', error)
        if (seq === suggestSeq.current) setSuggestions(visited)
      })
    }, SUGGEST_DEBOUNCE_MS)
  }, [search])
  useEffect(() => () => { window.clearTimeout(suggestTimer.current) }, [])

  const bridge = desktopBrowser()
  const partition = browserPartition()
  const pageDisabled = state.url === ''

  return (
    <div ref={rootRef} className={css.root} data-sidebar-right-browser="">
      <ChromeRow
        typing={typingUrl}
        addressRef={addressRef}
        url={state.url}
        loading={state.loading}
        canGoBack={state.canGoBack}
        canGoForward={state.canGoForward}
        onBack={() => { guestRef.current?.goBack() }}
        onForward={() => { guestRef.current?.goForward() }}
        onRefresh={() => {
          if (state.loading) guestRef.current?.stop()
          else guestRef.current?.reload()
        }}
        onSubmit={(text) => {
          // The typed text is one entry: the page it names, or a search for it.
          setSuggestions([])
          suggestSeq.current++
          const target = resolveTarget(text)
          if (target === undefined) return
          void guestRef.current?.loadURL(target.kind === 'url' ? target.url : search.search(target.query))
        }}
        onDraftChange={requestSuggestions}
        suggestions={suggestions}
        placeholder={t(SEARCH_PLACEHOLDER_KEYS[engine])}
        onOpenInChrome={() => { openInChrome(sessionId, state.url) }}
        onCapture={() => {
          const guest = guestRef.current
          const id = guest === null ? undefined : webContentsIdOf(guest)
          if (id === undefined || bridge === undefined) return
          const seq = ++captureSeq.current
          bridge.capture(id).then(() => {
            setCaptured(true)
            setCaptureToast({ seq, ok: true })
            window.setTimeout(() => { setCaptured(false) }, CAPTURED_FEEDBACK_MS)
          }, (error: unknown) => {
            console.error('ui-sidebar-browser: capture failed', error)
            setCaptureToast({ seq, ok: false })
          })
        }}
        captured={captured}
        t={t}
        trailingActions={(
          <MoreMenu
            disabled={pageDisabled}
            zoomFactor={zoomFactor}
            colorScheme={colorScheme}
            onHardReload={() => { guestRef.current?.reloadIgnoringCache() }}
            onOpenDevTools={() => { guestRef.current?.openDevTools() }}
            onColorScheme={(scheme) => {
              setColorScheme(scheme)
              writeColorScheme(sessionId, scheme)
              applyScheme(scheme)
            }}
            onZoom={zoom}
            onClearCookies={() => { void bridge?.clearData(partition, 'cookies') }}
            onClearCache={() => { void bridge?.clearData(partition, 'cache') }}
            t={t}
          />
        )}
      />
      {/* Not JSX-typed: `webview` is an Electron tag, so it is created through
          the DOM rather than declared as an intrinsic element React knows. */}
      <div
        className={css.stage}
        ref={(node) => { guestRef.current = attachGuest(node, sessionId, tabId) }}
      />
      {active && <HandoffModal sessionId={sessionId} t={t} />}
      {captureToast !== null && (
        <Toast
          key={captureToast.seq}
          text={captureToast.ok ? t('capture.done') : t('capture.failed')}
          icon={captureToast.ok ? undefined : <IconWarningOutline16 />}
          anchor={rootRef.current}
          holdMs={CAPTURE_TOAST_HOLD_MS}
          onDone={closeCaptureToast}
        />
      )}
    </div>
  )
}

/**
 * Create the guest inside its stage, once per mount.
 * @param stage - the element that holds the guest, or null on unmount.
 * @param sessionId - session whose last address the guest reopens.
 * @param tabId - the tab whose own last address the guest reopens.
 * @returns the guest element, or null when there is no stage.
 */
function attachGuest(stage: HTMLDivElement | null, sessionId: string, tabId: string): BrowserGuest | null {
  if (stage === null) return null
  const existing = stage.firstElementChild
  if (existing !== null) return existing as BrowserGuest
  const guest = document.createElement('webview') as BrowserGuest
  // Fixed for the guest's lifetime: Electron reads the partition when the
  // element attaches and ignores a later change.
  guest.setAttribute('partition', browserPartition())
  // Present means allowed; the shell loads a popup's address into this guest
  // instead of opening a window (desktop `browser-guests.ts`).
  guest.setAttribute('allowpopups', '')
  // A guest with no `src` never attaches its web contents, so `loadURL` and the
  // history methods throw until one is set.
  guest.setAttribute('src', readLastUrl(sessionId, tabId) ?? 'about:blank')
  guest.className = css.guest ?? ''
  stage.append(guest)
  return guest
}
