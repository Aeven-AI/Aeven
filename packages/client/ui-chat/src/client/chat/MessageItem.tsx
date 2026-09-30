import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, Ref } from 'react'
import type { PendingSubmission, SessionSnapshot } from '@aeven/api-session-controller/client'
import type { MessageFileSource, MessageImageSource } from '@aeven/client-ui-conversation/client'
import { SessionSeq } from '@aeven/session/types'
import {
  IconCheckOutline16, IconCloseOutline16, IconEditOutline16, IconSendOutline14, IconTrashOutline16,
  JsonBlock, projectUserText, StateDot, Tooltip, useTextAnimation,
} from '@aeven/client-ui-primitives'
import type { ChatNodeOwnerProps, ChatNodeViewProps, ChatViewInjected, ChatViewSlotProps } from '../contract/slots.ts'
import type { ModelRetryNode, TurnErrorNode, UserMessageNode } from '../contract/snapshot.ts'
import { CompactionItem } from './CompactionItem.tsx'
import { ContextInjectionRow } from './ContextInjectionRow.tsx'
import { EditIconActions, MessageIconActions } from './MessageIconActions.tsx'
import css from './MessageItem.module.css'

type UserImage = Extract<UserMessageNode['content'][number], { type: 'image' }>
type UserFile = Extract<UserMessageNode['content'][number], { type: 'file' }>

