/**
 * Durable copies of the local images an assistant reply shows.
 *
 * A reply that names a local file as a Markdown image (`![alt](/path/shot.png)`)
 * points at this device's disk, which the account's other devices and Aeven Web
 * cannot reach once this device is offline, and which a later Turn may
 * overwrite. When a Turn is about to close, every such image of the Turn's
 * replies is saved to the attachment store as `read_image` saves one, and one
 * `reply-images/stored` event names each copy by the source the reply wrote.
 * Session sync carries every attachment an event references, so the copy
 * reaches every device of the account, and the transcript shows it in place of
 * the file. A source that names no readable image here is skipped; the reply
 * then shows it as written.
 * @module @aeven/tool-fs/src/reply-images
 */

import { basename, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentError } from '@aeven/attachment'
import type { ImageAttachmentRef } from '@aeven/attachment'
import type {} from '@aeven/agent'
import type { Session, SessionEvent, SessionSeq } from '@aeven/session'
import { sessionDirectory, WorkingDirectoryUnavailableError } from '@aeven/working-directory'
import { imageMediaTypeForPath, sniffImageMediaType } from './read-image.ts'
import type { ReplyImage } from './types.ts'

/** A Markdown image: alt text, then a source optionally in angle brackets and an optional title. */
const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*<([^>\n]+)>(?:\s+"[^"]*")?\s*\)|!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g

/** A source with a scheme other than `file:` names a remote or embedded resource. */
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/**
 * The local file path an image source names.
 * @param source - the image source as the reply wrote it.
 * @returns the path, or undefined for a remote, embedded, or malformed source.
 */
function localPath(source: string): string | undefined {
  if (source.startsWith('//')) return undefined
  if (source.startsWith('file:')) {
    try {
      return fileURLToPath(source)
    } catch {
      // A malformed file URL names no file.
      return undefined
    }
  }
  if (URL_SCHEME.test(source)) return undefined
  try {
    return decodeURI(source)
  } catch {
    // A lone `%` is not an escape; the written source is already literal.
    return source
  }
}

/**
 * The image sources each reply of `turn` writes that no earlier
 * `reply-images/stored` event of the Turn covers.
 * @param events - the session log.
 * @param turn - the closing Turn.
 * @returns each reply's seq with the local sources it shows.
 */
function pendingSources(events: readonly SessionEvent[], turn: number): { messageSeq: SessionSeq; source: string; path: string }[] {
  const covered = new Set<number>()
  const pending: { messageSeq: SessionSeq; source: string; path: string }[] = []
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type === 'turn/start' && event.data.turn === turn) break
    if (event.type === 'reply-images/stored' && event.data.turn === turn) {
      for (const image of event.data.images) covered.add(image.messageSeq)
      continue
    }
    if (event.type !== 'assistant/message' || event.data.turn !== turn || covered.has(event.seq)) continue
    const text = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    const seen = new Set<string>()
    for (const match of text.matchAll(MARKDOWN_IMAGE)) {
      const source = (match[1] ?? match[2] ?? '').trim()
      const path = localPath(source)
      if (path === undefined || path === '' || seen.has(source)) continue
      seen.add(source)
      pending.push({ messageSeq: event.seq, source, path })
    }
  }
  return pending.reverse()
}

/**
 * Save the local images the closing Turn's replies show and record them.
 * @param ctx - context carrying `fs` and `attachments`.
 * @param session - the session whose Turn is closing.
 * @param turn - the closing Turn.
 * @param signal - the Turn's abort signal.
 * @param confine - store only images inside the session's workspace.
 */
async function storeReplyImages(ctx: Context, session: Session, turn: number, signal: AbortSignal, confine: boolean): Promise<void> {
  const pending = pendingSources(session.snapshotEvents(), turn)
  if (pending.length === 0) return
  const attachments = ctx.get('attachments')
  if (attachments === undefined) return
  let cwd: string | undefined
  try {
    cwd = sessionDirectory(ctx, session)
  } catch (error: unknown) {
    // A workspace with no folder on this device holds none of the files.
    if (error instanceof WorkingDirectoryUnavailableError) return
    throw error
  }
  // Without a directory only absolute sources name a file, and a confined Host has no workspace to read from.
  if (cwd === undefined && (confine || pending.every(image => !isAbsolute(image.path)))) return
  const root = confine && cwd !== undefined ? await ctx.fs.resolve(cwd, { signal }) : undefined
  const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
  const stored: ReplyImage[] = []
  const saved = new Map<string, ImageAttachmentRef>()
  for (const image of pending) {
    try {
      const target = await ctx.fs.resolve(image.path, { ...cwd === undefined ? {} : { cwd }, signal })
      const key = String(target.targetKey)
      let attachment = saved.get(key)
      if (attachment === undefined) {
        if (root !== undefined && !ctx.fs.contains(root, target)) continue
        const info = await ctx.fs.stat(target, signal)
        if (info?.type !== 'file' || (info.size !== undefined && info.size > byteCap)) continue
        const data = await ctx.fs.readBytes(target, signal, byteCap)
        const mediaType = imageMediaTypeForPath(target.displayPath) ?? sniffImageMediaType(data)
        if (mediaType === undefined || !attachments.imageLimits.mediaTypes.includes(mediaType)) continue
        attachment = await attachments.saveImage({ data, mediaType, name: basename(target.displayPath) })
        saved.set(key, attachment)
      }
      stored.push({ messageSeq: image.messageSeq, source: image.source, attachment })
    } catch (error: unknown) {
      signal.throwIfAborted()
      // An absent, unreadable, or refused image keeps its written source.
      const code = error instanceof AttachmentError ? error.code : (error as { code?: unknown } | null)?.code
      if (typeof code !== 'string' || !(error instanceof AttachmentError || code.startsWith('FS_'))) throw error
      ctx.logger.debug(`session "${session.id}": reply image "${image.source}" not stored: ${code}`)
    }
  }
  signal.throwIfAborted()
  if (stored.length > 0) session.append('reply-images/stored', { turn, images: stored })
}

/**
 * Store the local images each Turn's replies show before the Turn closes.
 * @param ctx - context carrying `fs` and `attachments`; the listener lives as long as it.
 * @param confine - store only images inside the session's workspace.
 */
export function applyReplyImages(ctx: Context, confine: boolean): void {
  ctx.on('agent/turn-stopping', async ({ agent, turn, signal }) => {
    await storeReplyImages(ctx, agent.session, turn, signal, confine)
  })
}
