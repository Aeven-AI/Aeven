/**
 * Browser-safe request, result, and state-stream vocabulary for the Workspace
 * and directory-picking Remote namespaces this package owns. The picking seam
 * declares its own listing types, so they are re-exported here rather than
 * restated: a browser consumer reads the very declaration the backend answers.
 */

import type { SessionId } from '@aeven/session/types'
import type { WorkspaceFileFailure, WorkspaceFileState, WorkspaceId, WorkspaceKind } from '@aeven/workspace/types'

export type { WorkspaceFileFailure, WorkspaceFileState, WorkspaceId } from '@aeven/workspace/types'
export type { DirectoryEntry, DirectoryListing } from '@aeven/host-directory-picker/types'

/** Where a Workspace's files stand on the Host while they are not simply there and up to date. */
export interface WorkspaceFilesView {
  readonly state: WorkspaceFileState
  /** Share of the folder's bytes already on the Host, from 0 to 1, while `syncing` with a known size; otherwise `null`. */
  readonly progress: number | null
  /** Why the files cannot arrive, present exactly in `failed`; otherwise `null`. */
  readonly reason: WorkspaceFileFailure | null
  /** How many files have two versions, present exactly in `conflict`; otherwise `null`. */
  readonly count: number | null
}

/** One durable Workspace projected for browser consumers. */
export interface WorkspaceView {
  readonly workspaceId: WorkspaceId
  /**
   * Whether this is the built-in workspace, which is pinned and cannot be
   * removed, renamed, or moved. A client renders it as a fixed part of the
   * product rather than as a registration the reader owns — in particular it
   * offers no row actions, because there are none to offer.
   */
  readonly isDefault: boolean
  /**
   * Whether this registration is fixed product structure: the default
   * workspace or a plugin-declared built-in one. Every account sees it, and it
   * cannot be removed, renamed, or moved, so a client offers it no row actions
   * and no drag.
   */
  readonly isBuiltIn: boolean
  /**
   * How this Workspace binds to a filesystem location. Browser consumers must
   * narrow on `'folder'` before treating {@link path} as a directory.
   */
  readonly kind: WorkspaceKind
  /**
   * Canonical host directory path, present exactly when {@link kind} is
   * `'folder'`. A `virtual` or `remote` Workspace has no local directory, so a
   * consumer that renders or compares a path must handle its absence.
   *
   * `null`, not an optional/`undefined` property: this interface is a Remote
   * boundary type, and the Typert generator rejects `undefined` as a non-JSON
   * type on that boundary. Absence therefore travels as JSON `null` and is
   * restored to `undefined` on the domain side of the projection.
   */
  readonly path: string | null
  /** User-visible title. */
  readonly title: string
  /** Sessions accounted to this Workspace in manual order. */
  readonly sessionIds: readonly SessionId[]
  /**
   * The Workspace's file status on this Host, or `null` while its files are
   * here and up to date or no file sync carries them. Device-local: another
   * Host of the account reports its own.
   */
  readonly files: WorkspaceFilesView | null
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 last-mutation instant. */
  readonly updatedAt: string
}

declare module '@aeven/typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The requested directory cannot back a Workspace. */
    'workspace/invalid-path': { readonly path: string }
    /** Another Workspace already uses the requested name. */
    'workspace/name-conflict': { readonly name: string }
    /** The Session or its anchor is not in the Workspace's manual order. */
    'workspace/move-invalid': {
      readonly workspaceId: WorkspaceId
      readonly sessionId: SessionId
      readonly beforeSessionId?: SessionId
    }
    /** The verb needs an interaction the composed backend does not serve. */
    'directory-picker/unavailable': { readonly capability: string }
    /** The target is not fully qualified, or the backend cannot list it. */
    'directory-picker/unreadable': { readonly path: string }
    /** A child of that name is already there. */
    'directory-picker/exists': { readonly path: string }
    /** The parent is not fully qualified, the name is not one segment, or creation failed. */
    'directory-picker/create-failed': { readonly path: string }
  }
}

/** Existing directory requested for Workspace adoption. */
export interface WorkspaceCreateRequest {
  readonly path: string
}

/** Created or previously registered Workspace. */
export interface WorkspaceCreateValue {
  readonly workspace: WorkspaceView
  readonly created: boolean
}

/** Workspace title mutation. */
export interface WorkspaceRenameRequest {
  readonly workspaceId: WorkspaceId
  readonly title: string
}

/** Give a Workspace another device of the account registered a directory on this Host. */
export interface WorkspaceBindRequest {
  readonly workspaceId: WorkspaceId
  /** Existing directory on this Host, fully qualified. */
  readonly path: string
}

/** The user's request for a Workspace's files now, such as accepting to install Git. */
export interface WorkspaceGetFilesRequest {
  readonly workspaceId: WorkspaceId
}

