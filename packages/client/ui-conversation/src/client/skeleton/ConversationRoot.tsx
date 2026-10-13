// Resident conversation skeleton. Hero chrome, composer positioning, the
// chain, AND the composer bar stay mounted across no-session/session
// transitions and Session switches — the bar renders inert via owner props.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import clsx from 'clsx'
import { Button, HeroShell, Tooltip } from '@aeven/client-ui-primitives'
import type { SessionId } from '@aeven/session/types'
import type { ConversationSlotProps, InputZone } from '../contract/slots.ts'
import { useContentCover } from './content-cover.ts'
import { ContentLoader } from './ContentLoader.tsx'
import css from './ConversationRoot.module.css'

/** Full props composed from the slot contract. */
export type ConversationRootProps = ConversationSlotProps

/** Where the composer seat is laid out: the settling hold, the centred hero, or the settled floor. */
type ComposerPhase = 'settling' | 'hero' | 'active'

/** localStorage key for the dragged transcript width preference (px). */
const WIDTH_PREF_KEY = 'avn.conversation.contentWidth'
/** Floor for a dragged content width; matches the layout center-column minimum. */
const CONTENT_MIN = 640
/** Column budget the content must leave free: the 24px page inset per side,
 * which is where the width handles sit at the widest drag. Mirrors the CSS
 * clamp's `100%`, resolved inside that inset. */
const CONTENT_EDGE_BUDGET = 48

/** Reads the persisted width preference; durable-storage boundary, so a
 * missing or corrupt value resolves to "no preference".
 * @returns the stored width in px, or null when unset or invalid. */
