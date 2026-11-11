/**
 * Where an assistant-authored image source loads from.
 *
 * Markdown authors name a picture the way they would in a shell: a path in the
 * workspace, or an absolute path. Only `https:` sources and absolute paths had
 * a URL in the conversation renderer, so a workspace-relative picture — the
 * shape a hosted Session can serve at all — showed its alt text and nothing
 * else. This module names the file a local source points at and the URL the
 * Session-scoped route serves it from.
 */
import { workspaceFileUrl } from '@aeven/client-ui-primitives'

/**
 * The source with its percent-escapes applied, as Markdown leaves spaces and
 * non-ASCII encoded.
 * @param source - the image source as the author wrote it.
 * @returns the written source when its escapes are malformed.
 */
export function decodeImageSource(source: string): string {
  try {
    return decodeURI(source)
  } catch {
    // A lone `%` is not an escape; the authored path is already literal.
    return source
  }
}

/**
 * The workspace-relative path a local image source names.
 * @param cwd - the Session's workspace root, when the projection knows it.
 * @param source - the image source as the author wrote it.
 * @returns the path to ask the workspace route for, or undefined for a source
 * that is not a local file inside the workspace.
 */
export function workspaceImagePath(cwd: string | undefined, source: string): string | undefined {
  const path = decodeImageSource(source)
  if (path === '' || path.startsWith('//')) return undefined
  // A scheme names a remote or embedded resource, never a workspace file.
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return undefined
  if (cwd !== undefined) {
    const root = cwd.replace(/\/+$/, '')
    if (path === root) return undefined
    if (path.startsWith(`${root}/`)) {
      const relative = path.slice(root.length + 1)
      return relative === '' ? undefined : relative
    }
  }
  // Absolute paths outside the workspace have no workspace-relative form; the
  // caller's own resolver still offers them to a Host that serves `/api/file`.
  return path.startsWith('/') ? undefined : path
}

/** What a local image source resolves against. */
export interface LocalImageTarget {
  /** The Session whose workspace holds the file. */
  readonly sessionId: string
  /** The Session's workspace root, when the projection knows it. */
  readonly cwd?: string | undefined
  /**
   * The durable copy an earlier read of this path stored, when one exists: the
   * file itself may be gone, or on another device's disk.
   */
  readonly stored?: ((decoded: string) => string | undefined) | undefined
}

/**
 * The URL an authored image loads from: the durable copy an earlier read
 * stored, else the Session's workspace route for the file the source names.
 * @param source - the image source as the author wrote it.
 * @param target - the Session, its workspace root, and any stored copy.
 * @returns the URL to load, or undefined when the source is not a local file
 * this Session can serve.
 */
export function assistantImageUrl(source: string, target: LocalImageTarget): string | undefined {
  const stored = target.stored?.(decodeImageSource(source))
  if (stored !== undefined) return stored
  const path = workspaceImagePath(target.cwd, source)
  return path === undefined ? undefined : workspaceFileUrl(target.sessionId, path)
}
