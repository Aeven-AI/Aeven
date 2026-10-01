/**
 * The right sidebar's browser: t3code's chrome row over an Electron
 * `<webview>` guest that holds the visited page.
 *
 * The guest is the only surface that can show a cross-origin page and still be
 * read: an iframe is refused by `X-Frame-Options` and cannot be inspected
 * across origins. Its storage partition is per session, so signing in to a site
 * in one session does not carry into another, and the shell refuses to attach a
 * guest naming any other partition (desktop `browser-guests.ts`).
 *
 * The selection keys this pane by session, so a session switch mounts a fresh
 * guest in that session's partition, reopened at the address it last showed.
 * The tag exists only in the desktop shell, so the plugin registers this pane
 * only there (index.ts) and a browser tab never lists the kind at all.
 */
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BrowserOverlay } from '@aeven/experimental-browser-overlay/src/overlay.ts'
import { IconWarningOutline16, Toast } from '@aeven/client-ui-primitives'
import type { TranslateNS } from '@aeven/client-locale/client'
import { ChromeRow } from './ChromeRow.tsx'
import {
  browserPartition, desktopBrowser, liveGuests, livePaneCursors, onPointerHold, readColorScheme, readLastUrl, webContentsIdOf,
  writeColorScheme, writeLastUrl, type BrowserColorScheme, type BrowserGuest, type PaneCursorPresentation,
} from './guest.ts'
import { SEARCH_PLACEHOLDER_KEYS } from './locales.ts'
import type { SearchEnginePreference } from './search-engine.ts'
import { MoreMenu } from './MoreMenu.tsx'
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

/**
 * How long a column resize waits for the layout to settle before the pointer is
 * re-projected onto its target, in ms. A drag reports a resize per frame, and
 * re-placing the pointer per frame would read layout and restart its glide for
 * every one of them.
 */
const RESIZE_SETTLE_MS = 120

/** Where in the address field the typed address begins, from its left edge, in CSS pixels. */
const ADDRESS_TEXT_INSET_PX = 14
/** How fast the agent's address types into the address bar, per character, in ms. */
const ADDRESS_TYPE_MS = 24
/** How long a typed address holds before the load replaces it, in ms. */
const ADDRESS_SETTLE_MS = 140
/** How long the pointer rests on a chrome control it pressed, in ms. */
const CONTROL_PRESS_MS = 220

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
 * Render the browser for one session.
 * @param props - see {@link BrowserPaneProps}.
 * @returns the browser element tree.
 */
