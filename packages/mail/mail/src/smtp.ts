/** SMTP send provider and MIME composition for drafts. */

import { createTransport } from 'nodemailer'
import { MailError, toMailError } from './errors.ts'
import type { MailServer } from './types.ts'

/** SMTP timing. */
export interface SmtpTiming {
  /** TCP, TLS, and greeting budget in milliseconds. */
  timeoutMs: number
  /** Socket inactivity budget in milliseconds. */
  socketTimeoutMs: number
}

/** One composed message. */
export interface ComposedMessage {
  from: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
  inReplyTo?: string
  references: string[]
}

function transportOptions(server: MailServer, password: string, timing: SmtpTiming) {
  return {
    host: server.host,
    port: server.port,
    secure: server.security === 'tls',
    requireTLS: server.security === 'starttls',
    auth: { user: server.username, pass: password },
    connectionTimeout: timing.timeoutMs,
    greetingTimeout: timing.timeoutMs,
    socketTimeout: timing.socketTimeoutMs,
    logger: false,
    debug: false,
    tls: { rejectUnauthorized: true },
  }
}

function mailOptions(message: ComposedMessage) {
  return {
    from: message.from,
    to: message.to,
    ...message.cc.length > 0 ? { cc: message.cc } : {},
    ...message.bcc.length > 0 ? { bcc: message.bcc } : {},
    subject: message.subject,
    text: message.text,
    ...message.inReplyTo !== undefined ? { inReplyTo: message.inReplyTo } : {},
    ...message.references.length > 0 ? { references: message.references } : {},
  }
}

/**
 * Verify a send binding by connecting and authenticating.
 * @param server - the send binding.
 * @param password - the send password.
 * @param timing - connection budgets.
 */
export async function probeSmtp(server: MailServer, password: string, timing: SmtpTiming): Promise<void> {
  const transport = createTransport(transportOptions(server, password, timing))
  try {
    await transport.verify()
  } catch (error) {
    const failure = toMailError(error, 'send')
    throw new MailError(failure.message, failure.code, failure.code === 'MAIL_AUTHENTICATION' ? 'send-authenticate' : 'send-connect')
  } finally {
    transport.close()
  }
}

/**
 * Submit one message.
 * @param server - the send binding.
 * @param password - the send password.
 * @param timing - connection budgets.
 * @param message - the message.
 * @param signal - cancellation; aborting closes the connection.
 * @returns the Message-ID and the recipients the server accepted and rejected.
 */
export async function sendSmtp(server: MailServer, password: string, timing: SmtpTiming, message: ComposedMessage, signal?: AbortSignal): Promise<{ messageId: string; accepted: string[]; rejected: string[] }> {
  signal?.throwIfAborted()
  const transport = createTransport(transportOptions(server, password, timing))
  const onAbort = (): void => { transport.close() }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const info = await transport.sendMail(mailOptions(message))
    const addresses = (list: unknown): string[] => Array.isArray(list)
      ? list.map(entry => typeof entry === 'string' ? entry : String((entry as { address?: unknown }).address ?? ''))
      : []
    return { messageId: info.messageId, accepted: addresses(info.accepted), rejected: addresses(info.rejected) }
  } catch (error) {
    throw toMailError(error, 'send')
  } finally {
    signal?.removeEventListener('abort', onAbort)
    transport.close()
  }
}

/**
 * Compose a message as RFC 5322 bytes without sending it.
 * @param message - the message.
 * @returns the raw message and its Message-ID.
 */
export async function composeMessage(message: ComposedMessage): Promise<{ raw: Buffer; messageId: string }> {
  const transport = createTransport({ streamTransport: true, buffer: true, newline: 'windows' })
  const info = await transport.sendMail(mailOptions(message))
  return { raw: info.message as Buffer, messageId: info.messageId }
}
