/**
 * Share the files a bash command produced with the person reading the
 * conversation: each produced file inside the session workspace is stored as
 * a durable attachment, so an image displays and any other file downloads at
 * the call. Used by deployments whose readers cannot open the Host's folders.
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
}

/** The files one command shared, and the ones it could not. */
export interface SharedOutputs {
  images: ImageAttachmentRef[]
  files: FileAttachmentRef[]
  /** Produced files that were not shared, with the reason. */
  unshared: { path: string; reason: string }[]
}

/**
 * Store each produced file inside the workspace as an attachment.
 * @param attachments - the deployment's attachment store.
 * @param fs - the filesystem the command's files are read through.
 * @param root - the canonical workspace root; files outside it are never shared.
 * @param produced - canonical targets of the files the command created or changed.
 * @param signal - the call's cancellation.
 * @returns the stored references in produced order, and the files left out.
 */
export async function shareOutputs(
  attachments: AttachmentStore,
  fs: FileSystem,
  root: FsTarget,
  produced: readonly FsTarget[],
  signal: AbortSignal,
): Promise<SharedOutputs> {
  const shared: SharedOutputs = { images: [], files: [], unshared: [] }
  for (const target of produced) {
    const path = target.displayPath
    // A file reached through a symlink, or named outside the workspace, may be the Host's own.
    if (!fs.contains(root, target)) {
      shared.unshared.push({ path, reason: 'it is outside the conversation folder' })
      continue
    }
    const extension = extname(path).toLowerCase()
    const name = basename(path)
    const imageType = IMAGE_TYPES[extension]
    try {
      if (imageType !== undefined && attachments.imageLimits.mediaTypes.includes(imageType)) {
        const data = await fs.readBytes(target, signal, attachments.imageLimits.maxImageBytes)
        shared.images.push(await attachments.saveImage({ data, mediaType: imageType, name }))
        continue
      }
      const limits = attachments.fileLimits
      if (limits === undefined) {
        shared.unshared.push({ path, reason: 'this deployment stores no files' })
        continue
      }
      const data = await fs.readBytes(target, signal, limits.maxFileBytes)
      shared.files.push(await attachments.saveFile({
        data,
        mediaType: FILE_TYPES[extension] ?? 'application/octet-stream',
        name,
        text: { text: `File ${name}, written by a command in the conversation folder.`, method: 'native', extractor: 'tool-bash', truncated: false },
      }))
    } catch (error) {
      if (signal.aborted) throw error
      // A file over the deployment's limits, or one that changed away, is reported rather than failing the command.
      if (!(error instanceof AttachmentError) && !(error instanceof FsError)) throw error
      shared.unshared.push({ path, reason: error.message })
    }
  }
  return shared
}
