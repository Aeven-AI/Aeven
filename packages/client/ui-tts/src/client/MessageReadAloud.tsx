/** Read-aloud entry in the assistant action strip: one settled message, spoken on demand. */
import { useEffect, useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import { IconLucideVolume2, IconLucideVolumeX, Spinner, Tooltip } from '@aeven/client-ui-primitives'
import type {} from '@aeven/client-ui-conversation/client'
import type { ReadAloudSnapshot } from './engine.ts'
import { NS } from './locales.ts'
import { messageText } from './voices.ts'
import css from './MessageReadAloud.module.css'

/** Reading operations the message action calls, without exposing a Cordis Context to React. */
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
}

/** Assistant action seat, dictionaries, and the plugin's message-reading face. */
export type MessageReadAloudProps = PropsRuntime<'conversation.chat.assistant-actions'>
  & PropsLocale<typeof NS> & InjectFace<MessageReadAloudInjected>

/**
 * Render the read-aloud action for one assistant message, showing a spinner while its first fragment
 * is being synthesized and a stop glyph while it plays.
 * @param props - message identity, chat snapshot selector, reading operations, and dictionaries.
 * @returns the action, or nothing when the message holds no prose.
 */
export function MessageReadAloud({ messageId, useChat, read, stop, useReadAloud, t }: MessageReadAloudProps) {
  const state = useReadAloud(value => value)
  const text = useChat(snapshot => messageText(snapshot.legacy.nodes, messageId))
  const channel = `message:${messageId}`
  const speaking = state.speaking.includes(channel)
  // The spinner covers the click until the first fragment is audible, which the engine reports late
  // enough that a short clause can finish synthesizing between two published snapshots.
  const [pending, setPending] = useState(false)
  const loading = !speaking && (pending || state.loading.includes(channel))

  useEffect(() => {
    if (speaking) setPending(false)
  }, [speaking])

  if (text === '') return null
  const label = loading ? t('loading') : speaking ? t('message.stop') : t('message.read')
  return <Tooltip label={label} side="bottom">
    <button
      type="button"
      className={css.action}
      aria-label={label}
      aria-pressed={speaking || loading}
      aria-busy={loading ? true : undefined}
      onClick={() => {
        if (speaking || loading) {
          setPending(false)
          stop(channel)
          return
        }
        setPending(true)
        read(channel, text)
      }}
    >
      {loading
        ? <Spinner className={css.spinner} />
        : speaking ? <IconLucideVolumeX /> : <IconLucideVolume2 />}
    </button>
  </Tooltip>
}
