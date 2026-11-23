/**
 * Stored copies a tool result names only in its produced files: the copy's id beside the path of the file it copies,
 * with no file or image block. The file route serves such a copy under the produced file's name and media type.
 * @module @aeven/api-session-controller/produced-copies
 */
import type { SessionEvent } from '@aeven/session'

/** Media types of the files commands commonly produce, by extension; others are served as bytes. */
const PRODUCED_MEDIA_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', txt: 'text/plain',
  csv: 'text/csv', json: 'application/json', html: 'text/html',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

/**
 * The name of the produced file a tool result of the log names a stored copy for.
 * @param events - the Session log.
 * @param attachmentId - the copy's id.
 * @returns the produced file's base name from the latest result that names the copy, or undefined when none does.
 */
export function producedCopyName(events: readonly SessionEvent[], attachmentId: string): string | undefined {
  let path: string | undefined
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const produced = (event.data.meta as { producedFiles?: unknown } | undefined)?.producedFiles
    if (!Array.isArray(produced)) continue
    for (const file of produced as unknown[]) {
      const entry = file as { path?: unknown; attachmentId?: unknown } | null
      if (entry?.attachmentId === attachmentId && typeof entry.path === 'string') path = entry.path
    }
  }
  return path === undefined ? undefined : path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

/**
 * The media type a produced file's name declares.
 * @param name - the file's base name.
 * @returns the type its extension names, or `application/octet-stream` for one this list does not know.
 */
export function producedMediaType(name: string): string {
  const dot = name.lastIndexOf('.')
  return (dot < 0 ? undefined : PRODUCED_MEDIA_TYPES[name.slice(dot + 1).toLowerCase()]) ?? 'application/octet-stream'
}
