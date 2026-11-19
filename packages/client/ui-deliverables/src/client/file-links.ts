/**
 * Where a produced file opens, and which file a prose link names.
 *
 * The produced-files row and the links an assistant writes in its prose open
 * a file the same way: the Files sidebar previews it, the Host opens the path
 * where it is the reader's own desktop, and otherwise the reader's browser
 * downloads it, from its stored copy when one was recorded. A conversation may
 * run on another device of the account, whose folders this Host cannot read.
 */
import type { MarkdownFileLinks } from '@aeven/client-ui-primitives'

/**
 * A stored copy named by its place in the Host's content-addressed store:
 * `attachments/<xx>/<sha256>`, optionally under `v1/objects/`, where `<xx>` is
 * the digest's first two characters.
 */
const ATTACHMENT_LINK = /(?:^|\/)attachments\/(?:v1\/objects\/)?([0-9a-f]{2})\/([0-9a-f]{64})$/

/** The file a prose link names. */
export type FileLinkTarget =
  | { readonly kind: 'attachment'; readonly attachmentId: string }
  | { readonly kind: 'path'; readonly path: string }

/**
 * The file a scheme-less link destination names: a stored copy when it spells
 * a place in the attachment store, otherwise a workspace path.
 * @param href - The destination as authored, still percent-encoded.
 * @param cwd - The Session workspace root, when known.
 * @returns The stored copy's attachment id, or the path relative to `cwd` when
 * it lies inside it and as written otherwise; undefined when nothing remains.
 */
export function fileLinkTarget(href: string, cwd: string | undefined): FileLinkTarget | undefined {
  const decoded = safeDecode(href)
  const stored = ATTACHMENT_LINK.exec(decoded)
  if (stored !== null && stored[2]?.startsWith(stored[1] ?? '') === true) {
    return { kind: 'attachment', attachmentId: `sha256:${stored[2]}` }
  }
  let path = decoded.replace(/^(?:\.\/)+/, '')
  if (cwd !== undefined) {
    const root = cwd.replace(/[\\/]+$/, '')
    if (path === root) return undefined
    if (path.startsWith(`${root}/`)) path = path.slice(root.length + 1)
  }
  return path === '' ? undefined : { kind: 'path', path }
}

/** Markdown percent-encodes spaces and non-ASCII in a destination; the file routes want the path. */
function safeDecode(value: string): string {
  try {
    return decodeURI(value)
  } catch {
    // A lone `%` that is not an escape: the authored destination is already literal.
    return value
  }
}

/** What opening a produced file needs from the client. */
export interface FileOpening {
  /**
   * Show a file in the Session's Files sidebar.
   * @param path - the file's workspace path.
   * @param copy - URL of its stored copy, which a media file plays from.
   * @returns whether the sidebar can show the file.
   */
  previewFile(path: string, copy?: string): Promise<boolean>
  /**
   * The URL of a workspace file's bytes.
   * @param path - the file's workspace path.
   * @param download - whether the browser saves the file instead of showing it.
   */
  fileUrl(path: string, download?: boolean): string
  /**
   * The URL of a stored copy the Session log cites.
   * @param attachmentId - the copy's attachment id.
   * @param download - whether the browser saves the file instead of showing it.
   */
  attachmentUrl(attachmentId: string, download?: boolean): string
  /** Whether the Host opens paths on the reader's own desktop. */
  canOpenPath(): boolean
  /**
   * Open a workspace path on the Host's desktop.
   * @param path - the path as written.
   */
  openFile(path: string): void
}

/**
 * Open one produced file: preview it in the sidebar, else open the path on the
 * reader's desktop, else download it.
 * @param file - the file's path and, when the tool result recorded one, its stored copy.
 * @param opening - the client's preview, opener, and file routes.
 */
export function openProducedFile(file: { path: string; attachmentId?: string | undefined }, opening: FileOpening): void {
  const copy = file.attachmentId === undefined ? undefined : opening.attachmentUrl(file.attachmentId)
  const preview = copy === undefined ? opening.previewFile(file.path) : opening.previewFile(file.path, copy)
  void preview.then((previewed) => {
    if (previewed) return
    if (opening.canOpenPath()) {
      opening.openFile(file.path)
      return
    }
    downloadUrl(file.attachmentId === undefined ? opening.fileUrl(file.path, true) : opening.attachmentUrl(file.attachmentId, true))
  })
}

/**
 * Have the browser save the file a URL serves.
 * @param href - a URL on this app's origin that answers with a download.
 */
export function downloadUrl(href: string): void {
  const link = document.createElement('a')
  link.href = href
  link.rel = 'noopener'
  link.click()
}

/**
 * Link resolver for an assistant's prose: a stored-copy link downloads that
 * copy, which names no path the sidebar could show, and a path link opens the
 * way a produced file does.
 * @param cwd - The Session workspace root, when known.
 * @param opening - the client's preview, opener, and file routes.
 * @returns The resolver MarkdownText consumes.
 */
export function producedFileLinks(cwd: string | undefined, opening: FileOpening): MarkdownFileLinks {
  return {
    resolve(href) {
      const target = fileLinkTarget(href, cwd)
      if (target === undefined) return undefined
      if (target.kind === 'attachment') {
        return {
          href: opening.attachmentUrl(target.attachmentId),
          open: () => { downloadUrl(opening.attachmentUrl(target.attachmentId, true)) },
        }
      }
      return {
        href: opening.fileUrl(target.path),
        title: target.path,
        open: () => { openProducedFile({ path: target.path }, opening) },
      }
    },
  }
}
