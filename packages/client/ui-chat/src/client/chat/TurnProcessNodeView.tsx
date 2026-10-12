import { memo, useEffect, useState } from 'react'
import { IconChevronDownOutline14, TextShimmer } from '@aeven/client-ui-primitives'
import type { PendingSubmission } from '@aeven/api-session-controller/client'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import { formatRunDuration } from './message-chrome.ts'
import { arrivalFade, useArrivalAge } from './MessageItem.tsx'
import { ReasoningRow } from './ReasoningRow.tsx'
import css from './TurnProcessNodeView.module.css'

/**
 * Turn-level process disclosure controller.
 *
 * While the turn runs, the header sits above its work with a live elapsed
 * clock. Once it closes, the header names how the turn ended: its elapsed time
 * for an ordinary end, and the stop or failure in place of the time for a
 * cancelled or failed turn.
 */
export const TurnProcessNodeView = memo(function TurnProcessNodeView({
  node, turnProcess, useSession, t,
}: ChatNodeViewProps<'turn-process'>) {
  if (turnProcess === undefined) throw new Error('turn-process node requires Turn process owner state')
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const running = turn?.status === 'open'
  // A running Turn's header that mounts while a transcript echo is still up
  // replaces the pending header row and continues its fade.
  const sentAt = useSession(state => running ? latestTranscriptSend(state.pendingSubmissions) : undefined)
  const fade = arrivalFade(useArrivalAge(sentAt))
  const [now, setNow] = useState(Date.now)
  const ticking = turnProcess.foldable && running
  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [ticking])
  if (!turnProcess.foldable) return null
  const open = turnProcess.open
  const canCollapse = turnProcess.openable
  // An open Turn that has produced nothing yet: the reader opened the
  // disclosure and the model's first streamed row has not arrived, so the row
  // that will hold the trace stands in for it instead of an empty region.
  const awaitingTrace = running && open && !turnProcess.holdsProcess
  const reason = turn?.end?.data.reason.kind
  const elapsedMs = turn?.start === undefined || (!running && turn.end === undefined)
    ? undefined
    : Math.max(1000, (turn.end?.time ?? now) - turn.start.time)
  const duration = elapsedMs === undefined ? undefined : formatRunDuration(elapsedMs, t)
  const label = running
    ? duration === undefined ? t('chat.deepDiving') : t('message.turnProcess.deepDivingFor', { duration })
    : reason === 'aborted' ? t('message.stopped')
      : reason === 'error' ? t('message.turnProcess.failed')
        : duration === undefined ? t('message.turnProcess.worked')
          : t('message.turnProcess.took', { duration })
  return (
    <>
      <button
        type="button"
        className={fade.className === undefined ? css.root : `${css.root} ${fade.className}`}
        style={fade.style}
        data-open={open || undefined}
        data-running={running || undefined}
        data-turn-process={node.data.turn}
        data-turn-process-messages={node.data.messageCount}
        data-turn-process-tool-calls={node.data.toolCallCount}
        data-turn-process-subagents={node.data.subagentCount}
        disabled={!canCollapse}
        aria-expanded={canCollapse ? open : undefined}
        onClick={(event) => {
          event.currentTarget.focus()
          turnProcess.setOpen(!open)
        }}
      >
        <TextShimmer className={css.label} active={running}>{label}</TextShimmer>
        {running && <span className={css.srOnly} role="status" aria-live="polite">{t('chat.deepDiving')}</span>}
        {canCollapse && <IconChevronDownOutline14 className={css.chevron} />}
      </button>
      {awaitingTrace && (
        <div className={css.awaiting} data-turn-process-awaiting="">
          <ReasoningRow text="" running t={t} />
        </div>
      )}
    </>
  )
})

/**
 * Send time of the newest local echo that renders in the transcript.
 * @param submissions - the session snapshot's pending submissions.
 * @returns the client send time, or undefined without a transcript echo.
 */
export function latestTranscriptSend(submissions: readonly PendingSubmission[]): number | undefined {
  return submissions.findLast(submission => submission.placement === 'transcript')?.time
}

/**
 * Local stand-in for the running Turn header, shown under a sent message until
 * the Host opens the Turn and its own header row renders.
 * @param props - the Chat view's translator and the send time the row fades in from.
 * @returns the shimmering "Ævening…" row.
 */
export function TurnPendingRow({ sentAt, t }: Pick<ChatNodeViewProps<'turn-process'>, 't'> & {
  /** Send time of the transcript echo above the row; undefined once the durable message replaced it. */
  sentAt: number | undefined
}) {
  const fade = arrivalFade(useArrivalAge(sentAt))
  return (
    <div
      className={fade.className === undefined ? css.root : `${css.root} ${fade.className}`}
      style={fade.style}
      data-open=""
      data-running=""
      data-turn-pending=""
    >
      <TextShimmer className={css.label} active>{t('chat.deepDiving')}</TextShimmer>
      <span className={css.srOnly} role="status" aria-live="polite">{t('chat.deepDiving')}</span>
    </div>
  )
}
