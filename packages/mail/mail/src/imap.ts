/** IMAP receive provider: pooled connections, folder discovery, envelope search, message fetch, and state changes. */

import { createHash } from 'node:crypto'
import { ImapFlow, type MessageAddressObject, type SearchObject } from 'imapflow'
import { assertNever } from '@aeven/util-values'
import { MailError, toMailError } from './errors.ts'
import { optional } from './message.ts'
import type { MailEnvelope, MailFolderView, MailSearchRequest, MailServer, MailUpdateRequest } from './types.ts'

/** Connection timing shared by every IMAP connection. */
export interface ImapTiming {
  /** TCP, TLS, and greeting budget in milliseconds. */
  timeoutMs: number
  /** Socket inactivity budget in milliseconds. */
  socketTimeoutMs: number
}

/** A special-use attribute this provider resolves to a folder path. */
export type SpecialUse = '\\Drafts' | '\\Trash' | '\\Archive' | '\\All' | '\\Sent'

/**
 * Build an unconnected client that verifies certificates and never authenticates in plaintext.
 * @param server - the receive binding the client connects to.
 * @param password - the receive password used at login.
 * @param timing - connection, greeting, and socket inactivity budgets.
 * @returns the unconnected client, ready for {@link ImapPool} to log in.
 */
export function imapClient(server: MailServer, password: string, timing: ImapTiming): ImapFlow {
  return new ImapFlow({
    host: server.host,
    port: server.port,
    secure: server.security === 'tls',
    ...server.security === 'starttls' ? { doSTARTTLS: true } : {},
    auth: { user: server.username, pass: password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: timing.timeoutMs,
    greetingTimeout: timing.timeoutMs,
    socketTimeout: timing.socketTimeoutMs,
    tls: { rejectUnauthorized: true },
    clientInfo: { name: 'Aeven' },
  })
}

/** One pooled connection and the calls currently using it. */
interface PoolEntry {
  client: Promise<ImapFlow>
  users: number
  timer?: NodeJS.Timeout
}

/** Keeps one authenticated connection per account and credential, closed after an idle period or on {@link ImapPool.closeAll}. */
export class ImapPool {
  private readonly entries = new Map<string, PoolEntry>()

  /** @param idleTimeoutMs - how long an unused connection stays open. */
  constructor(private readonly idleTimeoutMs: number) {}

  /**
   * Pool key for one account binding; a changed host, username, or password yields a new connection.
   * @param accountId - the account identity.
   * @param server - the receive binding.
   * @param password - the receive password.
   * @returns an opaque key that does not contain the password.
   */
  static key(accountId: string, server: MailServer, password: string): string {
    return createHash('sha256').update(JSON.stringify([accountId, server, password])).digest('hex')
  }

  /**
   * Run one operation on the pooled connection for `key`, connecting first when needed.
   * Abort closes the connection so the pending command settles.
   * @param key - from {@link ImapPool.key}.
   * @param create - builds the unconnected client.
   * @param run - the operation.
   * @param signal - cancellation.
   * @returns the operation's result.
   */
  async use<T>(key: string, create: () => ImapFlow, run: (client: ImapFlow) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    let entry = this.entries.get(key)
    if (entry === undefined) {
      const created: PoolEntry = { users: 0, client: Promise.resolve(undefined as never) }
      created.client = (async () => {
        const client = create()
        // Errors also reject the pending command; the listener keeps an emitted error from becoming uncaught.
        client.on('error', () => {})
        client.on('close', () => { this.drop(key, created) })
        await client.connect()
        return client
      })()
      created.client.catch(() => { this.drop(key, created) })
      this.entries.set(key, created)
      entry = created
    }
    const current = entry
    current.users++
    clearTimeout(current.timer)
    const onAbort = (): void => { void current.client.then((client) => { client.close() }, () => {}) }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      return await run(await current.client)
    } finally {
      signal?.removeEventListener('abort', onAbort)
      current.users--
      if (current.users === 0 && this.entries.get(key) === current) {
        current.timer = setTimeout(() => {
          this.drop(key, current)
          void current.client.then(client => client.logout(), () => {}).catch(() => {})
        }, this.idleTimeoutMs)
        current.timer.unref()
      }
    }
  }

  /** Close every pooled connection. */
  closeAll(): void {
    for (const [key, entry] of this.entries) {
      this.drop(key, entry)
      void entry.client.then((client) => { client.close() }, () => {})
    }
  }

  private drop(key: string, entry: PoolEntry): void {
    clearTimeout(entry.timer)
    if (this.entries.get(key) === entry) this.entries.delete(key)
  }
}

