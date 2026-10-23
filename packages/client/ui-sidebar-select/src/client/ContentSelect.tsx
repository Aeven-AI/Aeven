/**
 * The right sidebar's surface column: a strip of pills, one per open surface,
 * over the panes they show; with nothing open, the launcher that opens one.
 *
 * Every open pane stays mounted and only the shown one is visible, so a browser
 * keeps its page and an explorer its tree while another pill is in front. The
 * set of pills is remembered per session (surfaces.ts); a pane may rename its
 * own pill, as the explorer does for the file it has open.
 *
 * Full screen lifts the column over the whole frame without moving it in the
 * tree, so no pane remounts; the frame's corner controls, which hold its
 * toggle (FullscreenButton.tsx), stay above it.
 */
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import {
  IconLucideFolderSearch, IconLucideGlobe, IconLucidePlus, IconLucideTabletSmartphone, IconLucideX, IconTerminalMark,
  Menu, type MenuEntry,
} from '@aeven/client-ui-primitives'
import type { ContentSelectComponentProps } from './contract/slots.ts'
import type { SidebarContentRegistry, SidebarSurfaceTab } from './registry.ts'
import { useFullscreen } from './fullscreen.ts'
import { SIDEBAR_CONTENT_KINDS, type SidebarContentKind } from './selection.ts'
import {
  closeSurfaces, openSurface, readSurfaces, writeSurfaces, type SidebarSurface, type SurfaceState,
} from './surfaces.ts'
import css from './ContentSelect.module.css'

/** The glyph each kind's pill and launcher row carry. The terminal takes the
 * bash mark the transcript's own shell rows carry, so one kind reads the same
 * in the sidebar as it does in the conversation. */
const GLYPHS: Record<SidebarContentKind, () => ReactNode> = {
  browser: () => <IconLucideGlobe />,
  terminal: () => <IconTerminalMark />,
  files: () => <IconLucideFolderSearch />,
  device: () => <IconLucideTabletSmartphone />,
}

/** Scroll-edge slack below which a pixel of overflow is not worth a fade. */
const EDGE_TOLERANCE = 1

/** A pill's right-click menu, anchored at the pointer. */
interface PillMenu {
  readonly surfaceId: string
  readonly x: number
  readonly y: number
}

/**
 * Render one session's surface column.
 * @param props - composed slot props (runtime share + locale + registry, contract/slots.ts).
 * @returns the column element tree.
 */
