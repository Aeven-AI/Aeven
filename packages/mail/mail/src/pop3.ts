/** POP3 receive provider: one connection per call, INBOX only, header scan search, retrieve, and delete. */

import Pop3Command from 'node-pop3'
import { MailError, toMailError } from './errors.ts'
import { dateFilter } from './imap.ts'
import { addressText, optional, parseSource } from './message.ts'
import type { MailEnvelope, MailSearchRequest, MailServer } from './types.ts'

/** POP3 bounds and timing. */
export interface Pop3Options {
  /** Socket budget in milliseconds. */
  timeoutMs: number
  /** Newest messages whose headers one search reads. */
  scanLimit: number
}

/** The only folder a POP3 mailbox has. */
export const POP3_FOLDER = 'INBOX'

/**
 * Run one operation on a fresh POP3 session and end it with QUIT, which commits deletions.
 * @param server - the receive binding (implicit TLS).
 * @param password - the receive password.
 * @param options - timing.
 * @param run - the operation.
 * @param signal - cancellation; aborting ends the session without committing.
 * @returns the operation's result.
 */
export async function withPop3<T>(
  server: MailServer,
  password: string,
  options: Pop3Options,
  run: (pop3: Pop3Command) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (server.security !== 'tls') throw new MailError('POP3 accounts require implicit TLS (usually port 995).', 'MAIL_UNSUPPORTED')
  signal?.throwIfAborted()
  const pop3 = new Pop3Command({
    user: server.username, password, host: server.host, port: server.port, tls: true,
    timeout: options.timeoutMs, tlsOptions: { rejectUnauthorized: true }, servername: server.host,
  })
  const socket = (): { destroy(): void } | undefined => (pop3 as unknown as { _socket?: { destroy(): void } })._socket
  const onAbort = (): void => { socket()?.destroy() }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await run(pop3)
    await pop3.QUIT()
    return result
  } catch (error) {
    socket()?.destroy()
    throw toPop3Error(error)
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

/** node-pop3 tags a `-ERR` reply with the command it answered and a closed or silent socket with its event name. */
function toPop3Error(error: unknown): MailError {
  if (error instanceof MailError) return error
  const { command, eventName } = (error ?? {}) as { command?: unknown; eventName?: unknown }
  if (typeof command === 'string' && /^(USER|PASS|APOP|AUTH)\b/.test(command)) {
    return new MailError('The incoming mail server rejected the username or password.', 'MAIL_AUTHENTICATION')
  }
  if (eventName === 'timeout' || eventName === 'close' || eventName === 'end') {
    return new MailError('The incoming mail server could not be reached. Check the host, port, and security setting.', 'MAIL_CONNECTION')
  }
  return toMailError(error, 'receive')
}

/**
 * Verify a POP3 binding by authenticating and reading the mailbox status.
 * @param server - the receive binding.
 * @param password - the receive password.
 * @param options - timing.
 */
export async function probePop3(server: MailServer, password: string, options: Pop3Options): Promise<void> {
  try {
    await withPop3(server, password, options, pop3 => pop3.STAT())
  } catch (error) {
    const failure = toPop3Error(error)
    throw new MailError(failure.message, failure.code, failure.code === 'MAIL_AUTHENTICATION' ? 'receive-authenticate' : 'receive-connect')
  }
}

/** Map POP3 UIDL ids to the session's message numbers, oldest first. */
async function uidlTable(pop3: Pop3Command): Promise<{ number: number; uid: string }[]> {
  const rows = await pop3.UIDL()
  return rows.flatMap(row => Array.isArray(row) && row.length >= 2 ? [{ number: Number(row[0]), uid: String(row[1]) }] : [])
}

/**
 * Search the newest messages by header filters.
 * @param pop3 - open session.
 * @param account - the account address recorded on each envelope.
 * @param request - filters; `text` and `unread` are refused because POP3 has neither search nor flags.
 * @param limit - result cap.
 * @param scanLimit - newest messages whose headers are read.
 * @returns newest-first envelopes and whether more matched or were left unscanned.
 */
export async function searchPop3(
  pop3: Pop3Command,
  account: string,
  request: MailSearchRequest,
  limit: number,
  scanLimit: number,
): Promise<{ messages: MailEnvelope[]; truncated: boolean }> {
  if (request.folder !== undefined && request.folder !== POP3_FOLDER) throw new MailError('POP3 accounts have only the INBOX folder.', 'MAIL_UNSUPPORTED')
  if (request.text !== undefined || request.unread !== undefined) {
    throw new MailError('POP3 accounts support from, to, subject, since, and before filters only.', 'MAIL_UNSUPPORTED')
  }
  const since = dateFilter(request.since, 'since')
  const before = dateFilter(request.before, 'before')
  const table = await uidlTable(pop3)
  const scanned = table.slice(-scanLimit).reverse()
  const contains = (value: string | undefined, filter: string | undefined): boolean =>
    filter === undefined || (value ?? '').toLowerCase().includes(filter.toLowerCase())
  const messages: MailEnvelope[] = []
  let truncated = table.length > scanned.length
  for (const { number, uid } of scanned) {
    const headers = await pop3.TOP(number, 0)
    const parsed = await parseSource(typeof headers === 'string' ? headers : '')
    const from = addressText(parsed.from)
    const to = addressText(parsed.to)
    if (!contains(from, request.from) || !contains(to, request.to) || !contains(parsed.subject, request.subject)) continue
    if (since !== undefined && (parsed.date === undefined || parsed.date < since)) continue
    if (before !== undefined && (parsed.date === undefined || parsed.date >= before)) continue
    if (messages.length === limit) { truncated = true; break }
    messages.push({
      account, folder: POP3_FOLDER, id: uid,
      ...parsed.date !== undefined ? { date: parsed.date.toISOString() } : {},
      ...optional('from', from),
      ...optional('to', to),
      ...parsed.subject !== undefined ? { subject: parsed.subject } : {},
    })
  }
  return { messages, truncated }
}

/** Resolve a UIDL id to its message number in this session. */
async function messageNumber(pop3: Pop3Command, id: string): Promise<number> {
  const row = (await uidlTable(pop3)).find(entry => entry.uid === id)
  if (row === undefined) throw new MailError('No message with that id exists in this mailbox.', 'MAIL_NOT_FOUND')
  return row.number
}

/**
 * Retrieve one message's raw source.
 * @param pop3 - open session.
 * @param id - UIDL id.
 * @param maxBytes - refuse messages larger than this.
 * @returns the raw RFC 5322 text.
 */
export async function fetchPop3(pop3: Pop3Command, id: string, maxBytes: number): Promise<string> {
  const number = await messageNumber(pop3, id)
  const listing = await pop3.LIST(number)
  const size = Array.isArray(listing) ? Number(listing[1]) : Number.NaN
  if (Number.isFinite(size) && size > maxBytes) {
    throw new MailError(`The message is ${String(size)} bytes, above the ${String(maxBytes)}-byte limit.`, 'MAIL_LIMIT')
  }
  const source = await pop3.RETR(number)
  return typeof source === 'string' ? source : ''
}

/**
 * Mark messages for deletion; the deletion commits when {@link withPop3} sends QUIT.
 * @param pop3 - open session.
 * @param ids - UIDL ids.
 * @returns the number of deleted messages.
 */
export async function deletePop3(pop3: Pop3Command, ids: readonly string[]): Promise<number> {
  for (const id of ids) await pop3.DELE(await messageNumber(pop3, id))
  return ids.length
}
