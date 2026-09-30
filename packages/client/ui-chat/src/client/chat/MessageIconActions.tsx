// Shared IconActions chrome for user and assistant messages: copy
// live, optional edit and branch wiring, and an optional date-aware clock.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  IconBranchOutline16, IconCheckOutline16, IconCloseOutline16, IconCopyOutline16, IconEditOutline16, Tooltip,
  writeClipboard,
} from '@aeven/client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatMessageClock } from './message-chrome.ts'
import { useCalendarDay } from './use-calendar-day.ts'
import css from './MessageIconActions.module.css'

export interface MessageIconActionsProps {
  /** Plain text the copy action writes. */
  text: string
  /** Unix epoch ms for the clock label; omitted for transient messages. */
  time?: number | undefined
  /** Clock before icons (user) or after (assistant). */
  clock: 'start' | 'end'
  /** Open this user prompt's inline editor, placed before copy; omission hides the edit action. */
  onEdit?: (() => void) | undefined
  /** Fork the session at this message; omission hides the branch action. */
  onBranch?: (() => void) | undefined
  /** The message is not a completed transcript tail, so branch stays visible but unavailable. */
  branchUnavailable?: boolean | undefined
  /** Parent layout class composed onto the actions row. */
  className?: string | undefined
  /**
   * Slot-rendered actions owned by independent plugins, placed between the
   * built-in copy and branch controls.
   */
  extraActions?: ReactNode
  /**
   * Icon-row Turn-usage trigger (the TurnUsagePanel pill), seated after the
   * branch control at the end of the icon cluster. Omitted by Normal, which
   * renders no per-Turn timing or usage chrome.
   */
  usageAction?: ReactNode | undefined
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/** The transcript column the tooltips near a message row's edge stay inside. */
function chatColumn(reference: Element): Element | null {
  return reference.closest('[data-chat-flow]')
}

/**
 * Copy / branch (/ clock) IconActions row shared by user and assistant chrome.
 * @param props - Copy text, event time, clock side, branch callback, className.
 * @returns The actions row element.
 */
export function MessageIconActions({
  text, time, clock, onEdit, onBranch, branchUnavailable = false, className,
  extraActions, usageAction, t,
}: MessageIconActionsProps) {
  const day = useCalendarDay()
  const reasonId = useId()
  // Same success chrome as CodeBlock: a short check swap after the write,
  // gated so re-clicks during the window neither re-copy nor stack timers.
  const [copied, setCopied] = useState(false)
  const copyPending = useRef(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyEpoch = useRef(0)
  useEffect(() => () => {
    copyEpoch.current += 1
    copyPending.current = false
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
  }, [])
  const onCopy = useCallback(() => {
    if (copied || copyPending.current) return
    const epoch = copyEpoch.current
    copyPending.current = true
    void writeClipboard(text).then((ok) => {
      if (epoch !== copyEpoch.current) return
      copyPending.current = false
      if (!ok) return
      setCopied(true)
      copyTimer.current = window.setTimeout(() => {
        copyTimer.current = null
        setCopied(false)
      }, 1000)
    })
  }, [copied, text])
  const clockEl = time === undefined ? null : (
    <span className={clock === 'start' ? css.timeStart : css.timeEnd}>
      {formatMessageClock(time, t, day)}
    </span>
  )
  // Copy is the outermost icon of both rows: it ends the right-aligned user row
  // (clock first) and starts the left-aligned assistant row (clock last). Its
  // bubble aligns to that outer edge and is clamped to the chat column, which
  // the button's padding and the arrow's reach may overhang.
  const copySide = clock === 'start' ? 'bottom-end' : 'bottom-start'
  return (
    <div className={className === undefined ? css.actions : `${css.actions} ${className}`}>
      {clock === 'start' ? clockEl : null}
      {onEdit !== undefined && (
        <Tooltip label={t('message.edit')} side="bottom" boundary={chatColumn}>
          <button type="button" className={css.action} aria-label={t('message.edit')} onClick={onEdit}>
            <IconEditOutline16 />
          </button>
        </Tooltip>
      )}
      <Tooltip label={copied ? t('copied') : t('copy')} side={copySide} boundary={chatColumn}>
        <button type="button" className={css.action} aria-label={copied ? t('copied') : t('copy')} onClick={onCopy}>
          {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
        </button>
      </Tooltip>
      {extraActions}
      {onBranch !== undefined && (
        <Tooltip label={branchUnavailable ? t('message.branchUnavailable') : t('message.branch')} side="bottom">
          {/* Native disabled buttons do not deliver the hover/focus events Tooltip needs. */}
          <button
            type="button"
            className={css.action}
            aria-label={t('message.branch')}
            aria-disabled={branchUnavailable || undefined}
            aria-describedby={branchUnavailable ? reasonId : undefined}
            data-unavailable={branchUnavailable || undefined}
            onClick={branchUnavailable ? undefined : onBranch}
          >
            <IconBranchOutline16 />
          </button>
        </Tooltip>
      )}
      {onBranch !== undefined && branchUnavailable && (
        <span id={reasonId} className={css.visuallyHidden}>{t('message.branchUnavailable')}</span>
      )}
      {usageAction}
      {clock === 'end' ? clockEl : null}
    </div>
  )
}

/** Props of {@link EditIconActions}. */
export interface EditIconActionsProps {
  /** Close the editor without sending. */
  onCancel: () => void
  /** Send the edited prompt. */
  onConfirm: () => void
  /** The draft is unchanged or blank, so confirm stays visible but unavailable. */
  confirmUnavailable: boolean
  /** An edit is in flight; both actions are unavailable. */
  busy: boolean
  /** Parent layout class composed onto the actions row. */
  className?: string | undefined
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/**
 * Cancel / confirm IconActions row that stands in for a user prompt's row while
 * its inline editor is open.
 * @param props - Cancel and confirm callbacks, availability, className.
 * @returns The actions row element.
 */
export function EditIconActions({
  onCancel, onConfirm, confirmUnavailable, busy, className, t,
}: EditIconActionsProps) {
  const confirmOff = busy || confirmUnavailable
  return (
    <div className={className === undefined ? css.actions : `${css.actions} ${className}`}>
      <Tooltip label={t('message.edit.cancel')} side="bottom" boundary={chatColumn}>
        <button
          type="button"
          className={css.action}
          aria-label={t('message.edit.cancel')}
          aria-disabled={busy || undefined}
          data-unavailable={busy || undefined}
          onClick={busy ? undefined : onCancel}
        >
          <IconCloseOutline16 />
        </button>
      </Tooltip>
      {/* The row's right edge is the chat column's: the bubble aligns to it and stays inside the column. */}
      <Tooltip label={t('message.edit.send')} side="bottom-end" boundary={chatColumn}>
        {/* Native disabled buttons do not deliver the hover/focus events Tooltip needs. */}
        <button
          type="button"
          className={css.action}
          aria-label={t('message.edit.send')}
          aria-disabled={confirmOff || undefined}
          data-unavailable={confirmOff || undefined}
          onClick={confirmOff ? undefined : onConfirm}
        >
          <IconCheckOutline16 />
        </button>
      </Tooltip>
    </div>
  )
}