/** Receipt after a files request reached the Consumer that syncs the Workspace's files. */
export interface WorkspaceGetFilesValue {
  readonly requested: true
}

/** One Workspace as Settings → Files lists it: where its files live on this Host and how they stand. */
export interface WorkspaceFilesEntry {
  readonly workspaceId: WorkspaceId
  readonly title: string
  /** Its directory on this Host, or `null` while its files have not arrived. */
  readonly path: string | null
  /** Its file status, or `null` while its files are here and up to date. */
  readonly files: WorkspaceFilesView | null
}

/** File sync on this Host for the calling account. */
export interface WorkspaceFilesSettings {
  /** Whether the user paused file sync on this Host. */
  readonly paused: boolean
  /** The patterns no folder syncs, the same on every device of the account. */
  readonly ignores: readonly string[]
  /** The account's Workspaces with their files' place and status here. */
  readonly workspaces: readonly WorkspaceFilesEntry[]
}

/** Pause or resume file sync on this Host. */
export interface WorkspaceFilesPauseRequest {
  readonly paused: boolean
}

/** Replace the patterns no folder syncs. */
export interface WorkspaceFilesIgnoresRequest {
  /** One Syncthing ignore pattern per entry; blank entries are dropped. */
  readonly ignores: readonly string[]
}

/** The Workspace whose conflicting versions to list. */
export interface WorkspaceConflictsRequest {
  readonly workspaceId: WorkspaceId
}

/** One file two devices changed differently, with both versions' text when they are small text files. */
export interface WorkspaceConflictView {
  /** `/`-separated path relative to the Workspace directory. */
  readonly path: string
  /** This Host's text, or `null` when the file is not text or too large to compare. */
  readonly thisText: string | null
  /** The other device's text, or `null` when it is not text or too large to compare. */
  readonly otherText: string | null
}

/** A Workspace's conflicting files. */
export interface WorkspaceConflictsValue {
  readonly conflicts: readonly WorkspaceConflictView[]
}

/** Keep one version of a conflicting file. */
export interface WorkspaceResolveConflictRequest {
  readonly workspaceId: WorkspaceId
  readonly path: string
  /** `this` keeps this Host's version, `other` the other device's. */
  readonly keep: 'this' | 'other'
}

/** Whether the file had a conflict that is now resolved. */
export interface WorkspaceResolveConflictValue {
  readonly resolved: boolean
}

/** Workspace mutation returning the complete changed row. */
export interface WorkspaceValue {
  readonly workspace: WorkspaceView
}

/** Workspace registration deletion. */
export interface WorkspaceDeleteRequest {
  readonly workspaceId: WorkspaceId
}

/** Receipt after one Workspace registration is deleted. */
export interface WorkspaceDeleteValue {
  readonly deleted: true
}

/** DOM-insertBefore-like Workspace order mutation. */
export interface WorkspaceInsertBeforeRequest {
  readonly workspaceId: WorkspaceId
  readonly beforeWorkspaceId?: WorkspaceId
}

/** Complete Workspace registry order after a mutation. */
export interface WorkspaceOrderValue {
  readonly workspaceIds: readonly WorkspaceId[]
}

/** DOM-insertBefore-like Session membership order mutation. */
export interface WorkspaceInsertSessionBeforeRequest {
  readonly workspaceId: WorkspaceId
  readonly sessionId: SessionId
  readonly beforeSessionId?: SessionId
}

/** Session requested for archival from Workspace grouping surfaces. */
export interface WorkspaceArchiveSessionRequest {
  readonly sessionId: SessionId
}

/** Session requested for restoration to Workspace grouping surfaces. */
export interface WorkspaceUnarchiveSessionRequest {
  readonly sessionId: SessionId
}

/** Complete archived Session set after a mutation. */
export interface WorkspaceArchiveValue {
  readonly archivedSessionIds: readonly SessionId[]
}

/** Complete reconnect baseline for Workspace browser state. */
export interface WorkspaceBaseline {
  readonly items: readonly WorkspaceView[]
  readonly archivedSessionIds: readonly SessionId[]
}

/** One ordered Workspace change after a generation's baseline. */
export type WorkspaceFollowIncrement =
  | { readonly type: 'upsert'; readonly workspace: WorkspaceView }
  | { readonly type: 'remove'; readonly workspaceId: WorkspaceId }
  | { readonly type: 'order'; readonly workspaceIds: readonly WorkspaceId[] }
  | { readonly type: 'archived'; readonly archivedSessionIds: readonly SessionId[] }

/** Workspace state stream; every generation starts with exactly one baseline. */
export type WorkspaceFollowFrame =
  | { readonly type: 'baseline'; readonly value: WorkspaceBaseline }
  | WorkspaceFollowIncrement
