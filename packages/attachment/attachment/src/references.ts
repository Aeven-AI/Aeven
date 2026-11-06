/**
 * The attachment files a conversation references through its own content: the
 * image and file blocks of user messages and tool results. Model-written tool
 * arguments are not content blocks of those events, so a model cannot add a
 * reference by naming another conversation's content address.
 *
 * @module @aeven/attachment/references
 */

import { existsSync } from 'node:fs'
import type { AttachmentStore } from './index.ts'
import type { FileAttachmentRef, ImageAttachmentRef } from './types.ts'

/** The session event types whose content blocks reference attachments the conversation holds. */
export const REFERENCING_EVENT_TYPES: ReadonlySet<string> = new Set(['user/message', 'tool/result'])

/**
 * Add the host path of every image and file content block in a value.
 * @param value - an event payload.
 * @param store - the attachment store that maps references to host paths.
 * @param files - the set the existing paths are added to.
 */
export function collectAttachmentPaths(value: unknown, store: AttachmentStore, files: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectAttachmentPaths(item, store, files)
    return
  }
  if (value === null || typeof value !== 'object') return
  const block = value as { type?: unknown; attachment?: unknown }
  if ((block.type === 'image' || block.type === 'file') && block.attachment !== null && typeof block.attachment === 'object') {
    let path: string | undefined
    try {
      path = block.type === 'image'
        ? store.imageHostPath(block.attachment as ImageAttachmentRef)
        : store.fileHostPath(block.attachment as FileAttachmentRef)
    } catch {
      // AttachmentError: a malformed reference names no stored object.
      path = undefined
    }
    if (path !== undefined && existsSync(path)) files.add(path)
    return
  }
  for (const child of Object.values(value)) collectAttachmentPaths(child, store, files)
}

/**
 * The host paths of the attachments a conversation's log references.
 * @param events - the conversation's events, or the slice not read yet.
 * @param store - the attachment store.
 * @param files - the set to add to; a new one when omitted.
 * @returns the set of existing host paths.
 */
export function referencedAttachmentPaths(
  events: readonly { readonly type: string; readonly data?: unknown }[],
  store: AttachmentStore,
  files: Set<string> = new Set(),
): Set<string> {
  for (const event of events) if (REFERENCING_EVENT_TYPES.has(event.type)) collectAttachmentPaths(event.data, store, files)
  return files
}
