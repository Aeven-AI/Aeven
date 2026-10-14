/**
 * Service Definition for the mail capability seam (`ctx.mail`): an account-source registry and
 * owner-scoped mail operations over IMAP, POP3, and SMTP. Every operation resolves the named
 * account through the registered sources for the given owner before a socket opens, so an
 * account that is missing, disabled, removed, or owned by someone else is refused here.
 * @module @aeven/mail
 */

import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { MailError, toMailError } from './errors.ts'
import { appendDraft, fetchSource, imapClient, ImapPool, listFolders, probeImap, searchImap, updateImap } from './imap.ts'
import { attachmentAt, parseSource, replyContext, toMailMessage } from './message.ts'
import { deletePop3, fetchPop3, POP3_FOLDER, probePop3, searchPop3, withPop3 } from './pop3.ts'
import { composeMessage, probeSmtp, sendSmtp, type ComposedMessage } from './smtp.ts'
import type {
  MailAccount, MailAccountId, MailAccountSettings, MailAccountSource, MailAccountView, MailAttachment, MailEnvelope,
  MailFolderView, MailMessage, MailMessageRef, MailSearchRequest, MailSearchResult, MailSecret, MailSendRequest,
  MailSendResult, MailUpdateRequest,
} from './types.ts'
import type { ImapFlow } from 'imapflow'
import type Pop3Command from 'node-pop3'

export { MailError } from './errors.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Mail accounts and operations. */
    mail: MailService
  }
}

/** Deployment limits and timing for every mail account. */
export interface Config {
  /** TCP, TLS, and greeting budget in milliseconds. */
  timeoutMs: number
  /** Socket inactivity budget in milliseconds. */
  socketTimeoutMs: number
  /** How long an unused IMAP connection stays open. */
  idleTimeoutMs: number
  /** Upper bound on envelopes returned by one search. */
  searchMaxResults: number
  /** Upper bound on body characters returned by one read. */
  bodyMaxChars: number
  /** Largest message read or attachment saved, in bytes. */
  messageMaxBytes: number
  /** Newest POP3 messages whose headers one search reads. */
  pop3ScanLimit: number
  /** Messages one account may send per rolling hour. */
  sendsPerHour: number
}

/** One resolved account and the source that owns it. */
interface Entry {
  source: MailAccountSource
  account: MailAccount
}

const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/
const HOST = /^[A-Za-z0-9.-]+$/

/**
 * The mail service, registered as `ctx.mail`. Messages and errors returned to callers never
 * contain passwords; error text is fixed per failure category.
 */
export default class MailService extends Service {
  static Config: Schema<Config> = Schema.object({
    timeoutMs: Schema.natural().min(1).default(30_000),
    socketTimeoutMs: Schema.natural().min(1).default(120_000),
    idleTimeoutMs: Schema.natural().min(1).default(300_000),
    searchMaxResults: Schema.natural().min(1).default(50),
    bodyMaxChars: Schema.natural().min(1).default(20_000),
    messageMaxBytes: Schema.natural().min(1).default(25 * 1024 * 1024),
    pop3ScanLimit: Schema.natural().min(1).default(200),
    sendsPerHour: Schema.natural().min(1).default(30),
  })

  private readonly sources = new Map<string, MailAccountSource>()
  private readonly pool: ImapPool
  private readonly sent = new Map<MailAccountId, number[]>()

  /**
   * @param ctx - plugin context.
   * @param config - deployment limits and timing.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'mail')
    this.pool = new ImapPool(config.idleTimeoutMs)
  }

  /** Close pooled IMAP connections with the plugin. */
  [Service.init](): void {
    this.ctx.effect(() => () => { this.pool.closeAll() }, 'mail: IMAP connections')
  }

  /**
   * Register an account source. Throws {@link MailError} `MAIL_DUPLICATE_SOURCE` for a taken id.
   * @param source - the source; its `id` is the registry key.
   * @returns the disposer that unregisters the source; also disposed with the calling fiber.
   */
  registerSource(source: MailAccountSource): () => void {
    if (this.sources.has(source.id)) throw new MailError(`a mail account source with id "${source.id}" is already registered`, 'MAIL_DUPLICATE_SOURCE')
    const sources = this.sources
    const dispose = this.ctx.effect(function* () {
      sources.set(source.id, source)
      yield () => sources.delete(source.id)
    }, 'mail.registerSource()')
    return () => void dispose()
  }

