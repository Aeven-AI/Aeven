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
  IconLucideFolderSearch, IconLucideGlobe, IconLucidePlus, IconLucideTabletSmartphone, IconLucideX,
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

/**
 * The terminal kind's mark: the drawn `ic_ds` bash glyph — a rounded square
 * holding a chevron over a short rule — transcribed onto the lucide 24-unit
 * canvas the marks beside it are drawn on. Its artwork is scaled to the 20 units
 * those marks occupy of that canvas, so the kind matches their size; its own
 * 1.18091-unit border then renders at 1.40px against the stock 1.75 stroke's
 * 1.31px, in place of the 1.52px the drawn 14-unit canvas gives when the CSS box
 * scales it to 18px. The translate centres the result the way the stock canvas'
 * padding centres lucide's artwork (the treatment ui-primitives'
 * IconPanelRightOutline documents for the same drawn set).
 */
function BashGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(0.94351 0.94296) scale(1.57944)">
        <path transform="translate(0.6689 1.073)" d="M11.4818 5.57813C11.4818 4.45301 11.4807 3.66237 11.4075 3.05908C11.3359 2.46953 11.2024 2.13852 10.9939 1.89441C10.9247 1.81341 10.8493 1.73801 10.7683 1.66882C10.5242 1.46033 10.1932 1.32686 9.60364 1.25525C9.00034 1.18198 8.20974 1.18091 7.0846 1.18091L5.57813 1.18091C4.45301 1.18091 3.66238 1.18198 3.05908 1.25525C2.46953 1.32686 2.13852 1.46033 1.89441 1.66882C1.81341 1.73801 1.73801 1.81341 1.66882 1.89441C1.46033 2.13852 1.32686 2.46953 1.25525 3.05908C1.18198 3.66238 1.18091 4.45301 1.18091 5.57813L1.18091 6.2771C1.18091 7.40218 1.18197 8.19288 1.25525 8.79614C1.32687 9.38553 1.46036 9.71674 1.66882 9.96082C1.73797 10.0417 1.81347 10.1173 1.89441 10.1864C2.13851 10.3948 2.46965 10.5275 3.05908 10.5991C3.66238 10.6724 4.45298 10.6735 5.57813 10.6735L7.0846 10.6735C8.20977 10.6735 9.00033 10.6724 9.60364 10.5991C10.1931 10.5275 10.5242 10.3948 10.7683 10.1864C10.8493 10.1173 10.9247 10.0417 10.9939 9.96082C11.2024 9.71674 11.3358 9.38553 11.4075 8.79614C11.4808 8.19288 11.4818 7.40218 11.4818 6.2771L11.4818 5.57813ZM12.6627 6.2771C12.6627 7.37222 12.6637 8.247 12.5798 8.93799C12.4942 9.64284 12.3133 10.2359 11.8928 10.7282C11.7834 10.8562 11.6637 10.9751 11.5356 11.0845C11.0434 11.5049 10.4511 11.6867 9.74634 11.7723C9.05525 11.8563 8.17999 11.8552 7.0846 11.8552L5.57813 11.8552C4.48273 11.8552 3.60747 11.8563 2.91638 11.7723C2.21157 11.6867 1.61933 11.5049 1.12708 11.0845C0.99901 10.9751 0.879281 10.8562 0.769898 10.7282C0.349454 10.2359 0.168506 9.64284 0.0828864 8.93799C-0.00101964 8.247 4.88512e-07 7.37222 6.47206e-07 6.2771L6.47206e-07 5.57813C6.47206e-07 4.48273 -0.00106163 3.60747 0.0828864 2.91638C0.168502 2.21168 0.349594 1.61928 0.769898 1.12708C0.879302 0.998981 0.998981 0.879302 1.12708 0.769898C1.61928 0.349594 2.21168 0.168502 2.91638 0.0828864C3.60747 -0.00106163 4.48273 6.47206e-07 5.57813 6.47206e-07L7.0846 6.47206e-07C8.17999 6.47206e-07 9.05525 -0.00106163 9.74634 0.0828864C10.451 0.168505 11.0434 0.349587 11.5356 0.769898C11.6637 0.879302 11.7834 0.998981 11.8928 1.12708C12.3131 1.61928 12.4942 2.21169 12.5798 2.91638C12.6638 3.60747 12.6627 4.48273 12.6627 5.57813L12.6627 6.2771Z" fill="currentColor"/>
        <path transform="translate(0.6689 1.073)" d="M6.02607 5.50955L6.44306 5.9274L3.84284 8.52762L3.425 8.11063L3.00715 7.69278L4.77253 5.9274L3.00715 4.16202L3.84284 3.32633L6.02607 5.50955Z" fill="currentColor"/>
        <path transform="translate(0.6689 1.073)" d="M9.23789 7.35397L9.23789 8.53488L6.96238 8.53488L6.96238 7.35397L9.23789 7.35397Z" fill="currentColor"/>
      </g>
    </svg>
  )
}

/** The glyph each kind's pill and launcher row carry. The terminal takes the
 * bash mark the transcript's own shell rows carry, so one kind reads the same
 * in the sidebar as it does in the conversation. */
const GLYPHS: Record<SidebarContentKind, () => ReactNode> = {
  browser: () => <IconLucideGlobe />,
  terminal: () => <BashGlyph />,
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
  const { sessionId, t, registry, fullscreen: fullscreenState, openRightbar } = props
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
    update(current => openSurface(current, kind).state)
  }, [registry, sessionId, update])
  const activate = useCallback((id: string) => { update(current => ({ ...current, active: id })) }, [update])
  const close = useCallback((ids: readonly string[]) => {
    const closing = new Set(ids)
    registry.closed(sessionId, state.surfaces.filter(surface => closing.has(surface.id)))
    update(current => closeSurfaces(current, closing))
  }, [registry, sessionId, state.surfaces, update])

  useEffect(() => {
    const kind = registry.takeOpenRequest(sessionId)
    if (kind === undefined) return
    update(current => {
      const existing = current.surfaces.find(surface => surface.kind === kind)
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

  const addItems = useMemo<MenuEntry[]>(() => availableKinds(registry).map(kind => ({
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
            className={clsx(css.strip, strip.fadeRight && css.fadeRight)}
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
                  : <Pane sessionId={sessionId} surfaceId={surface.id} active={active} setTab={setTabFor(surface.id)} closeSurface={() => { close([surface.id]) }} />}
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
  const [fadeRight, setFadeRight] = useState(false)

  const measure = useCallback(() => {
    if (strip === null) return
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

  return { ref, fadeRight }
}
