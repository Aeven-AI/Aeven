/**
 * Four-column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the flex row
 * (sidebar | center | details | rightbar),
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
  HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@aeven/client-ui-slots'
import {
  CENTER_MIN, clampRightbar, clampWidth, DETAILS_MAX, DETAILS_MIN, SIDEBAR_AUTO_COLLAPSE,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
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

/** The root entry's injected share: the surface router as a hook source. */
export type AppFrameInjected = {
  hooks: {
    /** Id of the surface owning the current path; undefined leaves the column to the conversation. */
    surface: HostObservable<string | undefined>
  }
}

/** Full composed props: runtime share + child-slot render share + store share + injected share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'surface' | 'details' | 'rightbar' | 'shell.overlay' | 'shell.corner'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'common'>
  & InjectFace<AppFrameInjected>

/** Center column grid item (session-body building block). */
function CenterColumn(props: { children?: ReactNode }) {
  return <div className={css.centerCol}>{props.children}</div>
}

/** Details column flex item; the CSS width reaches 0 on close, keeping the subtree mounted. */
function DetailsColumn(props: { children?: ReactNode }) {
  return <div className={css.detailsCol}>{props.children}</div>
}

/** Right sidebar column flex item; like details, it closes to zero width mounted. */
function RightbarColumn(props: { children?: ReactNode }) {
  return <div className={css.rightbarCol}>{props.children}</div>
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: { side: 'sidebar' | 'details' | 'rightbar'; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
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
  // A gesture the browser takes away (a system drag, a lost capture) never
  // reaches pointerup. Without this the column stays frozen in its dragging
  // state, holding its transition suspended with no pointer down.
  const onPointerCancel = useCallback(() => {
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
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
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
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
  useSurface,
  t,
}: AppFrameProps) {
  const panels = useStore(s => s)
  // A surface page replaces the conversation; the details and right sidebar
  // columns belong to the current chat Session, so they read as closed
  // while it shows, and reopen at their stored state when the reader
  // returns to the chat.
  const surface = useSurface(s => s)
  const onSurface = surface !== undefined
  const currentSession = useSessions((s) => {
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })
  // The right sidebar follows the current session whether or not it has been
  // written to. A blank session still has a header to open the panel from, and
  // its control writes under this id; `currentSession` above is narrower
  // because the details column needs a session with a transcript to inspect.
  const rightbarSession = useSessions(s => s.current)
  const sessionTitle = useSessions((s) => {
    const current = s.current
    return current === undefined ? undefined : s.byId[current]?.title
  })
  const documentTitle = onSurface ? undefined : sessionTitle
  const [narrow, setNarrow] = useState(() => matchNarrow()?.matches ?? false)
  const [viewport, setViewport] = useState(() => typeof window === 'undefined' ? 0 : window.innerWidth)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const lastSession = useRef(currentSession)
  useLayoutEffect(() => {
    if (currentSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== currentSession) {
      actions.closeDetails()
    }
    lastSession.current = currentSession
  }, [actions, currentSession])

  // The breakpoint changes when it is crossed rather than while a column
  // animates. A media query says that directly; measuring the frame instead
  // reported every intermediate width of every slide, which is what the Aeven
  // client avoids by keeping the whole responsive rule set in CSS.
  useEffect(() => {
    const query = matchNarrow()
    if (query === undefined) return
    const read = (): void => { setNarrow(query.matches) }
    read()
    query.addEventListener('change', read)
    return () => { query.removeEventListener('change', read) }
  }, [])

  // The frame spans the window, so the window's width is the frame's; reading
  // the window rather than the frame keeps column slides out of it. It feeds
  // the right sidebar's clamp and the overlay decision below; a resize is
  // coalesced to one read per animation frame.
  useEffect(() => {
    let frame: number | null = null
    const onResize = (): void => {
      frame ??= requestAnimationFrame(() => {
        frame = null
        setViewport(window.innerWidth)
      })
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [])

  // Narrow viewports auto-collapse the sidebar; the store mirror keeps
  // toggleSidebar's semantics right (narrow toggles flip the manual
  // re-expand override, stores.ts).
  useEffect(() => { actions.setNarrow(narrow) }, [actions, narrow])
  const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
  const sidebarWidth = sidebarCollapsed
    ? 0
    : panels.sidebar === 0 ? SIDEBAR_DEFAULT : clampWidth(panels.sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  const detailsWidth = onSurface || currentSession === undefined || panels.details === 0
    ? 0
    : clampWidth(panels.details, DETAILS_MIN, DETAILS_MAX)
  const detailsRef = useRef(detailsWidth)
  detailsRef.current = detailsWidth

  // Whether this session shows the panel is the session's own; how wide it is
  // is the reader's, shared by every session. So switching sessions opens or
  // closes the column, and never resizes it.
  //
  // The width is re-clamped here rather than trusted: the store's actions
  // clamp every write, but a restored one entered the state without passing
  // through them, and the window it was stored from may have been wider than
  // this one. Clamping on the way out keeps a reload from opening a panel
  // wider than the frame it reopens in.
  const rightbarShown = !onSurface && rightbarSession !== undefined && panels.rightbar[rightbarSession]?.shown === true
  // The width the column opens at, published even while it is collapsed, so
  // its content keeps that layout through the slide instead of re-wrapping.
  const rightbarOpenWidth = clampRightbar(panels.rightbarWidth, viewport)
  const rightbarWidth = rightbarShown ? rightbarOpenWidth : 0
  // The right sidebar overlays the conversation rather than taking a column
  // beside it wherever a column would leave the conversation under its floor;
  // below the breakpoint every right-hand panel overlays. Decided from the open
  // width, not the shown one, so a closing panel keeps its mode for the slide.
  const rightbarOverlay = narrow || viewport - sidebarWidth - detailsWidth - rightbarOpenWidth < CENTER_MIN
  const rightbarRef = useRef(rightbarWidth)
  rightbarRef.current = rightbarWidth

  // A Session switch redraws the side columns at the geometry that Session was
  // left at. That is a different layout, not a movement within one, so the
  // columns take it without a transition: eased, the panel slides between two
  // readers' widths and the transcript reflows behind it for the whole curve.
  // The flag lasts one commit — cleared in the effect below, after the frame
  // that carried the new widths has been painted with transitions suppressed.
  const [switching, setSwitching] = useState(false)
  const lastRightbarSession = useRef(rightbarSession)
  if (lastRightbarSession.current !== rightbarSession) {
    lastRightbarSession.current = rightbarSession
    if (!switching) setSwitching(true)
  }
  useLayoutEffect(() => {
    if (!switching) return
    // Two frames: the first paints the new widths under the suppression, the
    // second restores easing for the reader's own subsequent gestures.
    const frame = requestAnimationFrame(() => { setSwitching(false) })
    return () => { cancelAnimationFrame(frame) }
  }, [switching])

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

  // The clamp range depends on the frame width, which is read once per gesture
  // rather than tracked: a resize cannot happen mid-drag, so re-measuring on
  // every move would buy nothing and put a layout read on the pointer path.
  const rightbarBase = useRef(0)
  const rightbarFrame = useRef(0)
  const onRightbarStart = useCallback(() => {
    rightbarBase.current = rightbarRef.current
    rightbarFrame.current = frameRef.current?.getBoundingClientRect().width ?? 0
    setDragging(true)
  }, [])
  // The drag names no session: the width it writes is the reader's, and every
  // session's panel opens at it.
  const onRightbarDrag = useCallback((dx: number) => {
    actions.setRightbar(rightbarBase.current - dx, rightbarFrame.current)
  }, [actions])
  const productTitle = process.env.AVN_CLIENT_TITLE ?? t('brand.localBuild')

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{
        '--avn-frame-details-width': `${String(detailsWidth)}px`,
        '--avn-frame-rightbar-width': `${String(rightbarWidth)}px`,
        '--avn-frame-rightbar-open-width': `${String(rightbarOpenWidth)}px`,
      } as CSSProperties}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={detailsWidth === 0 || undefined}
      data-rightbar-collapsed={rightbarWidth === 0 || undefined}
      data-rightbar-overlay={rightbarOverlay || undefined}
      data-dragging={dragging || undefined}
      data-switching={switching || undefined}
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
        <CenterColumn>
          {surface === undefined ? renderSlot('conversation', { sidebarCollapsed }) : renderSlot('surface', {}, { entryKey: surface })}
        </CenterColumn>
        {/* Shown only while the right sidebar lays over the conversation
            instead of beside it (AppFrame.module.css). */}
        <div
          className={css.overlayBlocker}
          aria-hidden="true"
          onClick={() => { if (rightbarShown && rightbarSession !== undefined) actions.toggleRightbar(rightbarSession, viewport) }}
        />
        <DetailsColumn>
          <SessionProvider>{renderSlot('details', {})}</SessionProvider>
        </DetailsColumn>
        <RightbarColumn>
          <SessionProvider>
            {renderSlot('rightbar', { collapsed: rightbarWidth === 0, width: rightbarWidth })}
          </SessionProvider>
        </RightbarColumn>
      </>
      {/* The Session cover's box, laid out against the frame so it spans every
          column right of the sidebar. ui-conversation owns when it is covered
          and renders into this node; the frame owns only where it sits. */}
      <div className={css.coverLayer} data-shell-cover />
      {/* The corner is laid out against the frame, so the columns move under
          it and its occupants hold one place on screen. It reserves the right
          sidebar's own toggle width when that column is closed, which is the
          gutter the panel's chrome occupies once it is open. */}
      <div className={css.cornerDock} data-shell-corner>
        {renderSlot('shell.corner', { rightbarCollapsed: rightbarWidth === 0 })}
      </div>
      <div className={css.overlayLayer} data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
      {/* The two right-hand columns carry handles; the sidebar width is a
          stored preference with no gesture. */}
      {detailsWidth > 0 && <DragHandle side="details" onStart={onDetailsStart} onDrag={onDetailsDrag} onEnd={onDragEnd} />}
      {rightbarWidth > 0 && <DragHandle side="rightbar" onStart={onRightbarStart} onDrag={onRightbarDrag} onEnd={onDragEnd} />}
    </div>
  )
}