/**
 * Verify a receive binding: connect, authenticate, and list folders on a fresh connection.
 * @param server - the receive binding.
 * @param password - the receive password.
 * @param timing - connection budgets.
 */
export async function probeImap(server: MailServer, password: string, timing: ImapTiming): Promise<void> {
  const client = imapClient(server, password, timing)
  client.on('error', () => {})
  try {
    await client.connect()
  } catch (error) {
    const failure = toMailError(error, 'receive')
    throw new MailError(failure.message, failure.code, failure.code === 'MAIL_AUTHENTICATION' ? 'receive-authenticate' : 'receive-connect')
  }
  try {
    await client.list()
  } catch (error) {
    throw new MailError(toMailError(error, 'receive').message, 'MAIL_PROTOCOL', 'receive-list')
  } finally {
    await client.logout().catch(() => { client.close() })
  }
}

/**
 * List every folder with its special-use attribute.
 * @param client - the logged-in receive client.
 * @returns each folder path with its special-use attribute where the server states one.
 */
export async function listFolders(client: ImapFlow): Promise<MailFolderView[]> {
  return (await client.list()).map(folder => ({
    path: folder.path,
    ...folder.specialUse !== undefined ? { specialUse: folder.specialUse } : {},
  }))
}

/**
 * Resolve a special-use folder path, or `undefined` when the server has none.
 * @param client - the logged-in receive client.
 * @param use - the special-use attribute to resolve.
 * @returns the folder path the server marks with that attribute, or `undefined`.
 */
export async function specialFolder(client: ImapFlow, use: SpecialUse): Promise<string | undefined> {
  return (await client.list()).find(folder => folder.specialUse === use)?.path
}

function formatAddresses(addresses: MessageAddressObject[] | undefined): string | undefined {
  if (addresses === undefined || addresses.length === 0) return undefined
  return addresses.map(entry => entry.name !== undefined && entry.name !== ''
    ? `${entry.name} <${entry.address ?? ''}>`
    : entry.address ?? '').join(', ')
}

/**
 * Parse an ISO date filter.
 * @param value - the model-supplied date.
 * @param name - the filter name for the error message.
 * @returns the date, or `undefined` when absent.
 */
export function dateFilter(value: string | undefined, name: string): Date | undefined {
  if (value === undefined) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new MailError(`${name} must be an ISO date such as 2026-10-01.`, 'MAIL_INVALID')
  return date
}

/**
 * Parse IMAP UIDs.
 * @param ids - model-supplied message ids.
 * @returns the UIDs.
 */
export function uids(ids: readonly string[]): number[] {
  return ids.map((id) => {
    if (!/^[1-9]\d*$/.test(id)) throw new MailError(`"${id}" is not a message id from this IMAP folder.`, 'MAIL_INVALID')
    return Number(id)
  })
}

/**
 * Search one folder and return the newest matching envelopes.
 * @param client - connected client.
 * @param account - the account address recorded on each envelope.
 * @param request - filters; `folder` defaults to `INBOX`.
 * @param limit - result cap.
 * @returns newest-first envelopes and whether more matched.
 */
export async function searchImap(
  client: ImapFlow,
  account: string,
  request: MailSearchRequest,
  limit: number,
): Promise<{ messages: MailEnvelope[]; truncated: boolean }> {
  const folder = request.folder ?? 'INBOX'
  const since = dateFilter(request.since, 'since')
  const before = dateFilter(request.before, 'before')
  const query: SearchObject = {
    ...request.from !== undefined ? { from: request.from } : {},
    ...request.to !== undefined ? { to: request.to } : {},
    ...request.subject !== undefined ? { subject: request.subject } : {},
    ...request.text !== undefined ? { text: request.text } : {},
    ...since !== undefined ? { since } : {},
    ...before !== undefined ? { before } : {},
    ...request.unread !== undefined ? { seen: !request.unread } : {},
  }
  const lock = await client.getMailboxLock(folder, { readOnly: true })
  try {
    const found = await client.search(Object.keys(query).length === 0 ? { all: true } : query, { uid: true })
    const matched = Array.isArray(found) ? found : []
    const selected = matched.slice(-limit)
    const messages: MailEnvelope[] = []
    if (selected.length > 0) {
      for await (const message of client.fetch(selected, { uid: true, envelope: true, flags: true, size: true }, { uid: true })) {
        const envelope = message.envelope
        const date = envelope?.date === undefined ? undefined : new Date(envelope.date)
        messages.push({
          account, folder, id: String(message.uid),
          ...date !== undefined && !Number.isNaN(date.getTime()) ? { date: date.toISOString() } : {},
          ...optional('from', formatAddresses(envelope?.from)),
          ...optional('to', formatAddresses(envelope?.to)),
          ...envelope?.subject !== undefined ? { subject: envelope.subject } : {},
          unread: message.flags?.has('\\Seen') !== true,
          flagged: message.flags?.has('\\Flagged') === true,
          ...message.size !== undefined ? { size: message.size } : {},
        })
      }
    }
    messages.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    return { messages, truncated: matched.length > selected.length }
  } finally {
    lock.release()
  }
}

