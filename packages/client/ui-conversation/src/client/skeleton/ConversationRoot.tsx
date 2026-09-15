// Resident conversation skeleton. Hero chrome, composer positioning, the
// chain, AND the composer bar stay mounted across no-session/session
// transitions and Session switches — the bar renders inert via owner props.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import clsx from 'clsx'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { ConversationSlotProps, InputZone } from '../contract/slots.ts'
import { useContentCover } from './content-cover.ts'
import { ContentLoader } from './ContentLoader.tsx'
import { HeroShell, WorkspaceChip, workspaceLabel } from './EmptyHero.tsx'
import css from './ConversationRoot.module.css'

/** Full props composed from the slot contract. */
export type ConversationRootProps = ConversationSlotProps

/** localStorage key for the dragged transcript width preference (px). */
const WIDTH_PREF_KEY = 'dsh.conversation.contentWidth'
/** Floor for a dragged content width; matches the layout center-column minimum. */
const CONTENT_MIN = 640
/** Column budget the content must leave free: 88px per side keeps the width
 * handles fully placeable (24px inset + 40px strip + 24px safe zone) — a
 * larger dragged width would push its own handles off the column and leave no
 * way to drag back. */
const CONTENT_EDGE_BUDGET = 176

/** Reads the persisted width preference; durable-storage boundary, so a
 * missing or corrupt value resolves to "no preference".
 * @returns the stored width in px, or null when unset or invalid. */
function readWidthPreference(): number | null {
  const raw = localStorage.getItem(WIDTH_PREF_KEY)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** Resolves the content width the CSS axis would show for a column width.
 * @param columnWidth - the conversation column's rendered width in px.
 * @param preference - the dragged preference, or null for the adaptive clamp.
 * @returns the resolved content width in px (mirrors the CSS clamp). */
function resolveContentWidth(columnWidth: number, preference: number | null): number {
  const max = Math.max(CONTENT_MIN, columnWidth - CONTENT_EDGE_BUDGET)
  if (preference !== null) return Math.min(Math.max(preference, CONTENT_MIN), max)
  return Math.max(CONTENT_MIN, Math.min(columnWidth - 48, 1024))
}

/** One transcript width handle: pointer capture + rAF-throttled symmetric
 * resize (both sides write the one centered width, so outward travel widens
 * by 2× the pointer distance). pointermove publishes the pointer's Y as a CSS
 * variable so the glow indicator rides it. Mirrors ui-layout AppFrame's
 * DragHandle capture model. */
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
    const box = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--dsh-width-handle-pointer-y', `${e.clientY - box.top}px`)
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
  // Releasing the button outside the window delivers pointercancel (or drops
  // the capture silently) instead of pointerup; without this the glow's
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
    />
  )
}

