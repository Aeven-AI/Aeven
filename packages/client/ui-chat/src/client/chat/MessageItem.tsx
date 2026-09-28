import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PendingSubmission, SessionSnapshot } from '@aeven/api-session-controller/client'
import type { MessageImageSource } from '@aeven/client-ui-conversation/client'
import {
  IconCheckOutline16, IconCloseOutline16, IconEditOutline16, IconSendOutline14, IconTrashOutline16,
  JsonBlock, projectUserText, StateDot, Tooltip,
} from '@aeven/client-ui-primitives'
import type { ChatNodeOwnerProps, ChatNodeViewProps, ChatViewInjected, ChatViewSlotProps } from '../contract/slots.ts'
import type { ModelRetryNode, TurnErrorNode, UserMessageNode } from '../contract/snapshot.ts'
import { CompactionItem } from './CompactionItem.tsx'
import { ContextInjectionRow } from './ContextInjectionRow.tsx'
import { MessageIconActions } from './MessageIconActions.tsx'
import css from './MessageItem.module.css'

type UserImage = Extract<UserMessageNode['content'][number], { type: 'image' }>
type UserFile = Extract<UserMessageNode['content'][number], { type: 'file' }>

function contentParts(content: readonly unknown[]): {
  text: string
  images: { attachment: UserImage['attachment'] }[]
  files: UserFile['attachment'][]
  rest: unknown[]
} {
  const texts: string[] = []
  const images: { attachment: UserImage['attachment'] }[] = []
  const files: UserFile['attachment'][] = []
  const rest: unknown[] = []
  for (const block of content) {
    const b = block as { type?: string; text?: string; attachment?: unknown }
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
    else if (b.type === 'image' && b.attachment !== undefined) {
      images.push({ attachment: (b as UserImage).attachment })
    }
    else if (b.type === 'file' && b.attachment !== undefined) files.push((b as UserFile).attachment)
    else rest.push(block)
  }
  return { text: texts.join(''), images, files, rest }
}

function retrySeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1_000))
}

interface RetryCountdown {
  deadline: number
  seconds: number
}

function failureMessage(
  message: string,
  code: unknown,
  t: ChatViewSlotProps['t'],
): string {
  return code === 'AUTH' ? t('message.failure.auth') : message
}

function ModelRetryItem({ node, active, t }: {
  node: ModelRetryNode
  active: boolean
  t: ChatViewSlotProps['t']
}) {
  // Anchor the host-scheduled delay to this browser's first render of the
  // retry node. Host event time and Date.now() may belong to different clocks.
  const deadline = useMemo(() => Date.now() + node.delayMs, [node.delayMs, node.seq])
  const scheduledSeconds = retrySeconds(node.delayMs)
  const maximum = node.mode === 'normal' ? node.maxRetries : '∞'
  const [countdown, setCountdown] = useState<RetryCountdown>(() => ({
    deadline,
    seconds: retrySeconds(deadline - Date.now()),
  }))
  const remainingSeconds = countdown.deadline === deadline
    ? countdown.seconds
    : retrySeconds(deadline - Date.now())

  useEffect(() => {
    if (!active) return
    const updateCountdown = (): number => {
      const next = retrySeconds(deadline - Date.now())
      setCountdown(current => (
        current.deadline === deadline && current.seconds === next
          ? current
          : { deadline, seconds: next }
      ))
      return next
    }
    if (updateCountdown() === 1) return
    const timer = window.setInterval(() => {
      if (updateCountdown() === 1) window.clearInterval(timer)
    }, 250)
    return () => { window.clearInterval(timer) }
  }, [active, deadline])

  const label = active
    ? t('message.retry.active')
    : node.retryState === 'cancelled'
      ? t('message.retry.cancelled')
      : node.retryState === 'started'
        ? t('message.retry.started')
        : t('message.retry.scheduled')
  const seconds = active ? remainingSeconds : scheduledSeconds

  return (
    <details className={css.retryRow} data-active={active || undefined}>
      <summary className={css.retrySummary}>
        <span className={css.retryText} role="status">
          {t('message.retry.status', { label, retry: node.retry, maximum, seconds })}
        </span>
      </summary>
      <div className={css.retryDetails}>
        <div>
          <span className={css.retryDetailLabel}>{t('message.retry.delay')}</span>
          {t('duration.milliseconds', { milliseconds: Math.round(node.delayMs) })}
        </div>
        <div>
          <span className={css.retryDetailLabel}>{t('message.retry.failure')}</span>
          {failureMessage(node.failure.message, node.failure.code, t)}
        </div>
      </div>
    </details>
  )
}