/**
 * Fetch one message's raw source without setting `\Seen`.
 * @param client - connected client.
 * @param folder - folder path.
 * @param id - IMAP UID.
 * @param maxBytes - refuse messages larger than this.
 * @returns the raw RFC 5322 bytes.
 */
export async function fetchSource(client: ImapFlow, folder: string, id: string, maxBytes: number): Promise<Buffer> {
  const [uid] = uids([id])
  const lock = await client.getMailboxLock(folder, { readOnly: true })
  try {
    const head = await client.fetchOne(String(uid), { uid: true, size: true }, { uid: true })
    if (head === false || head === undefined) throw new MailError('No message with that id exists in this folder.', 'MAIL_NOT_FOUND')
    if (head.size !== undefined && head.size > maxBytes) {
      throw new MailError(`The message is ${String(head.size)} bytes, above the ${String(maxBytes)}-byte limit.`, 'MAIL_LIMIT')
    }
    const message = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true })
    if (message === false || message === undefined || message.source === undefined) {
      throw new MailError('No message with that id exists in this folder.', 'MAIL_NOT_FOUND')
    }
    return message.source
  } finally {
    lock.release()
  }
}

/**
 * Apply one state change to messages of a folder.
 * @param client - connected client.
 * @param request - the change.
 * @returns the number of addressed messages.
 */
export async function updateImap(client: ImapFlow, request: MailUpdateRequest): Promise<number> {
  const range = uids(request.ids)
  const target = request.action === 'move'
    ? request.destination
    : request.action === 'archive'
      ? await specialFolder(client, '\\Archive') ?? await specialFolder(client, '\\All')
      : request.action === 'trash' ? await specialFolder(client, '\\Trash') : undefined
  if (request.action === 'move' && target === undefined) throw new MailError('move needs a destination folder.', 'MAIL_INVALID')
  if (request.action === 'archive' && target === undefined) throw new MailError('This account has no archive folder; move the messages to a folder instead.', 'MAIL_UNSUPPORTED')
  if (request.action === 'trash' && target === undefined) throw new MailError('This account has no trash folder; use delete instead.', 'MAIL_UNSUPPORTED')
  const lock = await client.getMailboxLock(request.folder)
  try {
    switch (request.action) {
      case 'read': await client.messageFlagsAdd(range, ['\\Seen'], { uid: true }); break
      case 'unread': await client.messageFlagsRemove(range, ['\\Seen'], { uid: true }); break
      case 'flag': await client.messageFlagsAdd(range, ['\\Flagged'], { uid: true }); break
      case 'unflag': await client.messageFlagsRemove(range, ['\\Flagged'], { uid: true }); break
      case 'delete': await client.messageDelete(range, { uid: true }); break
      case 'move':
      case 'archive':
      case 'trash':
        if (target === request.folder) {
          if (request.action === 'trash') await client.messageDelete(range, { uid: true })
        } else if (target !== undefined) {
          await client.messageMove(range, target, { uid: true })
        }
        break
      default: assertNever(request.action, 'mail update action')
    }
    return range.length
  } finally {
    lock.release()
  }
}

/**
 * Append a composed message to the Drafts folder.
 * @param client - connected client.
 * @param raw - RFC 5322 bytes.
 */
export async function appendDraft(client: ImapFlow, raw: Buffer): Promise<void> {
  const drafts = await specialFolder(client, '\\Drafts')
  if (drafts === undefined) throw new MailError('This account has no Drafts folder.', 'MAIL_UNSUPPORTED')
  if (await client.append(drafts, raw, ['\\Draft', '\\Seen']) === false) throw new MailError('The draft could not be saved.', 'MAIL_PROTOCOL')
}
