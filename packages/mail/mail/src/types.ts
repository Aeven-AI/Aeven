/** Request, result, and account vocabulary of the mail capability seam (`ctx.mail`). */

import type { Branded } from '@aeven/brand'

/** Durable identity of one mail account, minted by the account source that owns it. */
export type MailAccountId = Branded<'mail-account-id'>

/** Transport security: implicit TLS, or a mandatory STARTTLS upgrade. Plaintext is never offered. */
export type MailSecurity = 'tls' | 'starttls'

/** Receive protocol of one account. */
export type MailReceiveProtocol = 'imap' | 'pop3'

/** One server binding of an account. */
export interface MailServer {
  host: string
  port: number
  security: MailSecurity
  username: string
}

/** The receive binding; POP3 supports implicit TLS only. */
export interface MailReceiveServer extends MailServer {
  protocol: MailReceiveProtocol
}

/** Non-secret account settings. */
export interface MailAccountSettings {
  /** Primary address; the model names the account by it. */
  address: string
  /** Further addresses this account may send as. */
  aliases: string[]
  receive: MailReceiveServer
  /** Absent for a receive-only account. */
  send?: MailServer
}

/** Account passwords; `sendPassword` absent means the send binding reuses `receivePassword`. */
export interface MailSecret {
  receivePassword: string
  sendPassword?: string
}

/** One account an {@link MailAccountSource} offers for an owner. */
export interface MailAccount {
  id: MailAccountId
  owner: string
  settings: MailAccountSettings
}

/** Supplier of accounts and their secrets, registered through `ctx.mail.registerSource()`. */
export interface MailAccountSource {
  /** Registry key; duplicates are rejected. */
  readonly id: string
  /**
   * List the owner's usable accounts without network access.
   * @param owner - the signed-in account id of the conversation owner.
   * @returns enabled accounts whose credential is present and not marked rejected.
   */
  list(owner: string): Promise<readonly MailAccount[]>
  /**
   * Read one account's passwords.
   * @param account - an account this source listed.
   * @returns the stored secret, or `undefined` when it was removed.
   */
  secret(account: MailAccount): Promise<MailSecret | undefined>
  /**
   * Record that a server rejected the stored credential, so the account stops being listed until it is replaced.
   * @param account - the account whose credential was rejected.
   */
  authenticationFailed(account: MailAccount): Promise<void>
}

/** Model-facing summary of one account. */
export interface MailAccountView {
  address: string
  aliases: string[]
  protocol: MailReceiveProtocol
  canSend: boolean
}

/** One IMAP folder; `specialUse` is the RFC 6154 attribute such as `\Sent`. */
export interface MailFolderView {
  path: string
  specialUse?: string
}

/** Address of one message: the account address, folder path, and the folder-scoped message id (IMAP UID or POP3 UIDL). */
export interface MailMessageRef {
  account: string
  folder: string
  id: string
}

/** Envelope search; every filter is optional and filters combine with AND. */
export interface MailSearchRequest {
  /** Account address; omitted searches every account. */
  account?: string
  /** Folder path; defaults to `INBOX`. */
  folder?: string
  from?: string
  to?: string
  subject?: string
  /** Full-text match over headers and body; IMAP only. */
  text?: string
  /** ISO date; messages received on or after it. */
  since?: string
  /** ISO date; messages received before it. */
  before?: string
  /** IMAP only. */
  unread?: boolean
  /** Result cap; the service bounds it by its configured maximum. */
  limit?: number
}

/** One search hit. */
export interface MailEnvelope extends MailMessageRef {
  date?: string
  from?: string
  to?: string
  subject?: string
  /** Absent for POP3, which has no flags. */
  unread?: boolean
  flagged?: boolean
  size?: number
}

/** Search outcome, newest first. */
export interface MailSearchResult {
  messages: MailEnvelope[]
  /** True when more messages matched than were returned. */
  truncated: boolean
  /** Accounts that could not be searched during a multi-account search. */
  failures: { account: string; error: string }[]
}

/** Metadata of one attachment; `index` addresses it for saving. */
export interface MailAttachmentView {
  index: number
  filename?: string
  contentType: string
  size: number
}

/** One message's headers and text body. */
export interface MailMessage extends MailMessageRef {
  messageId?: string
  date?: string
  from?: string
  to?: string
  cc?: string
  replyTo?: string
  subject?: string
  /** Plain text body; HTML-only messages are converted to text without fetching remote resources. */
  text: string
  /** True when `text` was cut at the configured character cap. */
  truncated: boolean
  attachments: MailAttachmentView[]
}

/** One attachment's bytes. */
export interface MailAttachment {
  filename?: string
  contentType: string
  content: Uint8Array
}

/** Message state change; POP3 supports `delete` only. */
export type MailUpdateAction = 'read' | 'unread' | 'flag' | 'unflag' | 'move' | 'archive' | 'trash' | 'delete'

/** Change applied to messages of one folder. */
export interface MailUpdateRequest {
  account: string
  folder: string
  ids: string[]
  action: MailUpdateAction
  /** Target folder path; required by `move` only. */
  destination?: string
}

/** Outgoing message, or a draft appended to the account's Drafts folder. */
export interface MailSendRequest {
  account: string
  /** Sender address; defaults to the account address and must be the address or an alias. */
  from?: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  /** Defaults to `Re: <original subject>` for a reply. */
  subject?: string
  text: string
  /** Message being answered; sets threading headers. */
  replyTo?: { folder: string; id: string }
  /** Append to Drafts instead of sending; IMAP only. */
  draft?: boolean
}

/** Send or draft outcome. */
export interface MailSendResult {
  messageId: string
  draft: boolean
  accepted: string[]
  rejected: string[]
}

/** Probe step that failed while verifying new account settings. */
export type MailProbeStep = 'receive-connect' | 'receive-authenticate' | 'receive-list' | 'send-connect' | 'send-authenticate'

/** Failure categories; messages are fixed text that never carries server responses or credentials. */
export type MailErrorCode =
  | 'MAIL_DUPLICATE_SOURCE'
  | 'MAIL_ACCOUNT_NOT_FOUND'
  | 'MAIL_ACCOUNT_AMBIGUOUS'
  | 'MAIL_UNSUPPORTED'
  | 'MAIL_INVALID'
  | 'MAIL_AUTHENTICATION'
  | 'MAIL_CONNECTION'
  | 'MAIL_TLS'
  | 'MAIL_NOT_FOUND'
  | 'MAIL_LIMIT'
  | 'MAIL_SENDER'
  | 'MAIL_RATE_LIMIT'
  | 'MAIL_PROTOCOL'
