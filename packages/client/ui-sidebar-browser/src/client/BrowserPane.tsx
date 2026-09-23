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
import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserOverlay } from '@aeven/experimental-browser-overlay/src/overlay.ts'
import type { TranslateNS } from '@aeven/client-locale/client'
import { ChromeRow } from './ChromeRow.tsx'
import {
  browserPartition, desktopBrowser, liveGuests, readLastUrl, writeLastUrl,
  type BrowserColorScheme, type BrowserGuest,
} from './guest.ts'
import { MoreMenu } from './MoreMenu.tsx'
import { resolveAddress } from './url.ts'
import css from './BrowserPane.module.css'

/** Chromium's zoom levels, which the zoom controls step through. */
const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]

/** How long the capture control reports a copied screenshot, in ms. */
const CAPTURED_FEEDBACK_MS = 1000

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
}

/**
 * Render the browser for one session.
 * @param props - see {@link BrowserPaneProps}.
 * @returns the browser element tree.
 */
export function BrowserPane({ sessionId, t }: BrowserPaneProps): ReactNode {
  const guestRef = useRef<BrowserGuest | null>(null)
  const [state, setState] = useState<GuestState>({ url: '', loading: false, canGoBack: false, canGoForward: false })
  const [zoomFactor, setZoomFactor] = useState(1)
  const zoomRef = useRef(1)
  zoomRef.current = zoomFactor
  const [colorScheme, setColorScheme] = useState<BrowserColorScheme>('system')
  const [captured, setCaptured] = useState(false)

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
  }, [sessionId])

  // The agent pointer is drawn by this window over the guest, as ChatGPT's
  // in-app browser draws it, so it holds its place across the guest's
  // navigations. The shell reports each action in the guest's own CSS pixels.
  useEffect(() => {
    const bridge = desktopBrowser()
    const guest = guestRef.current
    if (bridge === undefined || guest === null) return
    const overlay = new BrowserOverlay().attach()
    const stop = bridge.onCursor((cursor) => {
      if (cursor.webContentsId !== guest.getWebContentsId()) return
      const stage = guest.getBoundingClientRect()
      const point = { x: stage.left + cursor.x * zoomRef.current, y: stage.top + cursor.y * zoomRef.current }
      switch (cursor.action) {
        case 'click': overlay.click(point); return
        case 'type': overlay.type(point); return
        case 'scroll': overlay.scroll(point, { deltaY: cursor.deltaY ?? 0 }); return
      }
    })
    return () => {
      stop()
      overlay.destroy()
    }
  }, [sessionId])

  // The shell addresses a guest by its web contents id, which exists only once
  // the guest has attached; the controls that reach here need a loaded page.
  const withGuestId = useCallback((run: (webContentsId: number) => Promise<void>) => {
    const guest = guestRef.current
    if (guest === null) return
    run(guest.getWebContentsId()).catch((error: unknown) => {
      console.error('ui-sidebar-browser: shell operation failed', error)
    })
  }, [])

  const zoom = useCallback((direction: -1 | 0 | 1) => {
    const index = ZOOM_LEVELS.indexOf(zoomFactor)
    const next = direction === 0
      ? 1
      : ZOOM_LEVELS[Math.min(Math.max(index + direction, 0), ZOOM_LEVELS.length - 1)] ?? zoomFactor
    guestRef.current?.setZoomFactor(next)
    setZoomFactor(next)
  }, [zoomFactor])

  const bridge = desktopBrowser()
  const partition = browserPartition(sessionId)
  const pageDisabled = state.url === ''

  return (
    <div className={css.root} data-sidebar-right-browser="">
      <ChromeRow
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
          const resolved = resolveAddress(text)
          if (resolved !== undefined) void guestRef.current?.loadURL(resolved)
        }}
        onOpenInBrowser={() => { void bridge?.openExternal(state.url) }}
        onCapture={() => {
          withGuestId(async (id) => {
            await bridge?.capture(id)
            setCaptured(true)
            window.setTimeout(() => { setCaptured(false) }, CAPTURED_FEEDBACK_MS)
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
              withGuestId(async (id) => { await bridge?.setColorScheme(id, scheme) })
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
