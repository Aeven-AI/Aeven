/**
 * The five mail tool definitions over `ctx.mail`. Saved attachments land in the
 * directory this device resolves for the session's workspace, never the path the
 * session log recorded, so a conversation synced from another machine writes into
 * a folder that exists here.
 */

import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@aeven/tools'
import type { MailUpdateAction } from '@aeven/mail'
import { sessionDirectory } from '@aeven/working-directory'
import { formatAccounts, formatMessage, formatSearch, formatSend } from './format.ts'

/** Per-tool cooperative timeouts. */
export interface MailToolTiming {
  /** Budget for account, search, read, and update calls, in milliseconds. */
  timeoutMs: number
  /** Budget for send calls, in milliseconds. */
  sendTimeoutMs: number
}

const UPDATE_ACTIONS = ['read', 'unread', 'flag', 'unflag', 'move', 'archive', 'trash', 'delete'] as const satisfies readonly MailUpdateAction[]

const text = { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }] } as const

/** The signed-in owner of the calling conversation; mail is per account. */
function ownerOf(exec: ToolRunContext): string {
  const owner = exec.agent?.session.header.owner
  if (owner === undefined) throw new Error('Mail tools need a conversation that belongs to a signed-in user.')
  return owner
}

/**
 * Write attachment bytes inside the session's directory on this device without replacing existing files.
 * The base is this device's binding for the session's workspace; the recorded header path is never it, so a
 * conversation synced from another machine writes where its folder is here.
 * @param exec - the running `mail_read` call; its agent-scoped context resolves the directory.
 * @param directory - the folder to write into, resolved against the session directory and confined to it.
 * @param filename - the attachment's own filename, when the message names one.
 * @param content - the attachment bytes.
 * @returns the written path, relative to the session directory.
 * @throws {WorkingDirectoryUnavailableError} when the session's workspace has no folder on this device.
 */
async function saveAttachment(exec: ToolRunContext, directory: string, filename: string | undefined, content: Uint8Array): Promise<string> {
  const cwd = exec.agent === undefined ? undefined : sessionDirectory(exec.agent.ctx, exec.agent.session)
  if (cwd === undefined) throw new Error('Saving attachments needs a conversation with a workspace folder.')
  const root = await realpath(cwd)
  const target = resolve(root, directory)
  const inside = relative(root, target)
  if (isAbsolute(directory) || inside.startsWith('..') || isAbsolute(inside)) throw new Error('saveTo must be a folder inside the workspace.')
  await mkdir(target, { recursive: true })
  if (relative(root, await realpath(target)).startsWith(`..${sep}`)) throw new Error('saveTo must be a folder inside the workspace.')
  const name = basename(filename ?? 'attachment').replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').replace(/^\.+/, '_') || 'attachment'
  const dot = name.lastIndexOf('.')
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  for (let attempt = 0; ; attempt++) {
    const path = join(target, attempt === 0 ? name : `${stem} (${String(attempt)})${extension}`)
    try {
      await writeFile(path, content, { flag: 'wx', mode: 0o600 })
      return relative(root, path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt >= 100) throw error
    }
  }
}

/**
 * Build the mail tools.
 * @param mail - the mail service that runs every operation.
 * @param timing - cooperative timeouts.
 * @returns the five tool definitions.
 */
