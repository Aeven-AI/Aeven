/**
 * WhatsApp messages drawn at the call that read them: one card per chat, its messages as chat bubbles with their
 * photos, stickers, looping GIFs, videos, and voice notes playable in place.
 * @module
 */
import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react'
import type { ToolCallViewProps } from '@aeven/client-ui-tool/client'
import type { PropsLocale } from '@aeven/client-ui-slots'
import { chatsOf, type WhatsAppCardChat, type WhatsAppCardMessage } from './whatsapp-messages.ts'
import { VoiceNote } from './VoiceNote.tsx'
import type { MessageMediaSource, LoadedMedia } from './message-media.ts'
import css from './WhatsAppMessagesCard.module.css'

type CardT = PropsLocale<'connector-cards'>['t']

/**
 * Whether an element has come near the viewport, so its media loads only once it is about to be seen.
 * @returns a ref to attach and whether the element was seen.
 */
function useSeen<E extends Element>(): [React.RefObject<E>, boolean] {
  const ref = useRef<E>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (seen || element === null) return
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) setSeen(true)
    }, { rootMargin: '400px 0px' })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [seen])
  return [ref, seen]
}

/**
 * Mark a photo or video loaded, so the stylesheet fades it in.
 * @param event - the element's `load` or `loadeddata` event.
 */
function shown(event: SyntheticEvent<HTMLElement>): void {
  event.currentTarget.dataset.loaded = ''
}

/**
 * The media of one message once requested.
 * @param source - loads a message's media.
 * @param message - the message.
 * @param requested - whether to load now.
 * @returns undefined while loading or not requested, null when the media is unavailable, or the loaded media.
 */
function useMedia(source: MessageMediaSource, message: WhatsAppCardMessage, requested: boolean): LoadedMedia | null | undefined {
  const [media, setMedia] = useState<LoadedMedia | null | undefined>(undefined)
  useEffect(() => {
    if (!requested) return
    let live = true
    source.load(message.chatJid, message.id).then(
      (loaded) => { if (live) setMedia(loaded ?? null) },
      () => { if (live) setMedia(null) },
    )
    return () => { live = false }
  }, [source, message.chatJid, message.id, requested])
  return media
}

/** A photo or sticker, loaded once it nears the viewport. */
function PictureMedia({ source, message, t }: { source: MessageMediaSource; message: WhatsAppCardMessage; t: CardT }) {
  const [ref, seen] = useSeen<HTMLDivElement>()
  const media = useMedia(source, message, seen)
  const sticker = message.media === 'sticker'
  return (
    <div ref={ref} className={sticker ? css.sticker : css.picture} data-loading={media === undefined || undefined}>
      {media === null ? <span className={css.unavailable}>{t('unavailable')}</span>
        : media !== undefined ? <img src={media.url} alt={t(sticker ? 'sticker' : 'photo')} loading="lazy" onLoad={shown} /> : null}
    </div>
  )
}

/** A GIF, which loops silently once it nears the viewport, as WhatsApp plays it. */
function GifMedia({ source, message, t }: { source: MessageMediaSource; message: WhatsAppCardMessage; t: CardT }) {
  const [ref, seen] = useSeen<HTMLDivElement>()
  const media = useMedia(source, message, seen)
  return (
    <div ref={ref} className={css.picture} data-loading={media === undefined || undefined}>
      {media === null ? <span className={css.unavailable}>{t('unavailable')}</span>
        : media !== undefined ? <video src={media.url} autoPlay loop muted playsInline aria-label={t('gif')} onLoadedData={shown} /> : null}
      <span className={css.badge}>{t('gif')}</span>
    </div>
  )
}

/** A video, loaded once it nears the viewport and played muted, which browsers allow without a press. */
function VideoMedia({ source, message, t }: { source: MessageMediaSource; message: WhatsAppCardMessage; t: CardT }) {
  const [ref, seen] = useSeen<HTMLDivElement>()
  const media = useMedia(source, message, seen)
  return (
    <div ref={ref} className={css.picture} data-loading={media === undefined || undefined}>
      {media === null ? <span className={css.unavailable}>{t('unavailable')}</span>
        : media !== undefined ? <video src={media.url} controls autoPlay muted playsInline aria-label={t('video')} onLoadedData={shown} />
          : null}
    </div>
  )
}

