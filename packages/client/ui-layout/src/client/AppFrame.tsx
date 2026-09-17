/**
 * Three-column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the flex row (sidebar | center | details),
 * the drag handles (pointer capture + rAF throttle), and the child-slot render
 * decisions: the sidebar slot renders HERE with its stored width, and the
 * session-aware occupants render in fixed column positions; strict entries
 * gate themselves on current-session availability while session-maybe
 * entries retain identity. Pure component: everything arrives
 * through the three framework shares — zero cordis or framework imports,
 * zero self-made hooks.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type {
  PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@aeven/client-ui-slots'
import {
  clampWidth, DETAILS_MAX, DETAILS_MIN, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'
import { DocumentTitle } from './DocumentTitle.tsx'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

/**
 * The Aeven client's `responsiveMed` rule verbatim. Its `responsiveMax` mixin
 * is an inclusive `max-width`, so the breakpoint width itself is narrow.
 */
const NARROW_QUERY = `screen and (max-width: ${String(SIDEBAR_AUTO_COLLAPSE)}px)`

/**
 * The breakpoint list, or `undefined` where the runtime has no `matchMedia`.
 * jsdom implements none, and the assembled web lane boots this tree there, so
 * an unguarded call crashes the 'root' slot before the shell renders. Absent
 * the API the frame stays wide, which is the three-column layout it defaults to.
 * @returns the live `MediaQueryList`, or `undefined` without `matchMedia`.
 */
function matchNarrow(): MediaQueryList | undefined {
  return typeof window.matchMedia === 'function' ? window.matchMedia(NARROW_QUERY) : undefined
}

/** Full composed props: runtime share + child-slot render share + store share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'common'>

/** Center column grid item (session-body building block). */
function CenterColumn(props: { children?: ReactNode }) {
  return <div className={css.centerCol}>{props.children}</div>
}

/** Details column flex item; the CSS width reaches 0 on close, keeping the subtree mounted. */
function DetailsColumn(props: { children?: ReactNode }) {
  return <div className={css.detailsCol}>{props.children}</div>
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: { side: 'sidebar' | 'details'; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  return (
    <div
      className={css.handle}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}

/** The three-column frame (see module doc). */
export function AppFrame({
  useStore,
  useSessions,
  actions,
  renderSlot,
  SessionProvider,
  t,
}: AppFrameProps) {
  const panels = useStore(s => s)
  const detailsSession = useSessions((s) => {
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })
  const documentTitle = useSessions((s) => {
    const current = s.current
    return current === undefined ? undefined : s.byId[current]?.title
  })
  const [narrow, setNarrow] = useState(() => matchNarrow()?.matches ?? false)

  const lastSession = useRef(detailsSession)
  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) {
      actions.closeDetails()
    }
    lastSession.current = detailsSession
  }, [actions, detailsSession])

  // The breakpoint is the only viewport fact the shell needs, and it changes
  // when it is crossed rather than while a column animates. A media query says
  // that directly; measuring the frame instead reported every intermediate
  // width of every slide, which is what the Aeven client avoids by keeping the
  // whole responsive rule set in CSS.
  useEffect(() => {
    const query = matchNarrow()
    if (query === undefined) return
    const read = (): void => { setNarrow(query.matches) }
    read()
    query.addEventListener('change', read)
    return () => { query.removeEventListener('change', read) }
  }, [])

  // Narrow viewports auto-collapse the sidebar; the store mirror keeps
  // toggleSidebar's semantics right (narrow toggles flip the manual
  // re-expand override, stores.ts).
  useEffect(() => { actions.setNarrow(narrow) }, [actions, narrow])
  const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
  const sidebarWidth = sidebarCollapsed
    ? 0
    : panels.sidebar === 0 ? SIDEBAR_DEFAULT : clampWidth(panels.sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  const detailsWidth = detailsSession === undefined || panels.details === 0
    ? 0
    : clampWidth(panels.details, DETAILS_MIN, DETAILS_MAX)
  const detailsRef = useRef(detailsWidth)
  detailsRef.current = detailsWidth

  // The drag base is the width in force at drag start, frozen for the whole
  // gesture so dx deltas do not compound.
  const detailsBase = useRef(0)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onDetailsStart = useCallback(() => { detailsBase.current = detailsRef.current; setDragging(true) }, [])
  const onDetailsDrag = useCallback((dx: number) => {
    actions.setDetails(detailsBase.current - dx)
  }, [actions])
  const productTitle = process.env.AVN_CLIENT_TITLE ?? t('brand.localBuild')

  return (
    <div
      className={css.frame}
      style={{
        '--avn-frame-details-width': `${String(detailsWidth)}px`,
      } as CSSProperties}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={detailsWidth === 0 || undefined}
      data-dragging={dragging || undefined}
      data-fullscreen={panels.fullscreen || undefined}
    >
      <DocumentTitle
        productTitle={productTitle}
        {...documentTitle === undefined ? {} : { title: documentTitle }}
      />
      {/* The sidebar root is the flex item. Its width change lays out the
          center once; the sidebar owns its visual transition. */}
      {renderSlot('sidebar', {
        collapsed: sidebarCollapsed,
        width: sidebarWidth,
      })}
      <>
        {/* Both column occupants stay at fixed tree positions from first
            paint — no loading gate: a bare status line reads worse than
            the shell's own pending rendering. The conversation
            is session-maybe; SessionProvider withholds the strict details
            entry while no session is current. */}
        <CenterColumn>{renderSlot('conversation', {})}</CenterColumn>
        <DetailsColumn>
          <SessionProvider>{renderSlot('details', {})}</SessionProvider>
        </DetailsColumn>
      </>
      <div className={css.overlayLayer} data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
      {/* Details is the only draggable column; the sidebar width is a stored
          preference. */}
      {detailsWidth > 0 && <DragHandle side="details" onStart={onDetailsStart} onDrag={onDetailsDrag} onEnd={onDragEnd} />}
    </div>
  )
}
