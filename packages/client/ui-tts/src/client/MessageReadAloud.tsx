/**
 * Read-aloud entries in the message action strips: one message, spoken on demand. Idle shows the read glyph, a
 * synthesis in flight shows a spinner, and a playing reading shows pause (or play, while held) and stop.
 */
import { useEffect, useRef, useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@aeven/client-ui-slots'
import {
  IconLucideCirclePause, IconLucideCirclePlay, IconLucideCircleStop, IconLucideVolume2, Spinner, Tooltip,
} from '@aeven/client-ui-primitives'
import type {} from '@aeven/client-ui-conversation/client'
import type {} from '@aeven/client-ui-chat/client'
import type { ReadAloudSnapshot } from './engine.ts'
import { NS } from './locales.ts'
import { messageText } from './voices.ts'
import css from './MessageReadAloud.module.css'

/** Reading operations the message actions call, without exposing a Cordis Context to React. */
export interface MessageReadAloudInjected {
  hooks: {
    readAloud: HostObservable<ReadAloudSnapshot>
  }
  /**
   * Speak one message's text from its start on a channel of its own.
   * @param channel - channel identity, derived from the message.
   * @param text - the complete message text.
   */
  read: (channel: string, text: string) => void
  /**
   * Silence one message channel.
   * @param channel - channel identity, derived from the message.
   */
  stop: (channel: string) => void
  /**
   * Hold one playing message channel where it is.
   * @param channel - channel identity, derived from the message.
   */
  pause: (channel: string) => void
  /**
   * Continue a held message channel from the same word.
   * @param channel - channel identity, derived from the message.
   */
  resume: (channel: string) => void
}

/** Assistant action seat, dictionaries, and the plugin's message-reading face. */
export type MessageReadAloudProps = PropsRuntime<'conversation.chat.assistant-actions'>
  & PropsLocale<typeof NS> & InjectFace<MessageReadAloudInjected>

/** User action seat, dictionaries, and the plugin's message-reading face. */
export type UserReadAloudProps = PropsRuntime<'conversation.chat.user-actions'>
  & PropsLocale<typeof NS> & InjectFace<MessageReadAloudInjected>

/**
 * Longest the spinner waits for the engine to report a synthesis or audio after a press. Past it, a reading that
 * never started returns the control to the read glyph instead of spinning on.
 */
const WATCHDOG_MS = 8_000

/** The transcript column the tooltips near a user row's edge stay inside. */
function chatColumn(reference: Element): Element | null {
  return reference.closest('[data-chat-flow]')
}

/** What one control set needs beyond the message's identity and text. */
interface ReadAloudControlsProps {
  readonly channel: string
  readonly text: string
  readonly useReadAloud: MessageReadAloudProps['useReadAloud']
  readonly read: MessageReadAloudInjected['read']
  readonly stop: MessageReadAloudInjected['stop']
  readonly pause: MessageReadAloudInjected['pause']
  readonly resume: MessageReadAloudInjected['resume']
  readonly t: TranslateNS<typeof NS>
  /** Which strip the controls sit in: the user row keeps its tooltips inside the chat column's right edge. */
  readonly row: 'assistant' | 'user'
}

/**
 * Render the read-aloud controls for one message channel.
 * @param props - channel, text, reading operations, and dictionaries.
 * @returns the read action, a spinner, or the pause and stop pair.
 */
function ReadAloudControls({ channel, text, useReadAloud, read, stop, pause, resume, t, row }: ReadAloudControlsProps) {
  const state = useReadAloud(value => value)
  const speaking = state.speaking.includes(channel)
  const paused = state.paused.includes(channel)
  const synthesizing = state.loading.includes(channel)
  const failed = state.failed.includes(channel)
  const enabled = state.enabled.includes(channel)
  // The spinner covers the click until the first fragment is audible, which the engine reports late enough that a
  // short clause can finish synthesizing between two published snapshots.
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState(false)
  // Whether the engine has reported this press's channel enabled; only then does a disabled channel mean another
  // reading took over.
  const started = useRef(false)

  useEffect(() => {
    if (!pending) {
      started.current = false
      return undefined
    }
    if (enabled) started.current = true
    // Audio, a failure, or the reading ending elsewhere (another message started) all settle the press.
    if (speaking || failed || (started.current && !enabled)) {
      setPending(false)
      if (failed) setFailure(true)
      return undefined
    }
    if (synthesizing) return undefined
    const timer = setTimeout(() => { setPending(false) }, WATCHDOG_MS)
    return () => { clearTimeout(timer) }
  }, [pending, speaking, failed, enabled, synthesizing])

  useEffect(() => {
    if (speaking) setFailure(false)
  }, [speaking])

  if (text === '') return null
  const loading = !speaking && (pending || synthesizing)
  const side = row === 'user' ? 'bottom-end' : 'bottom'
  const boundary = row === 'user' ? chatColumn : undefined

  if (speaking) {
    const holdLabel = paused ? t('message.resume') : t('message.pause')
    return <>
      <Tooltip label={holdLabel} side="bottom" boundary={boundary}>
        <button
          type="button"
          className={css.action}
          aria-label={holdLabel}
          aria-pressed={paused}
          onClick={() => { if (paused) resume(channel); else pause(channel) }}
        >
          {paused ? <IconLucideCirclePlay /> : <IconLucideCirclePause />}
        </button>
      </Tooltip>
      <Tooltip label={t('message.stop')} side={side} boundary={boundary}>
        <button
          type="button"
          className={css.action}
          aria-label={t('message.stop')}
          onClick={() => { setPending(false); stop(channel) }}
        >
          <IconLucideCircleStop />
        </button>
      </Tooltip>
    </>
  }

  const label = loading ? t('loading') : failure ? t('message.failed') : t('message.read')
  return <Tooltip label={label} side={side} boundary={boundary}>
    <button
      type="button"
      className={css.action}
      aria-label={label}
      aria-pressed={loading}
      aria-busy={loading ? true : undefined}
      onClick={() => {
        if (loading) {
          setPending(false)
          stop(channel)
          return
        }
        setFailure(false)
        setPending(true)
        read(channel, text)
      }}
    >
      {loading ? <Spinner className={css.spinner} /> : <IconLucideVolume2 />}
    </button>
  </Tooltip>
}

/**
 * Render the read-aloud action for one assistant message.
 * @param props - message identity, chat snapshot selector, reading operations, and dictionaries.
 * @returns the controls, or nothing when the message holds no prose.
 */
export function MessageReadAloud({ messageId, useChat, read, stop, pause, resume, useReadAloud, t }: MessageReadAloudProps) {
  const text = useChat(snapshot => messageText(snapshot.legacy.nodes, messageId))
  return <ReadAloudControls
    channel={`message:${messageId}`}
    text={text}
    useReadAloud={useReadAloud}
    read={read}
    stop={stop}
    pause={pause}
    resume={resume}
    t={t}
    row="assistant"
  />
}

/**
 * Render the read-aloud action for one user prompt, placed left of its copy action.
 * @param props - the prompt's sequence and typed text, reading operations, and dictionaries.
 * @returns the controls, or nothing when the prompt holds no prose.
 */
export function UserReadAloud({ seq, text, read, stop, pause, resume, useReadAloud, t }: UserReadAloudProps) {
  return <ReadAloudControls
    channel={`prompt:${String(seq)}`}
    text={text.trim()}
    useReadAloud={useReadAloud}
    read={read}
    stop={stop}
    pause={pause}
    resume={resume}
    t={t}
    row="user"
  />
}