/** Persistent, turn-positioned feedback for a terminal failure. */
function TurnErrorItem({ node, t }: {
  node: TurnErrorNode
  t: ChatViewSlotProps['t']
}) {
  return (
    <div className={css.turnErrorRow} role="status">
      <StateDot state="error" className={css.turnErrorDot} />
      <div className={css.turnErrorCopy}>
        <span className={css.turnErrorTitle}>{t('message.turnError')}</span>
        <span className={css.turnErrorMessage}>{failureMessage(node.message, node.code, t)}</span>
      </div>
      {node.code !== undefined && <code className={css.turnErrorCode}>{node.code}</code>}
    </div>
  )
}

/** Persistent, turn-positioned notice for a turn ended at the output-token cap. */
function TurnMaxTokensItem({ t }: {
  t: ChatViewSlotProps['t']
}) {
  return (
    <div className={css.turnErrorRow} role="status">
      <StateDot state="warning" className={css.turnErrorDot} />
      <div className={css.turnErrorCopy}>
        <span className={css.maxTokensTitle}>{t('message.maxTokens')}</span>
        <span className={css.turnErrorMessage}>{t('message.maxTokens.hint')}</span>
      </div>
    </div>
  )
}

/** `rpcId` of a user or steering source; absent for messages no prompt originated. */
function sourceRpcId(source: unknown): string | undefined {
  if (typeof source !== 'object' || source === null) return undefined
  const rpcId = (source as { rpcId?: unknown }).rpcId
  return typeof rpcId === 'string' ? rpcId : undefined
}

/**
 * Milliseconds the row's own echo had already been fading when this row mounted,
 * or null when the row replaced no echo (history, or another surface's message).
 * The echo is retired a frame or two after this row appears, so starting the
 * replacement's fade at that elapsed time keeps one submission one fade.
 * @param echo - the still-pending echo carrying this row's `rpcId`.
 * @returns the echo's age in milliseconds, or null without one.
 */
function replacedEchoAgeMs(echo: PendingSubmission | undefined): number | null {
  return echo === undefined ? null : Math.max(0, Date.now() - echo.time)
}

/** Right-aligned bubble shared by user and steering rows. */
function UserStyleBubble({
  content, renderMessageImages, actions, pending = false, echo = false, queued = false, enter = false,
  enterAgeMs, body, referenceLabels = [], skillNames = [],
  previewImages, t,
}: {
  content: readonly unknown[]
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  /** Optional IconActions (or similar) below the bubble; receives the joined text. */
  actions?: (text: string) => ReactNode
  /** Whether this is the Host-authoritative pre-admission steering projection. */
  pending?: boolean
  /** Whether this is a local submission echo (invisible marker; the echo renders exactly like its durable replacement). */
  echo?: boolean
  /** Whether the message waits in the Host queue for the running turn to end. */
  queued?: boolean
  /** Whether this row is the message's own arrival and fades in. */
  enter?: boolean
  /** Elapsed fade time the row inherits from the echo it replaced; a negative animation delay continues that fade. */
  enterAgeMs?: number
  /** Replaces the text bubble, as the inline editor of a queued message does. */
  body?: ReactNode
  /** Exact session mention labels associated by the adjacent recall node. */
  referenceLabels?: readonly string[]
  /** Skill names the step's `skill-invocation` injections loaded for this message. */
  skillNames?: readonly string[]
  /** Local submission-echo previews replacing the content-derived image group. */
  previewImages?: readonly MessageImageSource[]
  t: ChatViewSlotProps['t']
}): ReactNode {
  const { text, images: contentImages, files, rest } = contentParts(content)
  const images = previewImages ?? contentImages
  const truncated = (total: number): string => t('json.truncated', { total })
  const showBubble = text !== '' || rest.length > 0
  return (
    <div
      className={enter ? `${css.userRow} ${css.enter}` : css.userRow}
      style={enterAgeMs === undefined ? undefined : { animationDelay: `-${enterAgeMs}ms` }}
      data-pending-steering={pending || undefined}
      data-submission-echo={echo || undefined}
      data-queued={queued || undefined}
    >
      <div className={css.userStack}>
        {renderMessageImages({ images, files, align: 'end' })}
        {body ?? (showBubble && <div className={css.bubble}>
          {projectUserText(text, referenceLabels, skillNames)}
          {rest.map((block, i) => <JsonBlock key={i} label={t('message.extraBlock')} payload={block} truncatedLabel={truncated} />)}
        </div>)}
        {referenceLabels.length > 0 && (
          <div className={css.referenceSummary}>
            {t('message.referenceSummary', { labels: referenceLabels.join(t('message.referenceSeparator')) })}
          </div>
        )}
      </div>
      {actions?.(text)}
    </div>
  )
}