export function ContentSelect(props: ContentSelectComponentProps) {
  const { sessionId, t, registry, fullscreen: fullscreenState, openRightbar, collapsed } = props
  // Keyed by session: the body slot re-renders this instance for whichever
  // session is current, so a set read for one session must not stand for the next.
  const [held, setHeld] = useState(() => ({ sessionId, state: readSurfaces(sessionId) }))
  const state = held.sessionId === sessionId ? held.state : readSurfaces(sessionId)
  const [tabs, setTabs] = useState<ReadonlyMap<string, SidebarSurfaceTab>>(new Map())
  const [addOpen, setAddOpen] = useState(false)
  const [pillMenu, setPillMenu] = useState<PillMenu | null>(null)
  const fullscreen = useFullscreen(fullscreenState, sessionId)
  // Providers register as their plugins mount, so availability is read live.
  const registryVersion = useSyncExternalStore(callback => registry.subscribe(callback), () => registry.version)

  const update = useCallback((next: (current: SurfaceState) => SurfaceState) => {
    setHeld((current) => {
      const base = current.sessionId === sessionId ? current.state : readSurfaces(sessionId)
      const state = next(base)
      writeSurfaces(sessionId, state)
      return { sessionId, state }
    })
  }, [sessionId])

  // A launcher kind runs its action and opens no pill.
  const open = useCallback((kind: SidebarContentKind) => {
    const launch = registry.launcher(kind)
    if (launch !== undefined) {
      launch(sessionId)
      return
    }
    if (registry.resolve(kind) === undefined) return
    // A session has one browser page, which the agent's browser tools address
    // by session, so picking the browser again shows the pill already open.
    update((current) => {
      const existing = kind === 'browser' ? current.surfaces.find(surface => surface.kind === kind) : undefined
      return existing === undefined ? openSurface(current, kind).state : { ...current, active: existing.id }
    })
  }, [registry, sessionId, update])
  const activate = useCallback((id: string) => { update(current => ({ ...current, active: id })) }, [update])
  const close = useCallback((ids: readonly string[]) => {
    const closing = new Set(ids)
    registry.closed(sessionId, state.surfaces.filter(surface => closing.has(surface.id)))
    update(current => closeSurfaces(current, closing))
  }, [registry, sessionId, state.surfaces, update])

  useEffect(() => {
    const request = registry.takeOpenRequest(sessionId)
    if (request === undefined) return
    const { kind, newSurface, surfaceId } = request
    update((current) => {
      const existing = newSurface ? undefined : current.surfaces.find(surface =>
        surface.kind === kind && (surfaceId === undefined || surface.id === surfaceId))
      return existing === undefined ? openSurface(current, kind).state : { ...current, active: existing.id }
    })
    openRightbar(sessionId)
  }, [registry, registryVersion, sessionId, update, openRightbar])

  // One stable setter per surface, so a pane's effect that renames its pill
  // does not re-run on every column render.
  const tabSetters = useRef(new Map<string, (tab: SidebarSurfaceTab | undefined) => void>())
  const setTabFor = useCallback((id: string) => {
    let setter = tabSetters.current.get(id)
    if (setter === undefined) {
      setter = (tab) => {
        setTabs((current) => {
          if (current.get(id) === tab) return current
          const next = new Map(current)
          if (tab === undefined) next.delete(id)
          else next.set(id, tab)
          return next
        })
      }
      tabSetters.current.set(id, setter)
    }
    return setter
  }, [])

  // A pill saved for a kind that has since become a launcher has nothing to
  // show; it is dropped rather than left as an empty pane.
  const stale = state.surfaces.filter(surface => registry.launcher(surface.kind) !== undefined)
    .map(surface => surface.id).join('\n')
  useEffect(() => {
    if (stale !== '') update(current => closeSurfaces(current, new Set(stale.split('\n'))))
  }, [stale, update])

  const titleOf = useCallback((surface: SidebarSurface): string =>
    tabs.get(surface.id)?.title ?? t(`${surface.kind}.tab`), [t, tabs])

  // A web client's browser is a launcher for the Host's Chromium window, which
  // stays off the plus menu; the empty launcher still offers it. The desktop
  // shell's browser is a pane, listed with the others.
  const addItems = useMemo<MenuEntry[]>(() => availableKinds(registry)
    .filter(kind => kind !== 'browser' || registry.launcher(kind) === undefined)
    .map(kind => ({
      id: kind,
      icon: <span className={css.menuGlyph}>{GLYPHS[kind]()}</span>,
      label: t(`${kind}.tab`),
    })), [registry, registry.version, t])

  const menuSurfaceIndex = pillMenu === null ? -1 : state.surfaces.findIndex(s => s.id === pillMenu.surfaceId)
  const pillMenuItems = useMemo<MenuEntry[]>(() => [
    { id: 'close', label: t('menu.close') },
    { id: 'close-others', label: t('menu.closeOthers'), disabled: state.surfaces.length <= 1 },
    { id: 'close-right', label: t('menu.closeRight'), disabled: menuSurfaceIndex >= state.surfaces.length - 1 },
    { type: 'separator', id: 'separator' },
    { id: 'close-all', label: t('menu.closeAll') },
  ], [menuSurfaceIndex, state.surfaces.length, t])

  const onPillMenu = (id: string) => {
    const surfaceId = pillMenu?.surfaceId
    setPillMenu(null)
    if (surfaceId === undefined) return
    const index = state.surfaces.findIndex(surface => surface.id === surfaceId)
    if (id === 'close') close([surfaceId])
    else if (id === 'close-others') close(state.surfaces.filter(surface => surface.id !== surfaceId).map(s => s.id))
    else if (id === 'close-right') close(state.surfaces.slice(index + 1).map(surface => surface.id))
    else if (id === 'close-all') close(state.surfaces.map(surface => surface.id))
  }

  const strip = useStripScroll(state.active)

  // Escape leaves full screen unless something inside already handled it.
  useEffect(() => {
    if (!fullscreen) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      fullscreenState.set(null)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [fullscreen, fullscreenState])

  return (
    <div className={css.root} data-sidebar-right-surfaces="" data-fullscreen={fullscreen || undefined}>
      {/* With nothing open the strip draws nothing, and the launcher's first row
          takes this row instead — the corner band's own, where the account
          sits. */}
      {state.surfaces.length > 0 && (
        <div className={css.tabbar}>
          <div
            ref={strip.ref}
            className={clsx(css.strip, strip.fadeLeft && css.fadeLeft, strip.fadeRight && css.fadeRight)}
            role="tablist"
            aria-orientation="horizontal"
          >
            {state.surfaces.map((surface) => {
              const active = surface.id === state.active
              const title = titleOf(surface)
              return (
                <div
                  key={surface.id}
                  className={css.pill}
                  data-active={active || undefined}
                  data-sidebar-right-pill={surface.kind}
                  onMouseDown={(event) => { if (event.button === 1) event.preventDefault() }}
                  onAuxClick={(event) => {
                    if (event.button !== 1) return
                    event.preventDefault()
                    close([surface.id])
                  }}
                  onContextMenu={(event: ReactMouseEvent) => {
                    event.preventDefault()
                    setPillMenu({ surfaceId: surface.id, x: event.clientX, y: event.clientY })
                  }}
                >
                  <button
                    type="button"
                    className={css.pillClose}
                    aria-label={t('tabs.close', { title })}
                    onClick={() => { close([surface.id]) }}
                  >
                    <span className={css.pillGlyph}>{tabs.get(surface.id)?.icon ?? GLYPHS[surface.kind]()}</span>
                    <span className={css.pillX}><IconLucideX /></span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={css.pillTitle}
                    title={title}
                    onClick={() => { activate(surface.id) }}
                  >
                    {title}
                  </button>
                </div>
              )
            })}
            <Menu
              open={addOpen}
              onClose={() => { setAddOpen(false) }}
              items={addItems}
              onSelect={(id) => {
                setAddOpen(false)
                open(id as SidebarContentKind)
              }}
              portal
              anchor={(
                <button
                  type="button"
                  className={css.add}
                  aria-label={t('tabs.add')}
                  aria-haspopup="menu"
                  aria-expanded={addOpen}
                  onClick={() => { setAddOpen(value => !value) }}
                >
                  <IconLucidePlus />
                </button>
              )}
            />
          </div>
        </div>
      )}

      <div className={css.body}>
        {state.surfaces.length === 0
          ? <Launcher t={t} kinds={availableKinds(registry)} onOpen={open} />
          : state.surfaces.map((surface) => {
            const Pane = registry.resolve(surface.kind)
            const active = surface.id === state.active
            return (
              // Keyed by session too: pill ids repeat across sessions, and a pane
              // holding one session's state must never serve the next.
              <div key={`${sessionId}:${surface.id}`} className={css.pane} hidden={!active} data-sidebar-right-pane={surface.kind}>
                {Pane === undefined
                  ? <div className={css.unavailable}>{t('entry.unavailable')}</div>
                  : <Pane
                    sessionId={sessionId}
                    surfaceId={surface.id}
                    active={active}
                    visible={active && !collapsed}
                    setTab={setTabFor(surface.id)}
                    closeSurface={() => { close([surface.id]) }}
                  />}
              </div>
            )
          })}
      </div>

      {pillMenu !== null && (
        <Menu
          open
          onClose={() => { setPillMenu(null) }}
          items={pillMenuItems}
          onSelect={onPillMenu}
          portal
          getAnchorRect={() => new DOMRect(pillMenu.x, pillMenu.y, 0, 0)}
          anchor={<span />}
        />
      )}
    </div>
  )
}

/**
 * The kinds a provider currently answers, in the selection's order.
 * @param registry - the content registry.
 * @returns the available kinds.
 */
function availableKinds(registry: SidebarContentRegistry): SidebarContentKind[] {
  const available = registry.available()
  return SIDEBAR_CONTENT_KINDS.filter(kind => available.has(kind))
}

/** The empty column: one row per available kind. */
function Launcher({ t, kinds, onOpen }: {
  t: ContentSelectComponentProps['t']
  kinds: readonly SidebarContentKind[]
  onOpen: (kind: SidebarContentKind) => void
}) {
  return (
    <div className={css.launcher} data-sidebar-right-select="">
      {kinds.map(kind => (
        <button
          key={kind}
          type="button"
          className={css.launcherRow}
          data-sidebar-right-select-entry={kind}
          title={t(`${kind}.description`)}
          onClick={() => { onOpen(kind) }}
        >
          <span className={css.launcherGlyph}>{GLYPHS[kind]()}</span>
          <span className={css.launcherLabel}>{t(`${kind}.tab`)}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Horizontal overflow for the pill strip: vertical wheel scrolls it sideways,
 * the right edge fades while more pills lie past it, and the shown pill
 * scrolls into view.
 * @param active - the shown surface id, re-revealed when it changes.
 * @returns the strip's callback ref and whether the right edge fades.
 */
function useStripScroll(active: string | null) {
  // State, not a ref object: the strip mounts with the first open surface,
  // after this hook's first effects, and the listeners must bind to it then.
  const [strip, ref] = useState<HTMLDivElement | null>(null)
  const [fadeLeft, setFadeLeft] = useState(false)
  const [fadeRight, setFadeRight] = useState(false)

  const measure = useCallback(() => {
    if (strip === null) return
    setFadeLeft(strip.scrollLeft > EDGE_TOLERANCE)
    setFadeRight(strip.scrollLeft + strip.clientWidth < strip.scrollWidth - EDGE_TOLERANCE)
  }, [strip])

  useEffect(() => {
    if (strip === null) return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(strip)
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      const before = strip.scrollLeft
      strip.scrollLeft += delta
      if (strip.scrollLeft !== before) event.preventDefault()
    }
    strip.addEventListener('scroll', measure, { passive: true })
    strip.addEventListener('wheel', onWheel, { passive: false })
    measure()
    return () => {
      observer.disconnect()
      strip.removeEventListener('scroll', measure)
      strip.removeEventListener('wheel', onWheel)
    }
  }, [strip, measure])

  useEffect(() => {
    strip?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    measure()
  }, [active, strip, measure])

  return { ref, fadeLeft, fadeRight }
}
