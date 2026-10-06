/** The mail failure type and the translation of library errors into fixed, credential-free messages. */

import type { MailErrorCode, MailProbeStep } from './types.ts'

/** A mail operation failure whose message is safe to show to the model and the account owner. */
export class MailError extends Error {
  override readonly name = 'MailError'

  /**
   * @param message - fixed explanatory text; never server response text.
   * @param code - failure category.
   * @param step - the probe step that failed, when the failure came from a probe.
   */
  constructor(message: string, readonly code: MailErrorCode, readonly step?: MailProbeStep) {
    super(message)
  }
}

const CONNECTION_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'ETIMEOUT',
  'EPIPE', 'NoConnection', 'ESOCKET', 'ECONNECTION', 'EDNS', 'ProtocolError', 'EConnectionClosed',
])

/** Library error fields read for classification; every field is optional because the source library varies. */
interface LibraryError {
  code?: unknown
  authenticationFailed?: unknown
  tlsFailed?: unknown
  serverResponseCode?: unknown
  responseCode?: unknown
  message?: unknown
}

/**
 * Classify a thrown IMAP, POP3, SMTP, or socket error. Server text is discarded because it can echo credentials or message content.
 * @param error - the thrown value.
 * @param server - `receive` or `send`, naming the binding in the message.
 * @returns a {@link MailError} with a fixed message.
 */
export function toMailError(error: unknown, server: 'receive' | 'send'): MailError {
  if (error instanceof MailError) return error
  const failure = (typeof error === 'object' && error !== null ? error : {}) as LibraryError
  const code = typeof failure.code === 'string' ? failure.code : ''
  const label = server === 'receive' ? 'incoming' : 'outgoing'
  if (failure.authenticationFailed === true || code === 'EAUTH' || failure.responseCode === 535) {
    return new MailError(`The ${label} mail server rejected the username or password.`, 'MAIL_AUTHENTICATION')
  }
  if (failure.tlsFailed === true || code === 'ETLS' || code.includes('CERT') || code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL')
    || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'SELF_SIGNED_CERT_IN_CHAIN') {
    return new MailError(`A secure connection to the ${label} mail server could not be verified. Check the host name and security setting.`, 'MAIL_TLS')
  }
  if (failure.serverResponseCode === 'NONEXISTENT') return new MailError('The folder does not exist.', 'MAIL_NOT_FOUND')
  if (code === 'EENVELOPE') return new MailError('The outgoing mail server rejected the sender or every recipient.', 'MAIL_INVALID')
  if (CONNECTION_CODES.has(code)) {
    return new MailError(`The ${label} mail server could not be reached. Check the host, port, and security setting.`, 'MAIL_CONNECTION')
  }
  return new MailError(`The ${label} mail server could not complete the request.`, 'MAIL_PROTOCOL')
}