function readWidthPreference(): number | null {
  const raw = localStorage.getItem(WIDTH_PREF_KEY)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** Clamps a dragged width the way the CSS clamp shows it.
 * @param columnWidth - the conversation column's rendered width in px.
 * @param width - the dragged width.
 * @returns the width in px between the floor and the column less its insets. */
function clampContentWidth(columnWidth: number, width: number): number {
  const max = Math.max(CONTENT_MIN, columnWidth - CONTENT_EDGE_BUDGET)
  return Math.min(Math.max(width, CONTENT_MIN), max)
}

/** The content width on screen now: the gap between the two handles, which
 * sit on the content's edges in the same frame the content resolves in.
 * @param root - the conversation root holding the handles.
 * @returns the rendered content width in px. */
function renderedContentWidth(root: HTMLElement): number {
  const left = root.querySelector('[data-width-handle="left"]')?.getBoundingClientRect()
  const right = root.querySelector('[data-width-handle="right"]')?.getBoundingClientRect()
  /* v8 ignore next -- both handles render with the root, so the lookup always resolves. */
  if (left === undefined || right === undefined) return CONTENT_MIN
  return right.left - left.right
}

/**
 * The navigation band's leading control: the left navigation column's fold
 * toggle. It is a child of the conversation's own bar rather than of the column
 * it folds, so it travels with the conversation — out as that column opens,
 * back as it closes — instead of leaving the column with no way back in.
 *
 * The label names the direction the control moves the column, which the frame
 * states as the owner share's fold state, so the reader reads what the press
 * will do rather than which column it is about.
 */
function NavFold(props: { label: string; expanded: boolean; onToggle: () => void }) {
  return (
    <div className={css.navFold}>
      <Tooltip label={props.label} side="bottom" anchor="icon">
        <button
          type="button"
          className={css.foldButton}
          aria-label={props.label}
          aria-expanded={props.expanded}
          onClick={props.onToggle}
        >
          {/* The product client's own sidebar toggle glyph, pasted from its
              markup: lucide `text-align-start` at a 2-stroke weight. */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={css.foldIcon}
          >
            <path d="M21 5H3" />
            <path d="M15 12H3" />
            <path d="M17 19H3" />
          </svg>
        </button>
      </Tooltip>
    </div>
  )
}

/** One transcript width handle: pointer capture + rAF-throttled symmetric
 * resize (both sides write the one centered width, so outward travel widens
 * by 2× the pointer distance). Mirrors ui-layout AppFrame's DragHandle
 * capture model. */
function WidthHandle(props: {
  side: 'left' | 'right'
  onStart: () => number
  onDrag: (width: number) => void
  onCommit: (width: number) => void
  onEnd: () => void
}) {
  const [dragging, setDragging] = useState(false)
  const base = useRef(0)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef(props)
  callbacks.current = props

  const outwardWidth = () => {
    const dx = latest.current - origin.current
    const outward = callbacks.current.side === 'right' ? dx : -dx
    return base.current + outward * 2
  }
  const cancelFrame = () => {
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
  }
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    base.current = callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(outwardWidth())
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    cancelFrame()
    latest.current = e.clientX
    // Only a gesture with actual travel commits: a press-and-release on a
    // window-clamped width must not overwrite the wider stored preference
    // with the clamped display value.
    if (latest.current !== origin.current) callbacks.current.onCommit(outwardWidth())
    setDragging(false)
    callbacks.current.onEnd()
  }, [])
  // The strips sit outside the scroller, so the wheel over them would scroll
  // nothing. It is handed to the transcript's scroller: re-dispatched first so
  // the scroller's own wheel listeners see the reader's intent, then applied,
  // because a synthetic wheel event never scrolls by itself. A View with a
  // composer overlay scrolls inside itself and marks that scroller
  // `data-conversation-view-scroll`; it wins over the non-scrolling body.
  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    // The handle's frame is a child of the conversation root, beside the scroller.
    const root = e.currentTarget.parentElement?.parentElement
    const scroller = root?.querySelector<HTMLElement>('[data-conversation-view-scroll]')
      ?? root?.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (scroller === null || scroller === undefined) return
    const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? scroller.clientHeight : 1
    scroller.dispatchEvent(new WheelEvent('wheel', {
      deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, bubbles: true,
    }))
    scroller.scrollBy({ top: e.deltaY * unit, left: 0 })
  }, [])
  // Releasing the button outside the window delivers pointercancel (or drops
  // the capture silently) instead of pointerup; without this the rule's
  // data-dragging state sticks on. The gesture is abandoned uncommitted —
  // onEnd republishes the stored preference. releasePointerCapture inside
  // onPointerUp also fires lostpointercapture, so this runs (idempotently)
  // after every normal drag end too; keep both paths.
  const onPointerCancel = useCallback(() => {
    cancelFrame()
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  return (
    <div
      className={css.widthHandle}
      data-side={props.side}
      data-width-handle={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onWheel={onWheel}
    />
  )
}

export function ConversationRoot({
  sessionId, useSession, useSessions, useSessionPendingInteraction,
  useInput, useComposerBlock, useSelectedView, useStartAddress, useArchivedSessionIds,
  renderSlot, renderSlotChain, t, sidebarCollapsed, toggleSidebar, composerPlaceholder, unarchiveSession,
}: ConversationRootProps) {
  const session = useSession(s => s)
  const pendingInteraction = useSessionPendingInteraction(snapshot =>
    sessionId === undefined ? undefined : snapshot.get(sessionId))
  const openState = session?.openState
  const inputState = useInput(s => s)
  const summaryBlank = useSessions(s => sessionId === undefined ? undefined : s.byId[sessionId]?.blank)
  const sessionsPending = useSessions(s => s.phase) === 'pending'
  // A plugin this package cannot import (ui-model-selection) says this session cannot
  // send; its reason is already localized by whoever raised it.
  const composerBlock = useComposerBlock(block => block)
  const composerOverlay = useSelectedView(view => view?.composerPlacement === 'overlay')
  const startAddress = useStartAddress(address => address)
  const archived = useArchivedSessionIds(ids => sessionId !== undefined && ids.includes(sessionId))

  // Nothing measures the composer seat. A View that floats a composer over its
  // own ledger clears it with the static `--avn-composer-height` fallback in
  // that View's own stylesheet (ui-trajectory's `.ledger`), so a draft that
  // grows past the fallback is not cleared exactly.

  // The column width is CSS's business now (the .root width axis reads the
  // AppFrame centre column's 100cqi), so nothing here observes resizes. The
  // element ref remains for the drag handles, which read geometry once per
  // gesture rather than once per frame.
  const rootEl = useRef<HTMLDivElement | null>(null)
  const seatRef = useRef<HTMLDivElement | null>(null)
  /* The seat's own top, kept from the last measured layout: the frame the hero
     hands over to the settled phase reads it to slide the card down. */
  const heroTop = useRef<number | null>(null)
  /* The phase and Session that laid that top out. The hand-over the slide below
     serves is one chat leaving its hero for its own floor, so a top recorded
     under another chat's hero, or under a start page, is not a hand-over. */
  const lastSeat = useRef<{ phase: ComposerPhase; sessionId: SessionId | undefined } | null>(null)
  // The stored preference, mirrored into the DOM so CSS can clamp it against
  // the live column. Written on mount and on a committed drag only.
  const [userWidth, setUserWidth] = useState<number | null>(() => readWidthPreference())

  // Drag plumbing for the two width handles: onStart snapshots the resolved
  // width (grabbing a clamped column must not jump back to the raw stored
  // preference), onDrag publishes only the live clamped style, onCommit
  // persists the width of a gesture that actually travelled, and onEnd
  // republishes from storage — an uncommitted press leaves the stored
  // preference untouched.
  const onHandleStart = useCallback((): number => {
    const root = rootEl.current
    /* v8 ignore next -- handles render inside the root, so the ref is always attached. */
    if (root === null) return CONTENT_MIN
    return clampContentWidth(root.offsetWidth, renderedContentWidth(root))
  }, [])
  const onHandleDrag = useCallback((width: number): void => {
    const root = rootEl.current
    /* v8 ignore next -- handles render inside the root, so the ref is always attached. */
    if (root === null) return
    const clamped = clampContentWidth(root.offsetWidth, width)
    root.style.setProperty('--avn-chat-user-width', `${clamped}px`)
  }, [])
  const onHandleCommit = useCallback((width: number): void => {
    const root = rootEl.current
    /* v8 ignore next -- handles render inside the root, so the ref is always attached. */
    if (root === null) return
    const committed = clampContentWidth(root.offsetWidth, width)
    localStorage.setItem(WIDTH_PREF_KEY, `${committed}`)
    setUserWidth(committed)
  }, [])
  const onHandleEnd = useCallback((): void => {
    const root = rootEl.current
    const stored = readWidthPreference()
    setUserWidth(stored)
    // An uncommitted press leaves the stored preference untouched: drop the
    // live style so the attribute-selected rule reads the stored value again.
    if (root !== null && stored === null) root.style.removeProperty('--avn-chat-user-width')
  }, [])

  // A restored continuable subagent stays settled until its eagerly loaded
  // parent catalog establishes availability, so the composer does not flash
  // the parent-offline takeover.
  const parentAvailabilityPending = session?.subagent?.address.mode === 'continuable'
    && session.subagent.parentAvailable === undefined
  // Hero vs docked is a list fact, not a Session/Conversation read. The list
  // already knows whether the selected Session is blank; waiting on those
  // snapshots flashes the centered empty composer over the docked bar on
  // every switch. A pending list with nothing selected still settles so a
  // restored Session is not painted as the cold-start hero. An empty ready
  // list is the genuine cold start.
  const settling = (sessionId === undefined && sessionsPending) || parentAvailabilityPending
  const hero = sessionId === undefined
    || (summaryBlank === true && session?.promptAttempted !== true)
    || (summaryBlank === undefined && session?.blank === true && !session.promptAttempted
      && (openState === 'open' || openState === 'error' || openState === 'cold'))
  // A start page replaces the blank Session's centred Hero: its own content
  // fills the column and the composer sits on the floor, as in a settled chat.
  const startPage = hero && startAddress !== undefined && sessionId !== undefined
  const centered = hero && !startPage
  // A start page names what its own composer is for, in its own words; read on
  // every render so the page's copy follows the active locale.
  const startPlaceholder = startAddress === undefined
    ? undefined
    : composerPlaceholder?.(startAddress)
  const zone: InputZone | undefined =
    session === undefined || inputState === undefined ? undefined : { session, input: inputState }

  // Inert is the settling posture, not a prompt to choose anything: the Hero no
  // longer carries a workspace row, so the only way to be inert is to have no
  // Session yet, which the boot-time Workspace connect resolves on its own. The
  // bar is ONE session-maybe slot rendered unconditionally — inert is a prop,
  // not a different tree, so the textarea DOM survives the transition.
  // A selected Session always accepts input: one whose Workspace is unknown, such as a blank chat of a
  // Workspace just deleted, is replaced by a Chats session through navigation rather than frozen here.
  const inert = sessionId === undefined
  // A raised block is the same inert posture with the blocker's own reason:
  // one disabled textarea, never a second tree.
  const blocked = !inert && composerBlock !== undefined
  const inputBar = renderSlot('conversation.composer.bar', {
    variant: centered ? 'hero' : 'composer',
    ...(inert
      // The placeholder names what the reader is about to do rather than an
      // action they are missing: with a built-in workspace there is nothing to
      // choose, and offering a picker here would be a prompt with no subject.
      ? { disabled: true, placeholder: t('placeholder.hero') }
      : blocked
        // `blocked`, not `disabled`: the bar refuses input either way, but a
        // block keeps the model seat live because choosing a model is how the
        // user clears it.
        ? { blocked: composerBlock, placeholder: composerBlock.reason }
        : hero ? { placeholder: startPlaceholder ?? t('placeholder.hero') } : {}),
  })

  const composerBar = (
    <div className={clsx(css.composerStack, centered && css.composerHero)}>
      {centered && <HeroShell t={t} />}
      {zone !== undefined && (
        <div className={css.dockFrame}>
          <div className={css.dockStack}>{renderSlot('conversation.input.dock', zone)}</div>
        </div>
      )}
      {inputBar}
    </div>
  )

  // An archived Session reads only: the bar in the composer's place says so and
  // offers the way back, after which the Session continues as before.
  const archivedBar = (
    <div className={css.archivedFrame}>
      <div className={css.archivedBar} role="status">
        <span>{t('archived.body')}</span>
        {unarchiveSession !== undefined && (
          <Button variant="primary" size="sm" onClick={unarchiveSession}>{t('archived.unarchive')}</Button>
        )}
      </div>
    </div>
  )

  const phase: ComposerPhase = settling ? 'settling' : centered ? 'hero' : 'active'
  const composer = renderSlotChain(
    'conversation.composer',
    { sessionId, session, pendingInteraction },
    {
      fallback: archived ? archivedBar : composerBar,
      fallbackOnly: sessionId === undefined,
      overlay: true,
    },
  )

  // Sticky wraps the whole chain output (fallback + elected overlay), not
  // only `.composerStack`: overlay:true renders those as siblings, and sticky
  // on the fallback alone would leave a business-owned takeover at the content
  // end off-screen when the user is not pinned to the floor.
  const composerSeat = (
    <div ref={seatRef} className={css.composerSeat} data-composer-seat="">
      <div className={css.viewChromeTop} data-conversation-chrome-top="" />
      {composer}
    </div>
  )

  const { loaderActive, mountedSessionId } = useContentCover({ sessionId, hero, openState })

  // The seat's own height, published for the two rules that hold the composer on
  // the scroller's floor (`.viewArea`'s hold and `.viewChrome`'s floor). A
  // constant cannot track it: the seat is shorter once the hero's chip row is
  // gone, and the difference showed as the card floating above its 24px inset.
  // Written only when the measured height moves, so a draft that re-wraps does
  // not invalidate the transcript's style on every frame.
  useEffect(() => {
    const root = rootEl.current
    const seat = seatRef.current
    if (root === null || seat === null || typeof ResizeObserver === 'undefined') return
    let published = -1
    const publish = (): void => {
      const box = seat.getBoundingClientRect()
      heroTop.current = box.top
      if (Math.abs(box.height - published) < 0.5) return
      published = box.height
      root.style.setProperty('--avn-composer-seat-height', `${String(box.height)}px`)
    }
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(seat)
    return () => { observer.disconnect() }
  }, [])

  // The hero centres the seat and the settled phase puts it on the scroller's
  // floor: a layout jump between two phases, which the `settling` phase used to
  // hide outright. Record where the seat sat, then play the difference back as a
  // transform that returns to zero, so the card slides into place instead — but
  // only for the hero handing over to its own chat's floor: a start page
  // replacing the hero, another chat's transcript opening, and the settling hold
  // are navigation, and those land the seat where it belongs.
  useLayoutEffect(() => {
    const seat = seatRef.current
    if (seat === null) return
    const top = seat.getBoundingClientRect().top
    const from = heroTop.current
    const previous = lastSeat.current
    lastSeat.current = { phase, sessionId }
    heroTop.current = top
    if (phase !== 'active' || startPage || from === null
      || previous?.phase !== 'hero' || previous.sessionId !== sessionId) return
    const delta = from - top
    if (Math.abs(delta) < 1) return
    seat.style.transition = 'none'
    seat.style.transform = `translateY(${String(delta)}px)`
    requestAnimationFrame(() => {
      seat.style.transition = ''
      seat.style.transform = ''
    })
  }, [phase, sessionId, startPage])

  return (
    <div
      ref={rootEl}
      className={css.root}
      data-conversation-root=""
      data-phase={phase}
      data-composer-overlay={composerOverlay || undefined}
      data-chat-user-width={userWidth === null ? undefined : ''}
      style={userWidth === null ? undefined : { '--avn-chat-user-width': `${String(userWidth)}px` } as CSSProperties}
    >
      <ContentLoader
        active={loaderActive}
        label={t('content.loading')}
      />
      {/* One scroller for the whole column. Header, transcript and composer are
          all its children, so each is laid out inside the same content box and
          the three centre on one axis by construction, with nothing to
          compensate. The bar is hidden (ui-theme's `no-scrollbar`), so no
          gutter is reserved either; the reservation that used to align them
          needed `scrollbar-gutter`, which the iOS/Safari 14.5 baseline bans
          ([gate](../../../../../../scripts/verify-css-baseline.ts)). */}
      <div className={clsx(css.scrollBody, 'no-scrollbar')} data-conversation-scroll="">
        {/* The navigation band is resident, like the composer below it: the
            bar, its blur background, and the right-aligned utilities row
            belong to the column rather than to a Session, so a reader sees the
            same chrome — the account avatar among it — whether or not one is
            open. Only the Session header's own content (crumbs, View tabs,
            Session actions) is gated on a Session. */}
        <header
          className={css.header}
          data-nav-fold={toggleSidebar !== undefined || undefined}
          data-sidebar-open={sidebarCollapsed === false || undefined}
        >
          <div className={css.navBackground} aria-hidden="true">
            <div className={css.navFade} />
          </div>
          {toggleSidebar === undefined ? null : (
            <NavFold
              label={t(sidebarCollapsed ? 'nav.open' : 'nav.close')}
              expanded={!sidebarCollapsed}
              onToggle={toggleSidebar}
            />
          )}
          {sessionId === undefined ? null : renderSlot('conversation.session.header', {})}
          <div className={css.navigationUtilities}>
            {renderSlot('conversation.navigation.utilities', {})}
          </div>
        </header>
        {/* This hold keeps the scrollport's growing item present while
            conversation.session is dropped so the overlay can present. */}
        {startPage
          ? <div className={css.startPage} data-start-page="">{renderSlot('conversation.start', {}, { entryKey: startAddress! })}</div>
          : mountedSessionId === undefined
          ? (phase === 'active'
            ? <div className={css.transcriptHold} data-transcript-hold="" aria-hidden="true" />
            : null)
          : renderSlot('conversation.session', {})}
        {composerSeat}
      </div>
      {/* The view chrome layer sits OUTSIDE the scroller, positioned against
          the root: a layer among the scrolled children is placed by its own
          spot in the flow and travels with it, and it would extend the
          scrollable range. It spans the band above the composer; the
          seat-level layer lives inside the seat instead (see `.viewChromeTop`).
          The scroller reserves no gutter, so both keep the transcript's axis. */}
      <div className={css.viewChrome} data-conversation-chrome="" />
      {/* Width handles whenever a Session is settled, the hero included: a new
          chat sizes the same column its composer and later transcript use.
          Outside the scroller: inside it they would extend the scrollable
          range and ride the rubber-band. */}
      {phase !== 'settling' && (
        <div className={css.widthHandles}>
          {(['left', 'right'] as const).map(side => (
            <WidthHandle
              key={side}
              side={side}
              onStart={onHandleStart}
              onDrag={onHandleDrag}
              onCommit={onHandleCommit}
              onEnd={onHandleEnd}
            />
          ))}
        </div>
      )}
    </div>
  )
}