export function ConversationRoot({
  sessionId, useSession, useSessions, useSessionPendingInteraction,
  useWorkspaces, useInput, useComposerBlock, useSelectedView,
  renderSlot, renderSlotChain, selectWorkspace, t,
}: ConversationRootProps) {
  const session = useSession(s => s)
  const pendingInteraction = useSessionPendingInteraction(snapshot =>
    sessionId === undefined ? undefined : snapshot.get(sessionId))
  const openState = session?.openState
  const inputState = useInput(s => s)
  const cwd = useSessions(s => sessionId === undefined ? undefined : s.byId[sessionId]?.cwd)
  const summaryBlank = useSessions(s => sessionId === undefined ? undefined : s.byId[sessionId]?.blank)
  const sessionsPending = useSessions(s => s.phase) === 'pending'
  const workspaces = useWorkspaces(s => s)
  // A plugin this package cannot import (ui-model-selection) says this session cannot
  // send; its reason is already localized by whoever raised it.
  const composerBlock = useComposerBlock(block => block)
  const composerOverlay = useSelectedView(view => view?.composerPlacement === 'overlay')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<WorkspaceId | undefined>()
  const pickerAnchor = useRef<HTMLButtonElement>(null)

  // Nothing measures the composer seat. A View that floats a composer over its
  // own ledger clears it with the static `--dsh-composer-height` fallback in
  // that View's own stylesheet (ui-trajectory's `.ledger`), so a draft that
  // grows past the fallback is not cleared exactly.

  // The column width is CSS's business now (the .root width axis reads the
  // AppFrame centre column's 100cqi), so nothing here observes resizes. The
  // element ref remains for the drag handles, which read geometry once per
  // gesture rather than once per frame.
  const rootEl = useRef<HTMLDivElement | null>(null)
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
    return resolveContentWidth(root.offsetWidth, readWidthPreference())
  }, [])
  const onHandleDrag = useCallback((width: number): void => {
    const root = rootEl.current
    /* v8 ignore next -- handles render inside the root, so the ref is always attached. */
    if (root === null) return
    const clamped = resolveContentWidth(root.offsetWidth, width)
    root.style.setProperty('--dsh-chat-user-width', `${clamped}px`)
  }, [])
  const onHandleCommit = useCallback((width: number): void => {
    const root = rootEl.current
    /* v8 ignore next -- handles render inside the root, so the ref is always attached. */
    if (root === null) return
    const committed = resolveContentWidth(root.offsetWidth, width)
    localStorage.setItem(WIDTH_PREF_KEY, `${committed}`)
    setUserWidth(committed)
  }, [])
  const onHandleEnd = useCallback((): void => {
    const root = rootEl.current
    const stored = readWidthPreference()
    setUserWidth(stored)
    // An uncommitted press leaves the stored preference untouched: drop the
    // live style so the attribute-selected rule reads the stored value again.
    if (root !== null && stored === null) root.style.removeProperty('--dsh-chat-user-width')
  }, [])

  const sessionWorkspace = sessionId === undefined
    ? undefined
    : workspaces.items.find(workspace => workspace.sessionIds.includes(sessionId))
  const pendingWorkspace = workspaces.items.find(
    workspace => workspace.workspaceId === pendingWorkspaceId,
  )

  // Close the picker when the reader moves to a different Session. Adoption —
  // the first Session arriving under a shell that had none — is not such a
  // move: the boot-time Workspace connect lands while the Hero is on screen,
  // and closing on it would snap shut a menu the reader had just opened.
  const previousSessionId = useRef(sessionId)
  useEffect(() => {
    const previous = previousSessionId.current
    previousSessionId.current = sessionId
    if (previous === undefined) return
    setPickerOpen(false)
  }, [sessionId])

  // Clear the pending pick once the session lands in it, or when the picked
  // workspace disappears from a ready list (deleted from the sidebar).
  useEffect(() => {
    if (pendingWorkspaceId === undefined) return
    if (sessionWorkspace?.workspaceId === pendingWorkspaceId
      || (workspaces.phase === 'ready' && pendingWorkspace === undefined)) {
      setPendingWorkspaceId(undefined)
    }
  }, [pendingWorkspaceId, sessionWorkspace?.workspaceId, workspaces.phase, pendingWorkspace])

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
  const zone: InputZone | undefined =
    session === undefined || inputState === undefined ? undefined : { session, input: inputState }

  // The chip is a selector; label resolution walks the flow top-down:
  //   1. a just-picked workspace (pending) → its title;
  //   2. cold start, no session yet → placeholder ("Choose workspace");
  //   3. the blank session's workspace is in the list → its title;
  //   4. list still loading → cwd folder name bridges so the title does not
  //      flash on refresh (empty cwd → placeholder);
  //   5. list ready but no owning workspace (deleted from the sidebar) →
  //      placeholder, never the deleted folder's name via cwd.
  const chipTitle = pendingWorkspace?.title
    ?? (sessionId === undefined
      ? undefined
      : sessionWorkspace?.title
        ?? (workspaces.phase === 'ready' || cwd === undefined || cwd === ''
          ? undefined
          : workspaceLabel(cwd)))

  const heroWorkspaceRow = (
    <div className={css.heroWorkspaceRow}>
      <WorkspaceChip
        buttonRef={pickerAnchor}
        label={chipTitle}
        menuOpen={pickerOpen}
        onClick={() => { setPickerOpen(open => !open) }}
        t={t}
      />
      {renderSlot('conversation.hero.workspace', {
        open: pickerOpen,
        anchorRef: pickerAnchor,
        selectedId: pendingWorkspaceId ?? sessionWorkspace?.workspaceId,
        onPick: (workspaceId) => {
          setPickerOpen(false)
          setPendingWorkspaceId(workspaceId)
          void selectWorkspace(workspaceId).catch(() => {
            setPendingWorkspaceId(current => current === workspaceId ? undefined : current)
          })
        },
        onClose: () => { setPickerOpen(false) },
      })}
      {renderSlot('conversation.hero.agentPreset', {})}
    </div>
  )

  // The placeholder chip ("Choose workspace") and the Workspace-trigger input travel
  // together: no workspace picked yet (cold start, no session at all), or a
  // blank session whose workspace vanished (deleted from the sidebar). The
  // bar is ONE session-maybe slot rendered unconditionally — inert is a prop,
  // not a different tree, so the textarea DOM survives the transition.
  const inert = sessionId === undefined || (hero && chipTitle === undefined)
  // A raised block is the same inert posture with the blocker's own reason:
  // one disabled textarea, never a second tree. The no-workspace state wins
  // when both hold — picking a workspace is the earlier prerequisite.
  const blocked = !inert && composerBlock !== undefined
  const inputBar = renderSlot('conversation.composer.bar', {
    variant: hero ? 'hero' : 'composer',
    ...(inert
      ? {
        disabled: true,
        placeholder: t('placeholder.workspace'),
        workspacePickerOpen: pickerOpen,
        onRequestWorkspace: () => { setPickerOpen(true) },
      }
      : blocked
        // `blocked`, not `disabled`: the bar refuses input either way, but a
        // block keeps the model seat live because choosing a model is how the
        // user clears it.
        ? { blocked: composerBlock, placeholder: composerBlock.reason }
        : hero ? { placeholder: t('placeholder.hero') } : {}),
  })

  const composerBar = (
    <div className={clsx(css.composerStack, hero && css.composerHero)}>
      {hero && <HeroShell t={t} renderSlot={renderSlot} />}
      {hero && heroWorkspaceRow}
      {zone !== undefined && renderSlot('conversation.input.dock', zone)}
      {inputBar}
    </div>
  )

  const phase = settling ? 'settling' : hero ? 'hero' : 'active'
  const composer = renderSlotChain(
    'conversation.composer',
    { sessionId, session, pendingInteraction },
    {
      fallback: composerBar,
      fallbackOnly: sessionId === undefined,
      overlay: true,
    },
  )

  // Sticky wraps the whole chain output (fallback + elected overlay), not
  // only `.composerStack`: overlay:true renders those as siblings, and sticky
  // on the fallback alone would leave a business-owned takeover at the content
  // end off-screen when the user is not pinned to the floor.
  const composerSeat = (
    <div className={css.composerSeat} data-composer-seat="">
      {composer}
    </div>
  )

  const { loaderActive, mountedSessionId } = useContentCover({ sessionId, hero, openState })

  return (
    <div
      ref={rootEl}
      className={css.root}
      data-phase={phase}
      data-composer-overlay={composerOverlay || undefined}
      data-chat-user-width={userWidth === null ? undefined : ''}
      style={userWidth === null ? undefined : { '--dsh-chat-user-width': `${String(userWidth)}px` } as CSSProperties}
    >
      {sessionId === undefined ? null : (
        <header className={css.header}>
          <div className={css.navBackground} aria-hidden="true">
            <div className={css.navFade} />
            <div className={css.navBlur} />
          </div>
          {renderSlot('conversation.session.header', {})}
        </header>
      )}
      <div className={css.body}>
        <ContentLoader
          active={loaderActive}
          label={t('content.loading')}
        />
        <div className={css.scrollArea}>
          <div className={css.scrollBody} data-conversation-scroll="">
            {/* This hold keeps the scrollport's growing item present while
                conversation.session is dropped so the overlay can present. */}
            {mountedSessionId === undefined
              ? (phase === 'active'
                ? <div className={css.transcriptHold} data-transcript-hold="" aria-hidden="true" />
                : null)
              : renderSlot('conversation.session', {})}
          </div>
          {/* Bounded to the scrollport by its wrapper, so a control that clears
              the composer only has to sit at this layer's floor: the layer ends
              where the composer begins, and follows a growing draft for free. */}
          <div className={css.viewChrome} data-conversation-chrome="" />
        </div>
        {/* Outside the scrollport, like the header: a seat inside it is
            carried by elastic overscroll, so the input card visibly rides the
            rubber-band at either end. As a flex sibling of the scrollport it
            docks at the body's floor and no scroll gesture can move it. */}
        {composerSeat}
        {/* Width handles only while a transcript is on screen; the hero has no
            content column to size. */}
        {phase === 'active' && (['left', 'right'] as const).map(side => (
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
    </div>
  )
}
