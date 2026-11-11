/**
 * The URL of one workspace file's bytes, as the Session-scoped
 * `/api/workspace-file` route serves them.
 *
 * A Host that serves several accounts from one process does not mount
 * `/api/file`, which reads any path the process can; every file read a browser
 * makes there names the Session whose workspace holds it instead.
 */

/**
 * The URL the browser loads one workspace file from: `api/workspace-file` on
 * this app's origin, carrying the Session that owns the workspace and the path
 * inside it.
 * @param sessionId - the Session owning the workspace.
 * @param path - a workspace-relative path, or an absolute one inside that workspace.
 * @param download - whether the browser saves the file instead of showing it.
 * @returns the absolute URL on this app's origin.
 */
export function workspaceFileUrl(sessionId: string, path: string, download = false): string {
  const url = new URL('api/workspace-file', document.baseURI)
  url.searchParams.set('sessionId', sessionId)
  url.searchParams.set('path', path)
  if (download) url.searchParams.set('download', '1')
  return url.href
}