/**
 * Render one Host-authoritative pending steering item with the same visual
 * language as its eventual durable transcript node.
 * @param props - Pending message content and conversation translator.
 * @returns the pending steering bubble.
 */
export function PendingSteeringBubble({ content, renderMessageImages, t }: {
  content: readonly unknown[]
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  t: ChatViewSlotProps['t']
}): ReactNode {
  return (
    <UserStyleBubble
      content={content}
      renderMessageImages={renderMessageImages}
      pending
      t={t}
      actions={text => (
        <MessageIconActions
          text={text}
          clock="start"
          className={css.actions}
          t={t}
        />
      )}
    />
  )
}

/**
 * Render one local transcript or steering submission echo with the same
 * visual language and surface marker as the Host occurrence that replaces
 * it: draft text plus object-URL previews, visible from the submit click
 * until the durable `user/message` or steering occurrence renders.
 * @param props - the session snapshot's pending submission and render seats.
 * @returns the echoed user bubble.
 */
export function PendingSubmissionBubble({ submission, renderMessageImages, t }: {
  submission: PendingSubmission
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  t: ChatViewSlotProps['t']
}): ReactNode {
  const content = useMemo(
    () => (submission.text === '' ? [] : [{ type: 'text', text: submission.text }]),
    [submission.text],
  )
  const previewImages = useMemo<readonly MessageImageSource[]>(
    () => submission.images.map(image => ({
      preview: {
        url: image.previewUrl,
        ...(image.name === undefined ? {} : { name: image.name }),
        ...(image.width === undefined ? {} : { width: image.width }),
        ...(image.height === undefined ? {} : { height: image.height }),
      },
    })),
    [submission.images],
  )
  return (
    <UserStyleBubble
      content={content}
      previewImages={previewImages}
      renderMessageImages={renderMessageImages}
      pending={submission.placement === 'steering'}
      echo
      enter
      queued={submission.placement === 'queued'}
      t={t}
      actions={text => submission.placement === 'queued'
        ? <div className={css.queuedActions}><span className={css.queuedLabel}>{t('message.queued')}</span></div>
        : (
          <MessageIconActions
            text={text}
            time={submission.time}
            clock="start"
            className={css.actions}
            t={t}
          />
        )}
    />
  )
}

/** One queue action button; the queued row's own tooltip-wrapped icon control. */
function QueuedAction({ label, disabled, onClick, children }: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}): ReactNode {
  return (
    <Tooltip label={label} side="bottom">
      <button type="button" className={css.queuedAction} aria-label={label} disabled={disabled} onClick={onClick}>
        {children}
      </button>
    </Tooltip>
  )
}

/**
 * Render one Host-queued message in the transcript, after the running turn it
 * waits for: the user bubble marked "Queued", with inline edit, remove, and
 * send-now (steer into the running turn). The row leaves when the Host admits
 * the message, removes it, or steers it.
 * @param props - the Host queue row, whether the queue accepts mutations, and the queue actions.
 * @returns the queued user bubble.
 */
export function QueuedMessageBubble({ row, running, mutable, updateQueue, notifyError, renderMessageImages, t }: {
  row: SessionSnapshot['queue'][number]
  /** Steering needs a running turn to join. */
  running: boolean
  /** Subagent sessions render their queue read-only. */
  mutable: boolean
  updateQueue: ChatViewInjected['updateQueue']
  notifyError: ChatViewInjected['notifyError']
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  t: ChatViewSlotProps['t']
}): ReactNode {
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const apply = async (action: Parameters<ChatViewInjected['updateQueue']>[1], failure: string): Promise<boolean> => {
    setBusy(true)
    try {
      await updateQueue(row.id, action)
      return true
    } catch {
      notifyError(failure)
      return false
    } finally {
      setBusy(false)
    }
  }
  const save = async (): Promise<void> => {
    if (editing === null || editing.trim() === '') return
    if (await apply({ kind: 'edit', content: [{ type: 'text', text: editing }] }, t('message.queued.editFailed'))) setEditing(null)
  }
  const editor = editing === null ? undefined : (
    <textarea
      autoFocus
      className={css.queuedEditor}
      aria-label={t('message.queued.edit')}
      value={editing}
      rows={Math.min(8, editing.split('\n').length)}
      onChange={(event) => { setEditing(event.currentTarget.value) }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { setEditing(null); return }
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault()
          void save()
        }
      }}
    />
  )
  return (
    <UserStyleBubble
      content={row.content}
      renderMessageImages={renderMessageImages}
      queued
      body={editor}
      t={t}
      actions={() => (
        <div className={css.queuedActions}>
          <span className={css.queuedLabel}>{t('message.queued')}</span>
          {mutable && (editing !== null
            ? <>
              <QueuedAction label={t('message.queued.save')} disabled={busy || editing.trim() === ''} onClick={() => { void save() }}>
                <IconCheckOutline16 />
              </QueuedAction>
              <QueuedAction label={t('message.queued.cancelEdit')} disabled={busy} onClick={() => { setEditing(null) }}>
                <IconCloseOutline16 />
              </QueuedAction>
            </>
            : <>
              <QueuedAction
                label={t(row.text === null ? 'message.queued.editUnsupported' : 'message.queued.edit')}
                disabled={busy || row.text === null}
                onClick={() => { if (row.text !== null) setEditing(row.text) }}
              >
                <IconEditOutline16 />
              </QueuedAction>
              <QueuedAction
                label={t('message.queued.remove')}
                disabled={busy}
                onClick={() => { void apply({ kind: 'remove' }, t('message.queued.removeFailed')) }}
              >
                <IconTrashOutline16 />
              </QueuedAction>
              {running && <QueuedAction
                label={t('message.queued.sendNow')}
                disabled={busy}
                onClick={() => { void apply({ kind: 'steer' }, t('message.queued.sendNowFailed')) }}
              >
                <IconSendOutline14 />
              </QueuedAction>}
            </>)}
        </div>
      )}
    />
  )
}