export function mailTools(mail: Context['mail'], timing: MailToolTiming): ToolDefinition[] {
  return [
    defineTool({
      name: 'mail_accounts',
      description: 'List the user\'s connected email accounts with their protocol, whether they can send, their aliases, and their IMAP folders. Call it before naming an account or folder you have not seen.',
      parameters: {},
      output: text,
      timeoutMs: timing.timeoutMs,
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const owner = ownerOf(exec)
        const views = await mail.accounts(owner)
        if (views.length === 0) return 'No email account is connected. The user can add one in Settings → Connectors → Email.'
        const accounts = await Promise.all(views.map(async (view) => {
          if (view.protocol === 'pop3') return { view }
          try {
            return { view, folders: await mail.folders(owner, view.address, exec.signal) }
          } catch (error) {
            return { view, error: error instanceof Error ? error.message : String(error) }
          }
        }))
        return formatAccounts(accounts)
      },
      presentCall: () => ({ card: 'generic', title: 'List email accounts', kind: 'read' }),
    }),
    defineTool({
      name: 'mail_search',
      description: 'Search email envelopes (date, sender, recipients, subject, flags), newest first. Omit account to search every connected account. Filters combine with AND. Returns message ids for mail_read and mail_update; bodies are not included.',
      parameters: {
        account: { type: 'string', description: 'Account address; omit to search all accounts.' },
        folder: { type: 'string', description: 'Folder path; defaults to INBOX.' },
        from: { type: 'string', description: 'Sender address or name contains this text.' },
        to: { type: 'string', description: 'Recipient address or name contains this text.' },
        subject: { type: 'string', description: 'Subject contains this text.' },
        text: { type: 'string', description: 'Headers or body contain this text (IMAP only).' },
        since: { type: 'string', description: 'ISO date; received on or after.' },
        before: { type: 'string', description: 'ISO date; received before.' },
        unread: { type: 'boolean', description: 'true for unread only, false for read only (IMAP only).' },
        limit: { type: 'integer', description: 'Maximum messages to return.' },
      },
      output: text,
      timeoutMs: timing.timeoutMs,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        return formatSearch(await mail.search(ownerOf(exec), args, exec.signal))
      },
      presentCall: args => ({ card: 'generic', title: `Search email${args.account === undefined ? '' : ` in ${args.account}`}`, kind: 'search', rawInput: args }),
    }),
    defineTool({
      name: 'mail_read',
      description: 'Read one email: headers, plain-text body, and attachment list. Reading does not mark it read. Pass saveAttachments to write attachments into the workspace.',
      parameters: {
        account: { type: 'string', required: true, description: 'Account address.' },
        folder: { type: 'string', description: 'Folder path; defaults to INBOX.' },
        id: { type: 'string', required: true, description: 'Message id from mail_search.' },
        saveAttachments: { type: 'array', items: { type: 'integer' }, description: 'Attachment indexes to save.' },
        saveTo: { type: 'string', description: 'Workspace-relative folder for saved attachments; defaults to mail-attachments.' },
      },
      output: text,
      timeoutMs: timing.timeoutMs,
      // Saving writes workspace files.
      isConcurrencySafe: args => args.saveAttachments === undefined || args.saveAttachments.length === 0,
      async execute(args, exec) {
        const owner = ownerOf(exec)
        const ref = { account: args.account, folder: args.folder ?? 'INBOX', id: args.id }
        const message = await mail.read(owner, ref, exec.signal)
        const saved: { index: number; path: string }[] = []
        for (const index of new Set(args.saveAttachments ?? [])) {
          const attachment = await mail.attachment(owner, ref, index, exec.signal)
          saved.push({ index, path: await saveAttachment(exec, args.saveTo ?? 'mail-attachments', attachment.filename, attachment.content) })
        }
        return formatMessage(message, saved)
      },
      presentCall: args => ({ card: 'generic', title: `Read email ${args.id}`, kind: 'read', rawInput: args }),
    }),
    defineTool({
      name: 'mail_update',
      description: 'Change emails in one folder: mark read or unread, flag or unflag, move to a folder, archive, move to trash, or delete permanently. POP3 accounts support delete only. Permanent delete asks the user first.',
      parameters: {
        account: { type: 'string', required: true, description: 'Account address.' },
        folder: { type: 'string', required: true, description: 'Folder the messages are in.' },
        ids: { type: 'array', required: true, items: { type: 'string' }, description: 'Message ids from mail_search.' },
        action: { type: 'string', required: true, enum: UPDATE_ACTIONS, description: 'The change to apply.' },
        destination: { type: 'string', description: 'Target folder path; required for move.' },
      },
      output: text,
      timeoutMs: timing.timeoutMs,
      async execute(args, exec) {
        const count = await mail.update(ownerOf(exec), {
          account: args.account, folder: args.folder, ids: [...args.ids], action: args.action,
          ...args.destination !== undefined ? { destination: args.destination } : {},
        }, exec.signal)
        return `Applied ${args.action} to ${String(count)} message${count === 1 ? '' : 's'}.`
      },
      presentCall: args => ({ card: 'generic', title: `Email: ${args.action} ${String(args.ids.length)} message${args.ids.length === 1 ? '' : 's'}`, kind: args.action === 'delete' ? 'delete' : 'edit', rawInput: args }),
    }),
    defineTool({
      name: 'mail_send',
      description: 'Send a plain-text email from a connected account, or save it as a draft with draft: true. Sending always asks the user to approve first. To reply, pass replyTo with the original message\'s folder and id; the subject then defaults to "Re: …". The sender must be the account address or one of its aliases.',
      parameters: {
        account: { type: 'string', required: true, description: 'Account address to send from.' },
        from: { type: 'string', description: 'Sender address; defaults to the account address.' },
        to: { type: 'array', required: true, items: { type: 'string' }, description: 'Recipient addresses.' },
        cc: { type: 'array', items: { type: 'string' }, description: 'Cc addresses.' },
        bcc: { type: 'array', items: { type: 'string' }, description: 'Bcc addresses.' },
        subject: { type: 'string', description: 'Subject; optional for a reply.' },
        text: { type: 'string', required: true, description: 'Plain-text body.' },
        replyTo: {
          type: 'object', additionalProperties: false, description: 'The message being answered.',
          properties: { folder: { type: 'string', required: true }, id: { type: 'string', required: true } },
        },
        draft: { type: 'boolean', description: 'Save to Drafts instead of sending (IMAP only).' },
      },
      output: text,
      timeoutMs: timing.sendTimeoutMs,
      async execute(args, exec) {
        return formatSend(await mail.send(ownerOf(exec), {
          account: args.account, to: [...args.to], text: args.text,
          ...args.from !== undefined ? { from: args.from } : {},
          ...args.cc !== undefined ? { cc: [...args.cc] } : {},
          ...args.bcc !== undefined ? { bcc: [...args.bcc] } : {},
          ...args.subject !== undefined ? { subject: args.subject } : {},
          ...args.replyTo !== undefined ? { replyTo: { folder: args.replyTo.folder, id: args.replyTo.id } } : {},
          ...args.draft !== undefined ? { draft: args.draft } : {},
        }, exec.signal))
      },
      presentCall: args => ({ card: 'generic', title: args.draft === true ? `Save email draft: ${args.subject ?? ''}` : `Send email to ${args.to.join(', ')}`, kind: 'execute', rawInput: args }),
    }),
  ]
}
