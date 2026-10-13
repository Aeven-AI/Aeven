/** MIME parsing shared by the receive providers. */

import mailparser, { type AddressObject, type ParsedMail } from 'mailparser'
import type { MailAttachment, MailMessage, MailMessageRef } from './types.ts'

/** Parsing bounds for one message. */
export interface ParseLimits {
  /** Cap on returned body characters. */
  bodyMaxChars: number
}

/** Render one parsed address header as display text. */
export function addressText(value: AddressObject | AddressObject[] | undefined): string | undefined {
  if (value === undefined) return undefined
  const text = (Array.isArray(value) ? value : [value]).map(entry => entry.text).filter(entry => entry !== '').join(', ')
  return text === '' ? undefined : text
}

/** Parse a raw message without converting cid: images to data URIs or adding link markup. */
export async function parseSource(source: Buffer | string): Promise<ParsedMail> {
  return mailparser.simpleParser(source, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true })
}

/**
 * Project a parsed message onto the model-facing message fields.
 * @param ref - where the message lives.
 * @param parsed - the parsed MIME message.
 * @param limits - body character cap.
 * @returns headers, bounded text body, and attachment metadata.
 */
export function toMailMessage(ref: MailMessageRef, parsed: ParsedMail, limits: ParseLimits): MailMessage {
  const body = parsed.text ?? ''
  const truncated = body.length > limits.bodyMaxChars
  return {
    ...ref,
    ...parsed.messageId !== undefined ? { messageId: parsed.messageId } : {},
    ...parsed.date !== undefined ? { date: parsed.date.toISOString() } : {},
    ...optional('from', addressText(parsed.from)),
    ...optional('to', addressText(parsed.to)),
    ...optional('cc', addressText(parsed.cc)),
    ...optional('replyTo', addressText(parsed.replyTo)),
    ...parsed.subject !== undefined ? { subject: parsed.subject } : {},
    text: truncated ? body.slice(0, limits.bodyMaxChars) : body,
    truncated,
    attachments: parsed.attachments.map((attachment, index) => ({
      index,
      ...attachment.filename !== undefined ? { filename: attachment.filename } : {},
      contentType: attachment.contentType,
      size: attachment.size,
    })),
  }
}

/**
 * Select one attachment of a parsed message.
 * @param parsed - the parsed MIME message.
 * @param index - the attachment index reported by {@link toMailMessage}.
 * @returns the attachment, or `undefined` when the index is out of range.
 */
export function attachmentAt(parsed: ParsedMail, index: number): MailAttachment | undefined {
  const attachment = parsed.attachments[index]
  if (attachment === undefined) return undefined
  return {
    ...attachment.filename !== undefined ? { filename: attachment.filename } : {},
    contentType: attachment.contentType,
    content: new Uint8Array(attachment.content),
  }
}

/** Threading headers of a message being answered. */
export interface ReplyContext {
  messageId?: string
  references: string[]
  subject?: string
  replyTo?: string
}

/** Read the threading headers a reply needs. */
export function replyContext(parsed: ParsedMail): ReplyContext {
  const references = parsed.references === undefined ? [] : Array.isArray(parsed.references) ? parsed.references : [parsed.references]
  return {
    ...parsed.messageId !== undefined ? { messageId: parsed.messageId } : {},
    references: parsed.messageId === undefined ? references : [...references, parsed.messageId],
    ...parsed.subject !== undefined ? { subject: parsed.subject } : {},
    ...optional('replyTo', addressText(parsed.replyTo) ?? addressText(parsed.from)),
  }
}

/** Spread helper that omits an absent string field. */
export function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined ? {} : { [key]: value } as Record<K, string>
}