/** A document, saved under its own name when the reader asks for it. */
function DocumentMedia({ source, message, t }: { source: MessageMediaSource; message: WhatsAppCardMessage; t: CardT }) {
  const [requested, setRequested] = useState(false)
  const media = useMedia(source, message, requested)
  const name = message.filename ?? t('document')
  useEffect(() => {
    if (media === undefined || media === null) return
    const link = document.createElement('a')
    link.href = media.url
    link.download = name
    link.click()
  }, [media, name])
  return (
    <button type="button" className={css.document} onClick={() => { setRequested(true) }} disabled={media === null}
      title={media === null ? t('unavailable') : t('download')}>
      <span className={css.documentMark} aria-hidden="true" />
      <span className={css.documentName}>{name}</span>
    </button>
  )
}

/** The media of one message, in the form its kind plays in. */
function MessageMedia({ source, message, t }: { source: MessageMediaSource; message: WhatsAppCardMessage; t: CardT }): ReactNode {
  switch (message.media) {
    case 'image':
    case 'sticker':
      return <PictureMedia source={source} message={message} t={t} />
    case 'gif':
      return <GifMedia source={source} message={message} t={t} />
    case 'video':
      return <VideoMedia source={source} message={message} t={t} />
    case 'audio':
      return <VoiceNote source={source} message={message} t={t} />
    case 'document':
      return <DocumentMedia source={source} message={message} t={t} />
    case undefined:
      return null
    default: {
      const unknown: never = message.media
      return unknown
    }
  }
}

/**
 * The day a message falls on, as the reader's locale names it.
 * @param time - Unix epoch ms.
 * @returns the day label.
 */
function dayLabel(time: number): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(time)
}

/**
 * The time of day a message was sent, as the reader's locale writes it.
 * @param time - Unix epoch ms.
 * @returns the clock time.
 */
function clockTime(time: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(time)
}

/** One message bubble. */
function Bubble({ message, chat, source, showSender, t }: {
  message: WhatsAppCardMessage
  chat: WhatsAppCardChat
  source: MessageMediaSource
  showSender: boolean
  t: CardT
}) {
  const bare = message.media === 'sticker' && message.content === ''
  return (
    <div className={css.row} data-from-me={message.fromMe || undefined}>
      <div className={bare ? css.bareBubble : css.bubble} data-media={message.media}
        data-text={message.content !== '' || undefined}>
        {showSender && chat.group && !message.fromMe && <span className={css.sender}>{message.senderName}</span>}
        <MessageMedia source={source} message={message} t={t} />
        {message.content !== '' && <p className={css.text}>{message.content}</p>}
        <time className={css.time} dateTime={new Date(message.time).toISOString()}>{clockTime(message.time)}</time>
      </div>
    </div>
  )
}

/** One chat: its name, then its messages by day. */
function ChatCard({ chat, source, t }: { chat: WhatsAppCardChat; source: MessageMediaSource; t: CardT }) {
  const rows: ReactNode[] = []
  let day = ''
  let previousSender = ''
  for (const message of chat.messages) {
    const label = dayLabel(message.time)
    if (label !== day) {
      day = label
      previousSender = ''
      rows.push(<div key={`day:${message.id}`} className={css.day}><span>{label}</span></div>)
    }
    const sender = message.fromMe ? '' : message.senderName
    rows.push(
      <Bubble key={message.id} message={message} chat={chat} source={source} showSender={sender !== previousSender} t={t} />,
    )
    previousSender = sender
  }
  return (
    <section className={css.card} data-whatsapp-chat={chat.chatJid}>
      <header className={css.header}>
        <span className={css.chatName}>{chat.chatName}</span>
        <span className={css.count}>{t('messageCount', { count: chat.messages.length })}</span>
      </header>
      <div className={css.messages}>{rows}</div>
    </section>
  )
}

/**
 * Build the card view for the WhatsApp message reads.
 * @param mediaFor - the media source of the account a call's tool name names.
 * @returns the tool view registered for `list_messages` and `get_message_context`.
 */
export function createWhatsAppMessagesCard(mediaFor: (toolName: string) => MessageMediaSource) {
  return function WhatsAppMessagesCard({ block, toolName, t }: ToolCallViewProps & PropsLocale<'connector-cards'>) {
    const chats = chatsOf(block)
    if (chats.length === 0) return null
    const source = mediaFor(toolName)
    return (
      <div className={css.root} data-whatsapp-messages={chats.length}>
        {chats.map(chat => <ChatCard key={chat.chatJid} chat={chat} source={source} t={t} />)}
      </div>
    )
  }
}