/** User and admitted-steering keyed Chat renderer. */
export const UserMessageNodeView = memo(function UserMessageNodeView({
  node, renderMessageImages, useSession, t,
}: ChatNodeViewProps<'user' | 'steering'>) {
  const data = node.data
  const rpcId = sourceRpcId(data.source)
  const echo = useSession(state => rpcId === undefined
    ? undefined
    : state.pendingSubmissions.find(submission => submission.requestId === rpcId))
  // Latched once: the echo retires a frame or two after this row mounts, and
  // the fade must survive its disappearance.
  const enterAgeRef = useRef<number | null>(null)
  if (enterAgeRef.current === null) enterAgeRef.current = replacedEchoAgeMs(echo)
  const enterAgeMs = enterAgeRef.current
  return (
    <UserStyleBubble
      content={data.content}
      renderMessageImages={renderMessageImages}
      {...enterAgeMs === null ? {} : { enter: true, enterAgeMs }}
      {...data.referenceLabels === undefined ? {} : { referenceLabels: data.referenceLabels }}
      {...data.skillNames === undefined ? {} : { skillNames: data.skillNames }}
      t={t}
      actions={text => (
        <MessageIconActions
          text={text}
          time={data.time}
          clock="start"
          className={css.actions}
          t={t}
        />
      )}
    />
  )
})

/** Injected-context keyed Chat renderer. */
export const ContextMessageNodeView = memo(function ContextMessageNodeView({ node, t }: ChatNodeViewProps<'context'>) {
  const data = node.data
  return (
    <ContextInjectionRow
      content={data.content}
      source={data.source}
      provenance={data.provenance}
      form={data.form}
      t={t}
    />
  )
})

/** Automatic compaction keyed Chat renderer. */
export const CompactionNodeView = memo(function CompactionNodeView({ node, t }: ChatNodeViewProps<'compaction'>) {
  return <CompactionItem node={node.data} t={t} />
})

/** Correlated retry-chain keyed Chat renderer. */
export const RetryNodeView = memo(function RetryNodeView({ node, t }: ChatNodeViewProps<'model-retry'>) {
  const data = node.data
  return <ModelRetryItem node={data.current} active={data.current.retryState === 'scheduled'} t={t} />
})

/** Terminal turn-error keyed Chat renderer. */
export const TurnErrorNodeView = memo(function TurnErrorNodeView({ node, t }: ChatNodeViewProps<'turn-error'>) {
  return <TurnErrorItem node={node.data} t={t} />
})

/** Max-tokens turn-end notice keyed Chat renderer. */
export const TurnMaxTokensNodeView = memo(function TurnMaxTokensNodeView({ t }: ChatNodeViewProps<'turn-max-tokens'>) {
  return <TurnMaxTokensItem t={t} />
})

/** Explicit unknown-surface keyed Chat renderer. */
export const UnknownNodeView = memo(function UnknownNodeView({ node, t }: ChatNodeViewProps<'unknown'>) {
  const data = node.data
  return (
    <div className={css.contextRow}>
      <JsonBlock
        label={t('message.unknownSurface', { type: data.type })}
        payload={data.data}
        truncatedLabel={total => t('json.truncated', { total })}
      />
    </div>
  )
})