  /**
   * List the owner's usable accounts without network access.
   * @param owner - the conversation owner.
   * @returns one view per account.
   */
  async accounts(owner: string): Promise<MailAccountView[]> {
    return (await this.entries(owner)).map(({ account: { settings } }) => ({
      address: settings.address, aliases: settings.aliases, protocol: settings.receive.protocol, canSend: settings.send !== undefined,
    }))
  }

  /**
   * List one account's folders; a POP3 account has `INBOX` only.
   * @param owner - the conversation owner.
   * @param account - account address.
   * @param signal - cancellation.
   * @returns folder paths with special-use attributes.
   */
  async folders(owner: string, account: string, signal?: AbortSignal): Promise<MailFolderView[]> {
    const entry = await this.resolve(owner, account)
    if (entry.account.settings.receive.protocol === 'pop3') return [{ path: POP3_FOLDER }]
    return this.imap(entry, client => listFolders(client), signal)
  }

  /**
   * Search envelopes in one account, or in every account when `request.account` is omitted.
   * @param owner - the conversation owner.
   * @param request - filters and result cap.
   * @param signal - cancellation.
   * @returns newest-first envelopes, a truncation flag, and per-account failures of a multi-account search.
   */
  async search(owner: string, request: MailSearchRequest, signal?: AbortSignal): Promise<MailSearchResult> {
    const limit = Math.min(Math.max(1, Math.floor(request.limit ?? this.config.searchMaxResults)), this.config.searchMaxResults)
    if (request.account !== undefined) {
      const result = await this.searchOne(await this.resolve(owner, request.account), request, limit, signal)
      return { ...result, failures: [] }
    }
    const entries = await this.entries(owner)
    if (entries.length === 0) throw new MailError('No mail account is connected. Add one in Settings → Connectors → Email.', 'MAIL_ACCOUNT_NOT_FOUND')
    const failures: MailSearchResult['failures'] = []
    const messages: MailEnvelope[] = []
    const truncations = await Promise.all(entries.map(async (entry) => {
      try {
        const result = await this.searchOne(entry, request, limit, signal)
        messages.push(...result.messages)
        return result.truncated
      } catch (error) {
        failures.push({ account: entry.account.settings.address, error: toMailError(error, 'receive').message })
        return false
      }
    }))
    signal?.throwIfAborted()
    const firstFailure = failures[0]
    if (firstFailure !== undefined && failures.length === entries.length) throw new MailError(firstFailure.error, 'MAIL_PROTOCOL')
    messages.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    return { messages: messages.slice(0, limit), truncated: truncations.some(Boolean) || messages.length > limit, failures }
  }

  /**
   * Read one message's headers, bounded text body, and attachment list. Reading does not mark the message read.
   * @param owner - the conversation owner.
   * @param ref - the message.
   * @param signal - cancellation.
   * @returns the message.
   */
  async read(owner: string, ref: MailMessageRef, signal?: AbortSignal): Promise<MailMessage> {
    const entry = await this.resolve(owner, ref.account)
    const parsed = await parseSource(await this.source(entry, ref, signal))
    return toMailMessage({ ...ref, account: entry.account.settings.address }, parsed, { bodyMaxChars: this.config.bodyMaxChars })
  }

  /**
   * Read one attachment's bytes.
   * @param owner - the conversation owner.
   * @param ref - the message.
   * @param index - attachment index from {@link MailService.read}.
   * @param signal - cancellation.
   * @returns the attachment.
   */
  async attachment(owner: string, ref: MailMessageRef, index: number, signal?: AbortSignal): Promise<MailAttachment> {
    const entry = await this.resolve(owner, ref.account)
    const attachment = attachmentAt(await parseSource(await this.source(entry, ref, signal)), index)
    if (attachment === undefined) throw new MailError(`The message has no attachment ${String(index)}.`, 'MAIL_NOT_FOUND')
    return attachment
  }

