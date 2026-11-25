/**
 * Which Files pill a file request lands in.
 * @module
 */

import { resolveWorkspacePath } from '@aeven/util-workspace-path'

/** One mounted Files pill as the opener tracks it. */
export interface FilesPill {
  readonly sessionId: string
  readonly surfaceId: string
  /** The file it shows, or null while it shows only the tree. */
  readonly path: string | null
  /** The session workspace root its paths resolve against. */
  readonly root: string | null
}

/**
 * The pill a session's file request reuses: the one already showing the file, else the first that shows only the
 * tree and can open a file in place, such as one a reload returned to the root.
 * @param pills - the mounted Files pills, by pane key.
 * @param sessionId - the requesting session.
 * @param path - the requested file, workspace-relative or absolute.
 * @param canOpen - whether the pill with this pane key opens files in place.
 * @returns the pill's key and surface and whether it already shows the file, or undefined when a new pill is needed.
 */
export function openTarget(
  pills: Iterable<readonly [key: string, pill: FilesPill]>,
  sessionId: string,
  path: string,
  canOpen: (key: string) => boolean,
): { readonly key: string; readonly surfaceId: string; readonly showing: boolean } | undefined {
  let idle: { readonly key: string; readonly surfaceId: string; readonly showing: boolean } | undefined
  for (const [key, pill] of pills) {
    if (pill.sessionId !== sessionId) continue
    if (pill.path === null) {
      if (idle === undefined && canOpen(key)) idle = { key, surfaceId: pill.surfaceId, showing: false }
      continue
    }
    const root = pill.root ?? undefined
    if (resolveWorkspacePath(root, pill.path) === resolveWorkspacePath(root, path)) return { key, surfaceId: pill.surfaceId, showing: true }
  }
  return idle
}