export function BrowserPane({ sessionId, t, openInChrome, visible, search }: BrowserPaneProps): ReactNode {
  const guestRef = useRef<BrowserGuest | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  /** The pane's own layer the agent pointer draws in. */
  const cursorLayerRef = useRef<HTMLDivElement | null>(null)
  /** Whether the agent is working, which holds the pointer on screen. */
  const holdRef = useRef(false)
  /** Selector of the element the pointer is on, when the last action named one. */
  const anchorRef = useRef<string | undefined>(undefined)
  /** The address field, so the pointer can be shown typing into it. */
  const addressRef = useRef<HTMLInputElement | null>(null)
  /** An address the agent is typing, shown in place of the committed one. */
  const [typingUrl, setTypingUrl] = useState<string | undefined>(undefined)
  const [state, setState] = useState<GuestState>({ url: '', loading: false, canGoBack: false, canGoForward: false })
  const [suggestions, setSuggestions] = useState<readonly string[]>([])
  const engine = useSyncExternalStore(search.engine.subscribe, search.engine.getSnapshot)
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
      if (shown !== '') writeLastUrl(sessionId, shown)
    }
    const listeners: Array<[string, () => void]> = [
      // The shell forces the appearance on the guest's own web contents, so a
      // guest the pane has just created has no override yet: re-apply the stored
      // choice as soon as its contents are ready.
      ['dom-ready', () => { applyScheme(schemeRef.current) }],
      ['did-start-loading', () => { setState(current => ({ ...current, loading: true })) }],
      ['did-stop-loading', sync(false)],
      ['did-navigate', sync(true)],
      ['did-navigate-in-page', sync(false)],
    ]
    for (const [name, listener] of listeners) guest.addEventListener(name, listener)
    liveGuests.set(sessionId, guest)
    return () => {
      for (const [name, listener] of listeners) guest.removeEventListener(name, listener)
      if (liveGuests.get(sessionId) === guest) liveGuests.delete(sessionId)
    }
  }, [sessionId, applyScheme])

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
    const layer = cursorLayerRef.current
    if (bridge === undefined || guest === null || layer === null) return
    // The overlay draws inside the pane, not over the window: the panel is the
    // region the agent acts in, its own address bar included, and filling the
    // layer is what keeps the pointer inside it.
    const overlay = new BrowserOverlay().attach({ container: layer, idleHideMs: CURSOR_IDLE_HIDE_MS })
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
    const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })
    const pointOf = (element: Element | null, inset = 0): { x: number; y: number } | null => {
      if (!(element instanceof HTMLElement)) return null
      const rect = element.getBoundingClientRect()
      const panel = layer.getBoundingClientRect()
      return { x: rect.left - panel.left + inset, y: rect.top - panel.top + rect.height / 2 }
    }
    const presentation: PaneCursorPresentation = {
      async announceControl(controlName) {
        const control = rootRef.current?.querySelector(`[data-control="${controlName}"]`) ?? null
        const point = pointOf(control, 0)
        if (point === null || !visibleRef.current) return
        overlay.click(point)
        await overlay.arrived()
        await wait(CONTROL_PRESS_MS)
      },
      async announceNavigation(url) {
        // Typing begins at the start of the field, so that is where the pointer goes.
        const point = pointOf(addressRef.current, ADDRESS_TEXT_INSET_PX)
        if (point === null || !visibleRef.current) return
        overlay.type(point)
        await overlay.arrived()
        for (let index = 1; index <= url.length; index += 1) {
          setTypingUrl(url.slice(0, index))
          await wait(ADDRESS_TYPE_MS)
        }
        await wait(ADDRESS_SETTLE_MS)
        setTypingUrl(undefined)
      },
    }
    livePaneCursors.set(guest, presentation)
    let onScreen = false
    const visibility = new IntersectionObserver((entries) => {
      onScreen = entries.at(-1)?.isIntersecting ?? false
      if (!onScreen) overlay.hide()
    })
    visibility.observe(guest)
    // A resize scales the pointer with the pane: its position is a fraction of the
    // box it draws in, so the layout change carries it along rather than leaving it
    // at a pixel that no longer means the same place.
    let settle: ReturnType<typeof setTimeout> | undefined
    const resizes = new ResizeObserver(() => {
      if (settle !== undefined) clearTimeout(settle)
      settle = setTimeout(() => {
        settle = undefined
        void followAnchor()
      }, RESIZE_SETTLE_MS)
    })
    // A resize reflows the page, so the pointer goes back to the element it is on
    // rather than staying at a pixel whose meaning the layout just changed. The
    // guest is asked, because only the page knows where that element moved to.
    const followAnchor = async (): Promise<void> => {
      const selector = anchorRef.current
      const id = webContentsIdOf(guest)
      if (selector === undefined || id === undefined || !overlay.showing) return
      // An evaluate answers with the value it produced, wrapped: read through the
      // wrapper, or every measurement arrives as undefined and nothing moves.
      const reply = await bridge.automate(id, 'evaluate', {
        expression: `(() => {
          const element = document.querySelector(${JSON.stringify(selector)});
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })()`,
      }).catch(() => null) as { value?: { x: number; y: number } | null } | null
      const measured = reply?.value ?? null
      if (measured === null || !Number.isFinite(measured.x) || !Number.isFinite(measured.y)) return
      const stage = guest.getBoundingClientRect()
      const panel = layer.getBoundingClientRect()
      overlay.reposition({
        x: stage.left - panel.left + measured.x * zoomRef.current,
        y: stage.top - panel.top + measured.y * zoomRef.current,
      })
    }
    resizes.observe(layer)
    const stop = bridge.onCursor((cursor) => {
      const id = webContentsIdOf(guest)
      if (id !== undefined && cursor.webContentsId !== id) return
      if (cursor.selector !== undefined) anchorRef.current = cursor.selector
      // A pointer that cannot be drawn is not waited for: the shell's input lands
      // at once rather than after its arrival timeout. A guest that has not
      // reported its webContents id cannot be drawn in either, and it is the
      // pane that owes the shell an answer, not the shell that owes it patience.
      if (id === undefined || !visibleRef.current || !onScreen) {
        if (cursor.action === 'move') bridge.cursorArrived(cursor.webContentsId, cursor.sequence)
        return
      }
      // The shell reports guest CSS pixels; the overlay draws in the pane's own
      // coordinates, so the guest's frame is what maps one to the other.
      const stage = guest.getBoundingClientRect()
      const panel = layer.getBoundingClientRect()
      const point = {
        x: stage.left - panel.left + cursor.x * zoomRef.current,
        y: stage.top - panel.top + cursor.y * zoomRef.current,
      }
      switch (cursor.action) {
        case 'move':
          overlay.moveTo(point)
          void overlay.arrived().then(() => { bridge.cursorArrived(cursor.webContentsId, cursor.sequence) })
          return
        case 'click': overlay.click(point); return
        case 'type': overlay.type(point); return
        case 'scroll': overlay.scroll(point); return
      }
    })
    return () => {
      stop()
      stopHold()
      livePaneCursors.delete(guest)
      visibility.disconnect()
      resizes.disconnect()
      if (settle !== undefined) clearTimeout(settle)
      overlayRef.current = null
      overlay.destroy()
    }
  }, [sessionId])

  // Closing the column fades the pointer out on the same spring as its idle
  // fade, so the reader sees it leave rather than blink away with the pane. A
  // re-show while the agent is still working brings it back where it was, since
  // the reader who closed the column to make room has not ended the work.
  useEffect(() => {
    const overlay = overlayRef.current
    if (overlay === null) return
    if (!visible) {
      overlay.hide()
      return
    }
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
    suggestTimer.current = window.setTimeout(() => {
      bridge.suggest(search.suggest(query)).then((body) => {
        if (seq === suggestSeq.current) setSuggestions(parseSuggestions(body).slice(0, SUGGESTION_LIMIT))
      }, (error: unknown) => {
        console.error('ui-sidebar-browser: completions failed', error)
        if (seq === suggestSeq.current) setSuggestions([])
      })
    }, SUGGEST_DEBOUNCE_MS)
  }, [search])
  useEffect(() => () => { window.clearTimeout(suggestTimer.current) }, [])

  const bridge = desktopBrowser()
  const partition = browserPartition(sessionId)
  const pageDisabled = state.url === ''

  return (
    <div ref={rootRef} className={css.root} data-sidebar-right-browser="">
      <div ref={cursorLayerRef} className={css.cursorLayer} aria-hidden="true" />
      <ChromeRow
        addressRef={addressRef}
        typing={typingUrl}
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
        ref={(node) => { guestRef.current = attachGuest(node, sessionId) }}
      />
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
 * @param sessionId - session whose storage partition and last address the guest uses.
 * @returns the guest element, or null when there is no stage.
 */
function attachGuest(stage: HTMLDivElement | null, sessionId: string): BrowserGuest | null {
  if (stage === null) return null
  const existing = stage.firstElementChild
  if (existing !== null) return existing as BrowserGuest
  const guest = document.createElement('webview') as BrowserGuest
  // Fixed for the guest's lifetime: Electron reads the partition when the
  // element attaches and ignores a later change.
  guest.setAttribute('partition', browserPartition(sessionId))
  // Present means allowed; the shell loads a popup's address into this guest
  // instead of opening a window (desktop `browser-guests.ts`).
  guest.setAttribute('allowpopups', '')
  // A guest with no `src` never attaches its web contents, so `loadURL` and the
  // history methods throw until one is set.
  guest.setAttribute('src', readLastUrl(sessionId) ?? 'about:blank')
  guest.className = css.guest ?? ''
  stage.append(guest)
  return guest
}