  /**
   * Change message state.
   * @param owner - the conversation owner.
   * @param request - the change.
   * @param signal - cancellation.
   * @returns the number of addressed messages.
   */
  async update(owner: string, request: MailUpdateRequest, signal?: AbortSignal): Promise<number> {
    if (request.ids.length === 0) throw new MailError('ids must name at least one message.', 'MAIL_INVALID')
    const entry = await this.resolve(owner, request.account)
    if (entry.account.settings.receive.protocol === 'imap') return this.imap(entry, client => updateImap(client, request), signal)
    if (request.action !== 'delete') throw new MailError('POP3 accounts support delete only; they have no flags or folders.', 'MAIL_UNSUPPORTED')
    if (request.folder !== POP3_FOLDER) throw new MailError('POP3 accounts have only the INBOX folder.', 'MAIL_UNSUPPORTED')
    return this.pop3(entry, pop3 => deletePop3(pop3, request.ids), signal)
  }

  /**
   * Send a message over SMTP, or append it to Drafts. The sender must be the account address or an alias.
   * @param owner - the conversation owner.
   * @param request - the message.
   * @param signal - cancellation.
   * @returns the Message-ID and recipient outcome.
   */
  async send(owner: string, request: MailSendRequest, signal?: AbortSignal): Promise<MailSendResult> {
    const entry = await this.resolve(owner, request.account)
    const { settings } = entry.account
    const from = (request.from ?? settings.address).trim()
    if (![settings.address, ...settings.aliases].some(address => address.toLowerCase() === from.toLowerCase())) {
      throw new MailError(`${from} is not an address of this account. Use ${[settings.address, ...settings.aliases].join(' or ')}.`, 'MAIL_SENDER')
    }
    const recipients = [...request.to, ...request.cc ?? [], ...request.bcc ?? []]
    if (recipients.some(address => !EMAIL.test(address.trim()))) throw new MailError('Every recipient must be a plain email address.', 'MAIL_INVALID')
    if (request.draft !== true && request.to.length === 0) throw new MailError('to must name at least one recipient.', 'MAIL_INVALID')
    const original = request.replyTo === undefined
      ? undefined
      : replyContext(await parseSource(await this.source(entry, { account: settings.address, ...request.replyTo }, signal)))
    const subject = request.subject ?? (original?.subject === undefined ? undefined : /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`)
    if (subject === undefined) throw new MailError('subject is required unless the message is a reply.', 'MAIL_INVALID')
    const message: ComposedMessage = {
      from, to: request.to, cc: request.cc ?? [], bcc: request.bcc ?? [], subject, text: request.text,
      ...original?.messageId !== undefined ? { inReplyTo: original.messageId } : {},
      references: original?.references ?? [],
    }
    if (request.draft === true) {
      if (settings.receive.protocol !== 'imap') throw new MailError('Drafts need an IMAP account.', 'MAIL_UNSUPPORTED')
      const { raw, messageId } = await composeMessage(message)
      await this.imap(entry, client => appendDraft(client, raw), signal)
      return { messageId, draft: true, accepted: [], rejected: [] }
    }
    const server = settings.send
    if (server === undefined) throw new MailError('This account has no outgoing server; save a draft instead.', 'MAIL_UNSUPPORTED')
    const now = Date.now()
    const recent = (this.sent.get(entry.account.id) ?? []).filter(time => time > now - 3_600_000)
    if (recent.length >= this.config.sendsPerHour) {
      throw new MailError(`This account reached its limit of ${String(this.config.sendsPerHour)} messages per hour.`, 'MAIL_RATE_LIMIT')
    }
    const secret = await this.secret(entry)
    const result = await this.guard(entry, 'send', () => sendSmtp(server, secret.sendPassword ?? secret.receivePassword, this.config, message, signal))
    this.sent.set(entry.account.id, [...recent, Date.now()])
    return { ...result, draft: false }
  }

  /**
   * Verify new account settings before they are saved: connect, authenticate, and list folders on the receive
   * server, then connect and authenticate on the send server. Throws {@link MailError} whose `step` names the failure.
   * @param settings - the account settings.
   * @param secret - the passwords.
   */
  async probe(settings: MailAccountSettings, secret: MailSecret): Promise<void> {
    validateSettings(settings)
    if (settings.receive.protocol === 'imap') await probeImap(settings.receive, secret.receivePassword, this.config)
    else await probePop3(settings.receive, secret.receivePassword,
      { timeoutMs: this.config.timeoutMs, scanLimit: this.config.pop3ScanLimit })
    if (settings.send !== undefined) await probeSmtp(settings.send, secret.sendPassword ?? secret.receivePassword, this.config)
  }

  private async entries(owner: string): Promise<Entry[]> {
    const lists = await Promise.all([...this.sources.values()].map(async source => (await source.list(owner))
      .filter(account => account.owner === owner)
      .map(account => ({ source, account }))))
    return lists.flat()
  }

  private async resolve(owner: string, address: string): Promise<Entry> {
    const entries = await this.entries(owner)
    const wanted = address.trim().toLowerCase()
    const matches = entries.filter(({ account }) => account.settings.address.toLowerCase() === wanted)
    if (matches.length > 1) throw new MailError(`More than one connected account uses ${address}.`, 'MAIL_ACCOUNT_AMBIGUOUS')
    const [match] = matches
    if (match !== undefined) return match
    const known = entries.map(({ account }) => account.settings.address)
    throw new MailError(known.length === 0
      ? 'No mail account is connected. Add one in Settings → Connectors → Email.'
      : `No connected mail account is ${address}. Connected accounts: ${known.join(', ')}.`, 'MAIL_ACCOUNT_NOT_FOUND')
  }

  private async secret(entry: Entry): Promise<MailSecret> {
    const secret = await entry.source.secret(entry.account)
    if (secret === undefined) throw new MailError('This account was removed. Add it again in Settings.', 'MAIL_ACCOUNT_NOT_FOUND')
    return secret
  }

  /** Run a server operation, and record a rejected credential with the account source. */
  private async guard<T>(entry: Entry, server: 'receive' | 'send', operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      const failure = toMailError(error, server)
      if (failure.code === 'MAIL_AUTHENTICATION') await entry.source.authenticationFailed(entry.account)
      throw failure
    }
  }

  private async imap<T>(entry: Entry, run: (client: ImapFlow) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const { receive } = entry.account.settings
    const { receivePassword } = await this.secret(entry)
    return this.guard(entry, 'receive', () => this.pool.use(
      ImapPool.key(entry.account.id, receive, receivePassword),
      () => imapClient(receive, receivePassword, this.config),
      run,
      signal,
    ))
  }

  private async pop3<T>(entry: Entry, run: (pop3: Pop3Command) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const { receivePassword } = await this.secret(entry)
    return this.guard(entry, 'receive', () => withPop3(entry.account.settings.receive, receivePassword,
      { timeoutMs: this.config.timeoutMs, scanLimit: this.config.pop3ScanLimit }, run, signal))
  }

  private async searchOne(
    entry: Entry,
    request: MailSearchRequest,
    limit: number,
    signal?: AbortSignal,
  ): Promise<{ messages: MailEnvelope[]; truncated: boolean }> {
    const address = entry.account.settings.address
    return entry.account.settings.receive.protocol === 'imap'
      ? this.imap(entry, client => searchImap(client, address, request, limit), signal)
      : this.pop3(entry, pop3 => searchPop3(pop3, address, request, limit, this.config.pop3ScanLimit), signal)
  }

  private async source(entry: Entry, ref: MailMessageRef, signal?: AbortSignal): Promise<Buffer | string> {
    if (entry.account.settings.receive.protocol === 'imap') {
      return this.imap(entry, client => fetchSource(client, ref.folder, ref.id, this.config.messageMaxBytes), signal)
    }
    if (ref.folder !== POP3_FOLDER) throw new MailError('POP3 accounts have only the INBOX folder.', 'MAIL_UNSUPPORTED')
    return this.pop3(entry, pop3 => fetchPop3(pop3, ref.id, this.config.messageMaxBytes), signal)
  }
}

/** Reject settings that cannot name a reachable server or that would allow plaintext authentication. */
function validateSettings(settings: MailAccountSettings): void {
  for (const address of [settings.address, ...settings.aliases]) {
    if (!EMAIL.test(address)) throw new MailError(`${address} is not an email address.`, 'MAIL_INVALID')
  }
  for (const server of [settings.receive, ...settings.send === undefined ? [] : [settings.send]]) {
    if (!HOST.test(server.host)) throw new MailError(`${server.host} is not a host name.`, 'MAIL_INVALID')
    if (!Number.isInteger(server.port) || server.port < 1 || server.port > 65_535) throw new MailError(`${String(server.port)} is not a port.`, 'MAIL_INVALID')
    if (server.username === '') throw new MailError('A username is required.', 'MAIL_INVALID')
  }
  if (settings.receive.protocol === 'pop3' && settings.receive.security !== 'tls') {
    throw new MailError('POP3 accounts require implicit TLS (usually port 995).', 'MAIL_UNSUPPORTED')
  }
}
