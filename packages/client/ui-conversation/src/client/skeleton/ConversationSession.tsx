/** Strict per-session header/body content inserted into the resident conversation layout. */

import { useEffect } from 'react'
import type {
  ConversationSessionHeaderSlotProps, ConversationSessionSlotProps,
} from '../contract/slots.ts'
import { conversationPhase } from '../contract/snapshot.ts'
import { resolveActiveView } from '../view-selection.ts'
import css from './ConversationRoot.module.css'

/** Full props composed from the strict session body contract. */
export type ConversationSessionProps = ConversationSessionSlotProps

/** Full props composed from the strict session header contract. */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps

/**
 * Renders the Session header's seats into the resident header shell: the
 * lineage mark and the contributed actions. ConversationRoot owns the
 * `<header>` element so it stays mounted across Session switches; this slot
 * fills the row and may remount with the Session while that shell does not.
 * @param props - composed slot props (Session store and render share).
 * @returns the header row.
 */
export function ConversationSessionHeader({ sessionId, useSessions, renderSlot }: ConversationSessionHeaderProps) {
  const displayTitle = useSessions(state => state.byId[sessionId]?.displayTitle)
  return (
    <div className={css.titleRow}>
      <div className={css.headerActions}>
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
  renderSlot, bindDraftMirror, openView,
}: ConversationSessionProps) {
  const tabs = useConversationViews(value => value)
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(tabs, selectedId)
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  const inputState = useInput(s => s)
  const storedDraft = useStore(s => s.draft)
  const viewRequest = useStore(s => s.viewRequest ?? null)

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
      {active !== undefined && renderSlot('conversation.view', {
        viewRequest,
        openView,
        completeViewRequest: actions.completeViewRequest,
      }, { only: active.id })}
    </div>
  )
}
