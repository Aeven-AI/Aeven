/**
 * Store the files a bash command produced as durable attachments. Sharing
 * stores each produced file inside the session workspace, so an image
 * displays and any other file downloads at the call, for deployments whose
 * readers cannot open the Host's folders. Copying stores each produced file
 * that is not an image, wherever it is, so the account's other devices open
 * the copy a synced conversation carries.
 *
 * @module @aeven/tool-bash/share
 */

import { basename, extname } from 'node:path'
import { AttachmentError } from '@aeven/attachment'
import type { AttachmentStore, FileAttachmentRef, ImageAttachmentRef, ImageMediaType } from '@aeven/attachment'
import { FsError } from '@aeven/fs'
import type { FileSystem, FsTarget } from '@aeven/fs'

/** Image formats stored as image attachments, which display inline. */
const IMAGE_TYPES: Readonly<Record<string, ImageMediaType>> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
}

/** Media types of common document and data formats; other files download as octet streams. */
const FILE_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.txt': 'text/plain', '.md': 'text/markdown',
  '.json': 'application/json', '.html': 'text/html', '.svg': 'image/svg+xml', '.zip': 'application/zip',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
}

/** How much one call may still share. */
export interface ShareBudget {
  /** Files it may store. */
  files: number
  /** Bytes it may store; zero or less stores nothing. */
  bytes: number
}

/** The `bytes` a recorded reference carries, or 0. */
const bytesOf = (ref: unknown): number =>
  typeof (ref as { bytes?: unknown } | null)?.bytes === 'number' ? (ref as { bytes: number }).bytes : 0

/**
 * Bytes a conversation has already shared, counted from the shared references and copies its bash results record.
 * @param events - the conversation's log.
 * @returns the summed `bytes` of every recorded shared image and file and every produced file's copy.
 */
export function sharedBytesOf(events: readonly { readonly type: string; readonly data?: unknown }[]): number {
  let total = 0
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (value === null || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'sharedImages' || key === 'sharedFiles') && Array.isArray(child)) {
        for (const ref of child) total += bytesOf(ref)
      } else if (key === 'copy') {
        total += bytesOf(child)
      } else {
        visit(child)
      }
    }
  }
  for (const event of events) if (event.type === 'tool/result') visit(event.data)
  return total
}

/** The files one command shared, and the ones it could not. */
export interface SharedOutputs {
  images: ImageAttachmentRef[]
  files: FileAttachmentRef[]
  /** Produced files that were not shared, with the reason. */
  unshared: { path: string; reason: string }[]
  /** The stored reference of each produced file, in produced order; undefined for one left out. */
  refs: (ImageAttachmentRef | FileAttachmentRef | undefined)[]
}

/** Which produced files a call stores. */
export interface ShareScope {
  /** The canonical workspace root files must stay inside; omitted, a file anywhere is stored. */
  root?: FsTarget | undefined
  /** Whether images are stored as image attachments; otherwise they are stored as files like any other output. */
  images: boolean
}

/**
 * Store each produced file the scope admits as an attachment.
 * @param attachments - the deployment's attachment store.
 * @param fs - the filesystem the command's files are read through.
 * @param scope - the workspace root files must stay inside, and whether images are stored.
 * @param produced - canonical targets of the files the command created or changed.
 * @param signal - the call's cancellation.
 * @param budget - how many files and bytes the call may still share.
 * @returns the stored references in produced order, and the files left out.
 */
export async function shareOutputs(
  attachments: AttachmentStore,
  fs: FileSystem,
  scope: ShareScope,
  produced: readonly FsTarget[],
  signal: AbortSignal,
  budget: ShareBudget,
): Promise<SharedOutputs> {
  const shared: SharedOutputs = { images: [], files: [], unshared: [], refs: [] }
  let files = 0
  let bytes = 0
  for (const target of produced) {
    shared.refs.push(undefined)
    const path = target.displayPath
    if (files >= budget.files) {
      shared.unshared.push({ path, reason: `this call already shared ${String(budget.files)} files` })
      continue
    }
    const info = await fs.stat(target, signal)
    if (info?.size !== undefined && bytes + info.size > budget.bytes) {
      shared.unshared.push({ path, reason: 'sharing it would exceed what this call, conversation, or account may still share today' })
      continue
    }
    // A file reached through a symlink, or named outside the workspace, may be the Host's own.
    if (scope.root !== undefined && !fs.contains(scope.root, target)) {
      shared.unshared.push({ path, reason: 'it is outside the conversation folder' })
      continue
    }
    const extension = extname(path).toLowerCase()
    const name = basename(path)
    const imageType = IMAGE_TYPES[extension]
    try {
      if (imageType !== undefined && scope.images && attachments.imageLimits.mediaTypes.includes(imageType)) {
        const data = await fs.readBytes(target, signal, attachments.imageLimits.maxImageBytes)
        const image = await attachments.saveImage({ data, mediaType: imageType, name })
        shared.images.push(image)
        shared.refs[shared.refs.length - 1] = image
        files += 1
        bytes += data.byteLength
        continue
      }
      const limits = attachments.fileLimits
      if (limits === undefined) {
        shared.unshared.push({ path, reason: 'this deployment stores no files' })
        continue
      }
      const data = await fs.readBytes(target, signal, limits.maxFileBytes)
      const file = await attachments.saveFile({
        data,
        mediaType: imageType ?? FILE_TYPES[extension] ?? 'application/octet-stream',
        name,
        text: { text: `File ${name}, written by a command in the conversation folder.`, method: 'native', extractor: 'tool-bash', truncated: false },
      })
      shared.files.push(file)
      shared.refs[shared.refs.length - 1] = file
      files += 1
      bytes += data.byteLength
    } catch (error) {
      if (signal.aborted) throw error
      // A file over the deployment's limits, or one that changed away, is reported rather than failing the command.
      if (!(error instanceof AttachmentError) && !(error instanceof FsError)) throw error
      shared.unshared.push({ path, reason: error.message })
    }
  }
  return shared
}