function contentParts(content: readonly unknown[]): {
  text: string
  images: { attachment: UserImage['attachment'] }[]
  files: { attachment: UserFile['attachment'] }[]
  rest: unknown[]
} {
  const texts: string[] = []
  const images: { attachment: UserImage['attachment'] }[] = []
  const files: { attachment: UserFile['attachment'] }[] = []
  const rest: unknown[] = []
  for (const block of content) {
    const b = block as { type?: string; text?: string; attachment?: unknown }
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
    else if (b.type === 'image' && b.attachment !== undefined) {
      images.push({ attachment: (b as UserImage).attachment })
    }
    else if (b.type === 'file' && b.attachment !== undefined) files.push({ attachment: (b as UserFile).attachment })
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
 * Milliseconds since the local send a row stands for, latched at mount, or
 * null when the row stands for no pending send (history, or another surface's
 * message). Every row that renders one submission (its echo, the Host queue or
 * steering row, the durable message, the pending and real Turn headers) starts
 * its fade at this elapsed time, so remounts and replacements continue one
 * fade instead of restarting it. The user's text-animation preference turns
 * the fade off.
 * @param sentAt - client time of the still-pending echo's send, or undefined without one.
 * @returns the elapsed milliseconds, or null without a pending send or with text animation off.
 */
export function useArrivalAge(sentAt: number | undefined): number | null {
  const animate = useTextAnimation()
  const ageRef = useRef<number | null | undefined>(undefined)
  if (ageRef.current === undefined) ageRef.current = sentAt === undefined ? null : Math.max(0, Date.now() - sentAt)
  return animate ? ageRef.current : null
}

/**
 * Fade-in class and negative animation delay for a row that continues a send's fade.
 * @param age - {@link useArrivalAge} result.
 * @returns the class name and inline style; both undefined without a pending send.
 */
export function arrivalFade(age: number | null): { className?: string | undefined; style?: CSSProperties | undefined } {
  return age === null ? {} : { className: css.enter, style: { animationDelay: `-${age}ms` } }
}

/** Right-aligned bubble shared by user and steering rows. */
function UserStyleBubble({
  content, renderMessageImages, actions, pending = false, echo = false, queued = false,
  arrivalAge = null, body, bubbleRef, referenceLabels = [], skillNames = [],
  previewImages, previewFiles, t,
}: {
  content: readonly unknown[]
  /** Receives the text bubble element, as the inline editor reads its height. */
  bubbleRef?: Ref<HTMLDivElement>

  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  /** Optional IconActions (or similar) below the bubble; receives the joined text. */
  actions?: (text: string) => ReactNode
  /** Whether this is the Host-authoritative pre-admission steering projection. */
  pending?: boolean
  /** Whether this is a local submission echo (invisible marker; the echo renders exactly like its durable replacement). */
  echo?: boolean
  /** Whether the message waits in the Host queue for the running turn to end. */
  queued?: boolean
  /** Elapsed time of the send this row stands for ({@link useArrivalAge}); null renders without a fade. */
  arrivalAge?: number | null
  /** Replaces the text bubble, as the inline editor of a queued message does. */
  body?: ReactNode
  /** Exact session mention labels associated by the adjacent recall node. */
  referenceLabels?: readonly string[]
  /** Skill names the step's `skill-invocation` injections loaded for this message. */
  skillNames?: readonly string[]
  /** Local submission-echo previews replacing the content-derived image group. */
  previewImages?: readonly MessageImageSource[]
  /** Local submission-echo files replacing the content-derived file group. */
  previewFiles?: readonly MessageFileSource[]
  t: ChatViewSlotProps['t']
}): ReactNode {
  const { text, images: contentImages, files: contentFiles, rest } = contentParts(content)
  const images = previewImages ?? contentImages
  const files = previewFiles ?? contentFiles
  const truncated = (total: number): string => t('json.truncated', { total })
  const showBubble = text !== '' || rest.length > 0
  const attachmentCount = images.length + files.length
  const fade = arrivalFade(arrivalAge)
  const bubbleContent = <>
    {projectUserText(text, referenceLabels, skillNames)}
    {rest.map((block, i) => <JsonBlock key={i} label={t('message.extraBlock')} payload={block} truncatedLabel={truncated} />)}
  </>
  return (
    <div
      className={fade.className === undefined ? css.userRow : `${css.userRow} ${fade.className}`}
      style={fade.style}
      data-pending-steering={pending || undefined}
      data-submission-echo={echo || undefined}
      data-queued={queued || undefined}
    >
      <div className={css.userStack} data-attachments={attachmentCount > 0 ? Math.min(attachmentCount, 5) : undefined}>
        {attachmentCount > 0
          ? <>
            {/* The attachment tray and the text share one card; an open editor sits below it. */}
            <div className={css.attachmentCard}>
              {renderMessageImages({ images, files, align: 'end', layout: 'tray' })}
              {body === undefined && (showBubble
                ? <div ref={bubbleRef} className={css.cardText}>{bubbleContent}</div>
                : <div className={css.cardFoot} />)}
            </div>
            {body}
          </>
          : body ?? (showBubble && <div ref={bubbleRef} className={css.bubble}>{bubbleContent}</div>)}
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
export function PendingSteeringBubble({ content, sentAt, renderMessageImages, t }: {
  content: readonly unknown[]
  /** Send time of the local echo this row replaces, when one is still pending. */
  sentAt?: number | undefined
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  t: ChatViewSlotProps['t']
}): ReactNode {
  const arrivalAge = useArrivalAge(sentAt)
  return (
    <UserStyleBubble
      content={content}
      renderMessageImages={renderMessageImages}
      arrivalAge={arrivalAge}
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
export function PendingSubmissionBubble({ submission, extendedTranscript, renderMessageImages, t }: {
  submission: PendingSubmission
  /** Whether the reader chose the Extended transcript, which shows the send time. */
  extendedTranscript: boolean
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
  const previewFiles = useMemo<readonly MessageFileSource[]>(
    () => submission.files.map(file => ({ preview: file })),
    [submission.files],
  )
  const arrivalAge = useArrivalAge(submission.time)
  return (
    <UserStyleBubble
      content={content}
      previewImages={previewImages}
      previewFiles={previewFiles}
      renderMessageImages={renderMessageImages}
      pending={submission.placement === 'steering'}
      echo
      arrivalAge={arrivalAge}
      queued={submission.placement === 'queued'}
      t={t}
      actions={text => submission.placement === 'queued'
        ? <div className={css.queuedActions}><span className={css.queuedLabel}>{t('message.queued')}</span></div>
        : (
          <MessageIconActions
            text={text}
            time={extendedTranscript ? submission.time : undefined}
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
export function QueuedMessageBubble({ row, sentAt, running, mutable, updateQueue, notifyError, renderMessageImages, t }: {
  row: SessionSnapshot['queue'][number]
  /** Send time of the local echo this row replaces, when one is still pending. */
  sentAt?: number | undefined
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
  const arrivalAge = useArrivalAge(sentAt)
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
      arrivalAge={arrivalAge}
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

/**
 * Conversation-wide text field that takes a sent prompt's bubble place while
 * its inline editor is open: it opens at the bubble's height and grows with
 * its lines up to the CSS max-height, then scrolls. Enter sends, Shift+Enter
 * breaks the line, and Escape cancels.
 */
function MessageEditorInput({ value, minHeight, busy, onChange, onCancel, onSend, t }: {
  value: string
  /** Rendered height of the bubble it replaces; undefined for a prompt without text. */
  minHeight: number | undefined
  busy: boolean
  onChange: (value: string) => void
  onCancel: () => void
  onSend: () => void
  t: ChatViewSlotProps['t']
}): ReactNode {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const input = ref.current
    if (input === null) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }, [])
  useLayoutEffect(() => {
    const input = ref.current
    if (input === null) return
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      className={`${css.bubble} ${css.messageEditorInput} no-scrollbar`}
      style={minHeight === undefined ? undefined : { minHeight }}
      aria-label={t('message.edit')}
      value={value}
      disabled={busy}
      rows={1}
      onChange={(event) => { onChange(event.currentTarget.value) }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { onCancel(); return }
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault()
          onSend()
        }
      }}
    />
  )
}

/**
 * User and admitted-steering keyed Chat renderer. Both offer inline editing: the bubble becomes a text field and its icon row becomes
 * cancel / confirm, where confirm stays unavailable until the text differs
 * from the prompt and holds non-whitespace text.
 */
export const UserMessageNodeView = memo(function UserMessageNodeView({
  node, renderMessageImages, useSession, t, extendedTranscript, editMessage,
}: ChatNodeViewProps<'user' | 'steering'>) {
  const data = node.data
  const rpcId = sourceRpcId(data.source)
  const echo = useSession(state => rpcId === undefined
    ? undefined
    : state.pendingSubmissions.find(submission => submission.requestId === rpcId))
  // Latched at mount: the echo retires a frame after this row appears, and
  // the fade must survive its disappearance.
  const arrivalAge = useArrivalAge(echo?.time)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState<{ draft: string; minHeight: number | undefined } | null>(null)
  const [busy, setBusy] = useState(false)
  const original = useMemo(() => contentParts(data.content).text, [data.content])
  const edit = editMessage
  const unchanged = editing === null || editing.draft.trim() === '' || editing.draft === original
  const cancel = (): void => { setEditing(null) }
  const send = async (): Promise<void> => {
    if (edit === undefined || editing === null || busy || unchanged) return
    setBusy(true)
    try {
      // An accepted edit rewinds this prompt out of the transcript, which unmounts the row.
      await edit(SessionSeq(data.seq), editing.draft)
    } catch {
      // The session face mirrors the refusal into the composer's error line; the editor stays open for another try.
      setBusy(false)
    }
  }
  return (
    <UserStyleBubble
      content={data.content}
      renderMessageImages={renderMessageImages}
      arrivalAge={arrivalAge}
      bubbleRef={bubbleRef}
      {...data.referenceLabels === undefined ? {} : { referenceLabels: data.referenceLabels }}
      {...data.skillNames === undefined ? {} : { skillNames: data.skillNames }}
      body={editing === null ? undefined : (
        <MessageEditorInput
          value={editing.draft}
          minHeight={editing.minHeight}
          busy={busy}
          onChange={(draft) => { setEditing({ ...editing, draft }) }}
          onCancel={cancel}
          onSend={() => { void send() }}
          t={t}
        />
      )}
      t={t}
      actions={text => editing !== null
        ? (
          <EditIconActions
            onCancel={cancel}
            onConfirm={() => { void send() }}
            confirmUnavailable={unchanged}
            busy={busy}
            className={css.actions}
            t={t}
          />
        )
        : (
          <MessageIconActions
            text={text}
            time={extendedTranscript ? data.time : undefined}
            clock="start"
            onEdit={edit === undefined ? undefined : () => {
              setEditing({ draft: original, minHeight: bubbleRef.current?.getBoundingClientRect().height })
            }}
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
