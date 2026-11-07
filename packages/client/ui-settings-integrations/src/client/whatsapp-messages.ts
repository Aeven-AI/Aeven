/** WhatsApp messages as a message-reading call's structured result reports them. @module */
import type { ToolCallViewProps } from '@aeven/client-ui-tool/client'

/** Media kinds the WhatsApp connector records on a message. */
export type WhatsAppMediaKind = 'image' | 'sticker' | 'video' | 'gif' | 'audio' | 'document'

/** The message a reply quotes, as the reply shows it. */
export interface WhatsAppCardQuote {
  readonly senderName: string
  readonly fromMe: boolean
  readonly content: string
  readonly media?: WhatsAppMediaKind | undefined
}

/** The preview a message shows for a link in its text. */
export interface WhatsAppCardLink {
  readonly url: string
  readonly title: string
  readonly description: string
  /** Whether the preview has an image, loaded through the message's media. */
  readonly hasImage: boolean
}

/** One message, as a card draws it. */
export interface WhatsAppCardMessage {
  readonly id: string
  readonly chatJid: string
  readonly chatName: string
  readonly senderName: string
  readonly fromMe: boolean
  readonly group: boolean
  /** Unix epoch ms. */
  readonly time: number
  readonly content: string
  readonly media?: WhatsAppMediaKind | undefined
  readonly filename?: string | undefined
  readonly forwarded: boolean
  readonly reply?: WhatsAppCardQuote | undefined
  readonly link?: WhatsAppCardLink | undefined
}

/** One chat's messages, oldest first. */
export interface WhatsAppCardChat {
  readonly chatJid: string
  readonly chatName: string
  readonly group: boolean
  readonly messages: readonly WhatsAppCardMessage[]
}

const MEDIA_KINDS: readonly string[] = ['image', 'sticker', 'video', 'gif', 'audio', 'document']

/**
 * A media kind the connector reported, when it is one the card draws.
 * @param value - a `media_type` field.
 * @returns the kind, or undefined.
 */
function mediaKindOf(value: unknown): WhatsAppMediaKind | undefined {
  return typeof value === 'string' && MEDIA_KINDS.includes(value) ? value as WhatsAppMediaKind : undefined
}

/**
 * A string field, or the empty string when it is absent.
 * @param value - the field.
 * @returns the string.
 */
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Narrow the quoted message of a reply.
 * @param value - a message's `reply` field.
 * @returns the quote, or undefined when the message quotes none.
 */
function quoteOf(value: unknown): WhatsAppCardQuote | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  return {
    senderName: text(row.sender_name),
    fromMe: row.is_from_me === true,
    content: text(row.content),
    media: mediaKindOf(row.media_type),
  }
}

/**
 * Narrow a link preview.
 * @param value - a message's `link` field.
 * @returns the preview, or undefined when it has neither a title nor a description.
 */
function linkOf(value: unknown): WhatsAppCardLink | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  const link = { url: text(row.url).trim(), title: text(row.title), description: text(row.description), hasImage: row.has_image === true }
  return link.title === '' && link.description === '' ? undefined : link
}

/**
 * Narrow one structured message the daemon reported.
 * @param entry - one element of `structuredContent.messages`.
 * @returns the message, or undefined when a required field is missing.
 */
function messageOf(entry: unknown): WhatsAppCardMessage | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined
  const row = entry as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.chat_jid !== 'string' || typeof row.timestamp !== 'string') return undefined
  const time = Date.parse(row.timestamp)
  if (Number.isNaN(time)) return undefined
  const media = mediaKindOf(row.media_type)
  return {
    id: row.id,
    chatJid: row.chat_jid,
    chatName: typeof row.chat_name === 'string' && row.chat_name !== '' ? row.chat_name : row.chat_jid.split('@')[0] ?? row.chat_jid,
    senderName: typeof row.sender_name === 'string' ? row.sender_name : '',
    fromMe: row.is_from_me === true,
    group: row.is_group === true,
    time,
    content: typeof row.content === 'string' ? row.content : '',
    media,
    filename: typeof row.filename === 'string' && row.filename !== '' ? row.filename : undefined,
    forwarded: row.forwarded === true,
    reply: quoteOf(row.reply),
    link: linkOf(row.link),
  }
}

/**
 * The chats a settled message-reading call reported, read from its `tool/result` meta.
 * @param block - the call, running or settled.
 * @returns the chats in order of their first message, or an empty list while the call runs, after it failed, or
 * when the connector reported no structured messages.
 */
export function chatsOf(block: ToolCallViewProps['block']): readonly WhatsAppCardChat[] {
  if (!('kind' in block) || block.isError) return []
  const meta = block.meta as { structuredContent?: { messages?: unknown } } | undefined
  const list = meta?.structuredContent?.messages
  if (!Array.isArray(list)) return []
  const chats = new Map<string, { chatName: string; group: boolean; messages: WhatsAppCardMessage[] }>()
  for (const entry of list) {
    const message = messageOf(entry)
    if (message === undefined) continue
    let chat = chats.get(message.chatJid)
    if (chat === undefined) {
      chat = { chatName: message.chatName, group: message.group, messages: [] }
      chats.set(message.chatJid, chat)
    }
    chat.messages.push(message)
  }
  return [...chats].map(([chatJid, chat]) => ({ chatJid, ...chat }))
}
