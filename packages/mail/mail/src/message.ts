/** MIME parsing shared by the receive providers. */

import { convert } from 'html-to-text'
import type { AddressObject, ParsedMail } from 'mailparser'
import type { ComposedAttachment } from './smtp.ts'
import type { MailAttachment, MailMessage, MailMessageRef, MailTextSource } from './types.ts'

/** Parsing bounds for one message. */
export interface ParseLimits {
  /** Cap on returned body characters. */
  bodyMaxChars: number
}

/**
 * Render one parsed address header as display text.
 * @param value - the parsed header, absent when the message carried none.
 * @returns the addresses joined for display, or `undefined` when none were present.
 */
export function addressText(value: AddressObject | AddressObject[] | undefined): string | undefined {
  if (value === undefined) return undefined
  const text = (Array.isArray(value) ? value : [value]).map(entry => entry.text).filter(entry => entry !== '').join(', ')
  return text === '' ? undefined : text
}

/**
 * Parse a raw message without converting cid: images to data URIs or adding link markup.
 * @param source - the raw RFC 5322 message.
 * @returns the parsed message, with its attachments left in place.
 */
export async function parseSource(source: Buffer | string): Promise<ParsedMail> {
  // Loaded on the first parse, so a Host without a mail account never loads it.
  const { default: mailparser } = await import('mailparser')
  return await mailparser.simpleParser(source, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true })
}

/**
 * Pick the readable body: the plain-text part when it has visible text, otherwise the HTML part as text.
 * mailparser converts HTML only for a lone root HTML part, so a `multipart/related` HTML body with
 * inline images, or an empty `text/plain` beside real HTML, reaches here with no usable `text`.
 * @param parsed - the parsed MIME message.
 * @returns the body and which part it came from; an empty body is reported as plain.
 */
function readableBody(parsed: ParsedMail): { body: string; source: MailTextSource } {
  const plain = parsed.text ?? ''
  if (plain.trim() !== '' || typeof parsed.html !== 'string' || parsed.html === '') return { body: plain, source: 'plain' }
  const body = convert(parsed.html, {
    wordwrap: false,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
    ],
  }).trim()
  return body === '' ? { body: plain, source: 'plain' } : { body, source: 'html' }
}

/**
 * Project a parsed message onto the model-facing message fields.
 * @param ref - where the message lives.
 * @param parsed - the parsed MIME message.
 * @param limits - body character cap.
 * @returns headers, bounded text body with its source part, and attachment metadata.
 */
export function toMailMessage(ref: MailMessageRef, parsed: ParsedMail, limits: ParseLimits): MailMessage {
  const { body, source } = readableBody(parsed)
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
    textSource: source,
    truncated,
    attachments: parsed.attachments.map((attachment, index) => ({
      index,
      ...attachment.filename !== undefined ? { filename: attachment.filename } : {},
      contentType: attachment.contentType,
      size: attachment.size,
      ...attachment.related ? { inline: true } : {},
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

/** The original message's share of a forward: what goes below the sender's own text. */
export interface ForwardParts {
  /** `Fwd: <original subject>`, unchanged when the subject already starts with `Fwd:` or `Fw:`. */
  subject?: string
  /** Forwarded-message header block and the original's readable body. */
  text: string
  /** The header block and the original's HTML body, when the original carried HTML. */
  html?: string
  /** Every original part, inline images keeping their Content-ID so the HTML still shows them. */
  attachments: ComposedAttachment[]
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/**
 * Escape text for an HTML body.
 * @param text - plain text.
 * @returns the text with markup characters escaped and line breaks as `<br>`.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => HTML_ESCAPES[char] ?? char).replace(/\r?\n/g, '<br>\n')
}

/**
 * Keep the part of an HTML document that can sit inside another message: the head's `<style>` blocks and the body's content.
 * @param html - the original HTML, a full document or a fragment.
 * @returns the embeddable markup.
 */
function embeddableHtml(html: string): string {
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1]
  if (body === undefined) return html
  const styles = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1]?.match(/<style[^>]*>[\s\S]*?<\/style>/gi) ?? []
  return [...styles, body].join('\n')
}

/**
 * Build the forwarded part of a message: the original's headers, its text and HTML bodies, and all its parts.
 * @param parsed - the parsed message being forwarded.
 * @returns the subject, bodies, and attachments to send below the sender's own text.
 */
export function forwardParts(parsed: ParsedMail): ForwardParts {
  const headers: [string, string | undefined][] = [
    ['From', addressText(parsed.from)],
    ['Date', parsed.date?.toUTCString()],
    ['Subject', parsed.subject],
    ['To', addressText(parsed.to)],
    ['Cc', addressText(parsed.cc)],
  ]
  const present = headers.filter((entry): entry is [string, string] => entry[1] !== undefined)
  const marker = '---------- Forwarded message ---------'
  const textHeader = [marker, ...present.map(([name, value]) => `${name}: ${value}`)].join('\n')
  const html = typeof parsed.html === 'string' && parsed.html !== ''
    ? `<div>${escapeHtml(textHeader)}</div><br>\n<div>${embeddableHtml(parsed.html)}</div>`
    : undefined
  const subject = parsed.subject === undefined ? undefined : /^fwd?:/i.test(parsed.subject) ? parsed.subject : `Fwd: ${parsed.subject}`
  return {
    ...subject !== undefined ? { subject } : {},
    text: `${textHeader}\n\n${readableBody(parsed).body}`,
    ...html !== undefined ? { html } : {},
    attachments: parsed.attachments.map(attachment => ({
      contentType: attachment.contentType,
      content: attachment.content,
      ...attachment.filename !== undefined ? { filename: attachment.filename } : {},
      ...attachment.related && attachment.cid !== undefined ? { cid: attachment.cid } : {},
    })),
  }
}

/** Threading headers of a message being answered. */
export interface ReplyContext {
  messageId?: string
  references: string[]
  subject?: string
  replyTo?: string
}

/**
 * Read the threading headers a reply needs.
 * @param parsed - the parsed MIME message being answered.
 * @returns its message id, references chain, subject, and reply address.
 */
export function replyContext(parsed: ParsedMail): ReplyContext {
  const references = parsed.references === undefined ? [] : Array.isArray(parsed.references) ? parsed.references : [parsed.references]
  return {
    ...parsed.messageId !== undefined ? { messageId: parsed.messageId } : {},
    references: parsed.messageId === undefined ? references : [...references, parsed.messageId],
    ...parsed.subject !== undefined ? { subject: parsed.subject } : {},
    ...optional('replyTo', addressText(parsed.replyTo) ?? addressText(parsed.from)),
  }
}

/**
 * Spread helper that omits an absent string field.
 * @param key - the field name.
 * @param value - the field value, or `undefined` to omit the field.
 * @returns a one-field object, or an empty object when the value is absent.
 */
export function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined ? {} : { [key]: value } as Record<K, string>
}
