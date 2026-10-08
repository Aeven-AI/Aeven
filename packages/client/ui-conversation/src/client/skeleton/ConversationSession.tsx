/** Strict per-session header/body content inserted into the resident conversation layout. */

import { useEffect } from 'react'
import type {
  ConversationSessionHeaderSlotProps, ConversationSessionSlotProps,
} from '../contract/slots.ts'
import { conversationPhase } from '../contract/snapshot.ts'
import { resolveActiveView } from '../view-selection.ts'
import { NavigationOptions } from './NavigationOptions.tsx'
import css from './ConversationRoot.module.css'

/** Full props composed from the strict session body contract. */
export type ConversationSessionProps = ConversationSessionSlotProps

/** Full props composed from the strict session header contract. */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps

/**
 * Renders the Session header's seats into the resident header shell: the band's
 * options control, the lineage mark, and the contributed actions.
 * ConversationRoot owns the `<header>` element so it stays mounted across
 * Session switches; this slot fills the row and may remount with the Session
 * while that shell does not.
 * @param props - composed slot props (Session store, View roster, locale, and render share).
 * @returns the header row.
 */
export function ConversationSessionHeader({
  sessionId, useSessions, useConversationViews, useSelectedView, useMoveTargets, useStore, renderSlot,
  forkSession, exportSession, moveSession, selectView, t,
}: ConversationSessionHeaderProps) {
  const displayTitle = useSessions(state => state.byId[sessionId]?.displayTitle)
  const views = useConversationViews(value => value)
  const selectedView = useSelectedView(value => value)
  const moveTargets = useMoveTargets(value => value)
  const running = useSessions(state => state.byId[sessionId]?.running) ?? false
  // The resolved View is what the reader is looking at; the stored preference
  // answers before the Session's binding has activated one.
  const activeId = selectedView?.id ?? resolveActiveView(views, useStore(s => s.view))?.id
  return (
    <div className={css.titleRow}>
      <div className={css.headerActions}>
        {/* Leads the cluster: the bar's padding clears the fold control, so the
            control stands beside the toggle that folds the column, ahead of
            everything the Session itself contributes. */}
        <NavigationOptions
          views={views}
          activeId={activeId}
          onSelect={selectView}
          onFork={forkSession}
          onExport={exportSession}
          moveTargets={moveSession === undefined ? [] : moveTargets}
          moveDisabled={running}
          onMove={moveSession ?? (() => {})}
          t={t}
        />
        {renderSlot(
          'conversation.session.header.lineage',
          { lineageSessionId: sessionId, displayTitle: displayTitle ?? sessionId },
          { fallback: null },
        )}
        {renderSlot('conversation.session.header.actions', {})}
      </div>
    </div>
  )
}

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function ConversationSession({
  useSession, useConversation, useConversationViews, useInput, inputActions, useStore, actions,
  renderSlot, bindDraftMirror,
}: ConversationSessionProps) {
  const tabs = useConversationViews(value => value)
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(tabs, selectedId)
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  const inputState = useInput(s => s)
  const storedDraft = useStore(s => s.draft)

  useEffect(() => {
    if (inputState.draft === '' && storedDraft !== '') inputActions.setDraft(storedDraft)
    const unmirror = bindDraftMirror(actions.setDraft)
    return () => { unmirror() }
    // Mount-only (deps pinned to inputActions): later store writes come from
    // the machine mirror, not this seed effect.
  }, [inputActions])

  if (session.blank && conversationPhase(session, conversation) === 'blank') return null
  return (
    <div className={css.viewArea}>
      {active !== undefined && renderSlot('conversation.view', {}, { only: active.id })}
    </div>
  )
}
