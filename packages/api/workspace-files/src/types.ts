/** Client-safe Remote wire types of the workspace file service. @module @aeven/api-workspace-files/types */

import type { Agent } from '@aeven/agent/types'
import type { Scoped } from '@aeven/scope'
import type {} from '@aeven/typert-protocol'

/** One direct child of a listed directory. */
export interface WorkspaceDirectoryEntry {
  /** Basename inside the listed directory. */
  readonly name: string
  /** Regular file, directory, or anything else (sockets, devices). */
  readonly type: 'file' | 'directory' | 'other'
  /** Byte size of a regular file, or null when the backend cannot report it. */
  readonly size: number | null
}

/** One directory's direct children. */
export interface WorkspaceDirectoryListing {
  /** Absolute path of the Session's workspace root. */
  readonly root: string
  /** The listed directory, relative to the root with `/` separators; empty for the root. */
  readonly path: string
  /** The children in the backend's order, cut at the entry cap. */
  readonly entries: readonly WorkspaceDirectoryEntry[]
  /** Whether the directory had more children than the cap let through. */
  readonly truncated: boolean
}

/** The leading page of one text file. */
export interface WorkspaceFileText {
  /** Absolute path of the file. */
  readonly absolutePath: string
  /** Byte size at the stat before the read, or null when unknown. */
  readonly bytes: number | null
  /** The file's first lines, `\n`-joined. */
  readonly text: string
  /** Whether `text` reaches the last line; false when the page cap cut it. */
  readonly eof: boolean
}

/** One path a name search found. */
export interface WorkspaceSearchHit {
  /** Path relative to the workspace root, `/`-joined. */
  readonly path: string
  /** Whether the hit is a directory or a file. */
  readonly type: 'file' | 'directory'
}

/** A bounded name search over the workspace tree. */
export interface WorkspaceSearchResult {
  /** Matches in walk order, cut at the hit cap. */
  readonly hits: readonly WorkspaceSearchHit[]
  /** Whether the walk stopped at a cap before covering the whole tree. */
  readonly truncated: boolean
}

declare module '@aeven/typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No entry exists at that path. */
    'workspace-file/not-found': { readonly path: string }
    /** The listing path resolves outside the Session's workspace root. */
    'workspace-file/outside-workspace': { readonly path: string }
    /** The preview page exceeds the configured byte cap; nothing is returned. */
    'workspace-file/too-large': { readonly path: string; readonly limit: number }
    /** The content is not decodable UTF-8 text, or the page carries NUL bytes. */
    'workspace-file/not-text': { readonly path: string }
    /** The path is not a regular file, so it has no text to preview. */
    'workspace-file/not-regular-file': { readonly path: string; readonly kind: 'directory' | 'other' }
    /** The path is not a directory, so it has no children to list. */
    'workspace-file/not-directory': { readonly path: string; readonly kind: 'file' | 'other' }
  }
}

/** Client-safe payload of the request to show a workspace path in the Files sidebar beside its Session. */
export interface WorkspaceFilesShowRequestEvent {
  /** A file path as the model gave it, or a folder path relative to the workspace root (empty for the root). */
  readonly path: string
  /** Whether the path is a file, which opens in a preview tab, or a folder, which the explorer expands to. */
  readonly type: 'file' | 'directory'
  /** Agent identity projected to the corresponding Client Context in transit. */
  agent?: Agent
  /** Cancellation lifetime of the pending request. */
  signal?: AbortSignal
}

/** How a show request ended: shown, refused because the file has no preview, or answered by no window. */
export type WorkspaceFilesShowResult = 'shown' | 'not-previewable' | 'no-window'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Show one workspace path in the Files sidebar beside its session. The
     * client displaying that session opens the explorer and answers; a
     * listener without that session calls `next()` to delegate.
     * Scope-filtered dispatch (`@aeven/scope`): agent-scoped listeners receive
     * only that agent.
     * @param request - the path to show.
     * @mode waterfall
     */
    'workspace-files/show'(
      this: Scoped<Agent>,
      request: WorkspaceFilesShowRequestEvent,
      next: () => Promise<WorkspaceFilesShowResult>,
    ): Promise<WorkspaceFilesShowResult>
  }
}
