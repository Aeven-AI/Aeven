/**
 * New-email detection for `mail` event triggers. A poll is one envelope search per watched account and starts no
 * model turn; a cursor of seen message ids decides what is new, so a first poll only records the inbox it finds.
 */
import type MailService from '@aeven/mail'
import type { MailEnvelope } from '@aeven/mail'
import type { MailEventFilter } from './types.ts'

/** Most seen ids a cursor keeps, newest first. */
export const CURSOR_LIMIT = 1_000
/** Folder every mail trigger watches. */
const INBOX = 'INBOX'

/**
 * Envelopes of one account that arrived since its cursor.
 * @param mail - the mail service.
 * @param owner - the account's owner.
 * @param address - the mail account's address.
 * @param seen - ids the cursor holds, or undefined before the first poll.
 * @param signal - stops the search when the Host stops.
 * @returns the new envelopes, oldest first, and the cursor to store; a first poll returns no envelopes.
 */
export async function newMail(
  mail: MailService, owner: string, address: string, seen: readonly string[] | undefined, signal: AbortSignal,
): Promise<{ fresh: MailEnvelope[]; seen: string[] }> {
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)
  const { messages } = await mail.search(owner, { account: address, folder: INBOX, since, limit: 50 }, signal)
  const ids = messages.map(message => message.id)
  if (seen === undefined) return { fresh: [], seen: ids.slice(0, CURSOR_LIMIT) }
  const known = new Set(seen)
  const fresh = messages.filter(message => !known.has(message.id)).reverse()
  return { fresh, seen: [...fresh.map(message => message.id).reverse(), ...seen].slice(0, CURSOR_LIMIT) }
}

/**
 * Whether one envelope passes a trigger's filter.
 * @param filter - the trigger's filter.
 * @param address - the account the envelope arrived in.
 * @param envelope - the new message.
 * @returns whether every present filter field matches, case-insensitively.
 */
export function matchesMail(filter: MailEventFilter, address: string, envelope: MailEnvelope): boolean {
  const has = (value: string | undefined, part: string | undefined): boolean => part === undefined || (value ?? '').toLowerCase().includes(part.toLowerCase())
  return (filter.account === undefined || filter.account.toLowerCase() === address.toLowerCase())
    && has(envelope.from, filter.from) && has(envelope.subject, filter.subject)
}

/**
 * The lines a run reads about one new email.
 * @param address - the account it arrived in.
 * @param envelope - the new message.
 * @returns the event text; the run reads the body with `mail_read` when its bot is bound to email.
 */
export function describeMail(address: string, envelope: MailEnvelope): string {
  return [
    'New email',
    `Account: ${address}`,
    `From: ${envelope.from ?? ''}`,
    `Subject: ${envelope.subject ?? ''}`,
    `Date: ${envelope.date ?? ''}`,
    `Message: account ${address}, folder ${envelope.folder}, id ${envelope.id}`,
  ].join('\n')
}
