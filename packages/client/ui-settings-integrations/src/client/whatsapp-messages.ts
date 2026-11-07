/** WhatsApp messages as a message-reading call's structured result reports them. @module */
import type { ToolCallViewProps } from '@aeven/client-ui-tool/client'

/** Media kinds the WhatsApp connector records on a message. */
export type WhatsAppMediaKind = 'image' | 'sticker' | 'video' | 'gif' | 'audio' | 'document'

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
  const media = typeof row.media_type === 'string' && MEDIA_KINDS.includes(row.media_type) ? row.media_type as WhatsAppMediaKind : undefined
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
