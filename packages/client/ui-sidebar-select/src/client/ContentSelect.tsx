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
 * tree, so no pane remounts; the frame's corner controls stay above it.
 */
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import {
  IconLucideFiles, IconLucideGlobe, IconLucideMaximize2, IconLucideMinimize2, IconLucidePlus, IconLucideSmartphone,
  IconLucideSquareTerminal, IconLucideX, Menu, Tooltip, type MenuEntry,
} from '@aeven/client-ui-primitives'
import type { ContentSelectComponentProps } from './contract/slots.ts'
import type { SidebarSurfaceTab } from './registry.ts'
import { SIDEBAR_CONTENT_KINDS, type SidebarContentKind } from './selection.ts'
import {
  closeSurfaces, openSurface, readSurfaces, writeSurfaces, type SidebarSurface, type SurfaceState,
} from './surfaces.ts'
import css from './ContentSelect.module.css'

/** The glyph each kind's pill and launcher row carry. */
const GLYPHS: Record<SidebarContentKind, () => ReactNode> = {
  browser: () => <IconLucideGlobe />,
  terminal: () => <IconLucideSquareTerminal />,
  files: () => <IconLucideFiles />,
  device: () => <IconLucideSmartphone />,
}

/** The key that opens each kind from the launcher and the add menu. */
const SHORTCUTS: Record<SidebarContentKind, string> = {
  browser: 'B',
  terminal: 'T',
  files: 'F',
  device: 'M',
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
  const { sessionId, t, registry } = props
  // Keyed by session: the body slot re-renders this instance for whichever
  // session is current, so a set read for one session must not stand for the next.
  const [held, setHeld] = useState(() => ({ sessionId, state: readSurfaces(sessionId) }))
  const state = held.sessionId === sessionId ? held.state : readSurfaces(sessionId)
  const [tabs, setTabs] = useState<ReadonlyMap<string, SidebarSurfaceTab>>(new Map())
  const [addOpen, setAddOpen] = useState(false)
  const [pillMenu, setPillMenu] = useState<PillMenu | null>(null)
  // The session whose column is full screen; switching sessions leaves it.
  const [fullscreenSession, setFullscreenSession] = useState<string | null>(null)
  const fullscreen = fullscreenSession === sessionId
  // Providers register as their plugins mount, so availability is read live.
  useSyncExternalStore(callback => registry.subscribe(callback), () => registry.version)

  const update = useCallback((next: (current: SurfaceState) => SurfaceState) => {
    setHeld((current) => {
      const base = current.sessionId === sessionId ? current.state : readSurfaces(sessionId)
      const state = next(base)
      writeSurfaces(sessionId, state)
      return { sessionId, state }
    })
  }, [sessionId])

  const open = useCallback((kind: SidebarContentKind) => {
    if (registry.resolve(kind) === undefined) return
    update(current => openSurface(current, kind).state)
  }, [registry, update])
  const activate = useCallback((id: string) => { update(current => ({ ...current, active: id })) }, [update])
  const close = useCallback((ids: readonly string[]) => {
    update(current => closeSurfaces(current, new Set(ids)))
  }, [update])

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

  const titleOf = useCallback((surface: SidebarSurface): string =>
    tabs.get(surface.id)?.title ?? t(`${surface.kind}.tab`), [t, tabs])

  // A letter opens its kind while the add menu is up, as the launcher's rows advertise.
  useEffect(() => {
    if (!addOpen) return undefined
    const onKey = (event: KeyboardEvent) => {
      const kind = SIDEBAR_CONTENT_KINDS.find(entry => SHORTCUTS[entry] === event.key.toUpperCase())
      if (kind === undefined || event.metaKey || event.ctrlKey || event.altKey) return
      event.preventDefault()
      setAddOpen(false)
      open(kind)
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [addOpen, open])

  const addItems = useMemo<MenuEntry[]>(() => SIDEBAR_CONTENT_KINDS.map(kind => ({
    id: kind,
    icon: <span className={css.menuGlyph}>{GLYPHS[kind]()}</span>,
    label: (
      <span className={css.menuLabel}>
        <span>{t(`${kind}.tab`)}</span>
        <kbd className={css.shortcut}>{SHORTCUTS[kind]}</kbd>
      </span>
    ),
    disabled: registry.resolve(kind) === undefined,
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
      setFullscreenSession(null)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [fullscreen])
  const fullscreenLabel = fullscreen ? t('fullscreen.exit') : t('fullscreen.enter')

  return (
    <div className={css.root} data-sidebar-right-surfaces="" data-fullscreen={fullscreen || undefined}>
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
          {state.surfaces.length > 0 && (
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
          )}
        </div>
        {state.surfaces.length > 0 && (
          <Tooltip label={fullscreenLabel} side="bottom">
            <button
              type="button"
              className={css.fullscreen}
              aria-label={fullscreenLabel}
              aria-pressed={fullscreen}
              onClick={() => { setFullscreenSession(fullscreen ? null : sessionId) }}
            >
              {fullscreen ? <IconLucideMinimize2 /> : <IconLucideMaximize2 />}
            </button>
          </Tooltip>
        )}
      </div>

      <div className={css.body}>
        {state.surfaces.length === 0
          ? <Launcher t={t} available={kind => registry.resolve(kind) !== undefined} onOpen={open} />
          : state.surfaces.map((surface) => {
            const Pane = registry.resolve(surface.kind)
            const active = surface.id === state.active
            return (
              // Keyed by session too: pill ids repeat across sessions, and a pane
              // holding one session's state must never serve the next.
              <div key={`${sessionId}:${surface.id}`} className={css.pane} hidden={!active} data-sidebar-right-pane={surface.kind}>
                {Pane === undefined
                  ? <div className={css.unavailable}>{t('entry.unavailable')}</div>
                  : <Pane sessionId={sessionId} surfaceId={surface.id} active={active} setTab={setTabFor(surface.id)} />}
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
 * The empty column: every kind as a row with its key, the unavailable ones
 * listed but inert, so the column states what it can hold.
 */
function Launcher({ t, available, onOpen }: {
  t: ContentSelectComponentProps['t']
  available: (kind: SidebarContentKind) => boolean
  onOpen: (kind: SidebarContentKind) => void
}) {
  return (
    <div
      className={css.launcher}
      data-sidebar-right-select=""
      tabIndex={-1}
      onKeyDown={(event) => {
        const kind = SIDEBAR_CONTENT_KINDS.find(entry => SHORTCUTS[entry] === event.key.toUpperCase())
        if (kind === undefined || !available(kind)) return
        event.preventDefault()
        onOpen(kind)
      }}
    >
      <div className={css.launcherTitle}>{t('launcher.title')}</div>
      {SIDEBAR_CONTENT_KINDS.map(kind => (
        <button
          key={kind}
          type="button"
          className={css.launcherRow}
          data-sidebar-right-select-entry={kind}
          disabled={!available(kind)}
          title={available(kind) ? t(`${kind}.description`) : t('entry.unavailable')}
          onClick={() => { onOpen(kind) }}
        >
          <span className={css.launcherGlyph}>{GLYPHS[kind]()}</span>
          <span className={css.launcherLabel}>{t(`${kind}.tab`)}</span>
          <kbd className={css.shortcut}>{SHORTCUTS[kind]}</kbd>
        </button>
      ))}
    </div>
  )
}

/**
 * Horizontal overflow for the pill strip: vertical wheel scrolls it sideways,
 * each overflowing edge fades, and the shown pill scrolls into view.
 * @param active - the shown surface id, re-revealed when it changes.
 * @returns the strip ref and which edges fade.
 */
function useStripScroll(active: string | null) {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ fadeLeft: false, fadeRight: false })

  const measure = useCallback(() => {
    const strip = ref.current
    if (strip === null) return
    const overflow = strip.scrollWidth - strip.clientWidth > EDGE_TOLERANCE
    const fadeLeft = overflow && strip.scrollLeft > EDGE_TOLERANCE
    const fadeRight = overflow && strip.scrollLeft + strip.clientWidth < strip.scrollWidth - EDGE_TOLERANCE
    setEdges(current => current.fadeLeft === fadeLeft && current.fadeRight === fadeRight ? current : { fadeLeft, fadeRight })
  }, [])

  useEffect(() => {
    const strip = ref.current
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
  }, [measure])

  useEffect(() => {
    ref.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    measure()
  }, [active, measure])

  return { ref, ...edges }
}
