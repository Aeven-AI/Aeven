/**
 * Public type vocabulary of the workspace entity: the `WorkspaceId` brand and
 * the `Workspace` consumer interface. Types only — the `WorkspaceId` factory
 * lives in `index.ts` (this file carries no runtime code).
 * @module @aeven/workspace/src/types
 */
import type { Branded } from '@aeven/brand';
import type { SessionId } from '@aeven/session/types';
/**
 * Identifies one workspace record. A generated uuid, never the path: path
 * normalization rewrites paths, and a reference anchor must stay stable.
 */
export type WorkspaceId = Branded<'WorkspaceId'>;
/**
 * How a workspace binds to a filesystem location.
 *
 * - `folder` — backed by an existing local directory; {@link Workspace.path} is
 *   present and is the workspace's whole identity, so sessions join it by
 *   having that exact canonical cwd.
 * - `virtual` — no filesystem binding at all. The built-in Chats workspace is
 *   the first instance. Sessions carry no cwd and join through the record's own
 *   account, which is what lets such a workspace exist where there is no
 *   directory to point at — a hosted deployment, or a record that must sync
 *   between machines whose filesystems are unrelated.
 * - `remote` — content owned by a provider elsewhere. RESERVED: no composition
 *   produces this kind yet, and nothing may assume it is absent forever.
 */
export type WorkspaceKind = 'folder' | 'virtual' | 'remote';
declare module '@aeven/typert-protocol' {
    interface RemoteErrorDetailsMap {
        /** No registration carries that Workspace identity. */
        'workspace/not-found': {
            readonly workspaceId: WorkspaceId;
        };
        /** The built-in workspace refuses the named mutation because it is pinned. */
        'workspace/default-immutable': {
            readonly workspaceId: WorkspaceId;
            readonly operation: 'delete' | 'move' | 'rename';
        };
    }
}
/**
 * One workspace: a stable id over a filesystem binding, a display title, and an
 * ordered candidate account of sessions. Membership requires an id on that
 * account, plus agreement between the session's location and the workspace's:
 * a `folder` workspace also demands a session header whose canonical cwd equals
 * the workspace path, while a workspace with no directory demands a session
 * that records no cwd either. Consumers only see this interface; the
 * implementation stays private.
 */
export interface Workspace {
    /** Stable record id (generated uuid). */
    readonly id: WorkspaceId;
    /**
     * Whether this is the registry's built-in workspace: the one registration the
     * product guarantees a reader has, pinned at the head of the order and
     * refusing delete, rename, and move. Consumers render it as a fixed part of
     * the product rather than as a registration the reader owns, which is why the
     * bit travels outward as a fact instead of being inferred from an id or title.
     */
    readonly isDefault: boolean;
    /**
     * Whether this registration is fixed product structure: the default
     * workspace, or a pathless workspace a plugin declared through
     * `WorkspaceRegistry.builtIn`. A built-in workspace refuses delete, rename,
     * and move, and every account can reach it.
     */
    readonly isBuiltIn: boolean;
    /**
     * How this workspace binds to a filesystem location. Consumers that need a
     * directory must narrow on `'folder'` (see `isFolderWorkspace`) rather than
     * assume {@link path} is present.
     */
    readonly kind: WorkspaceKind;
    /**
     * Canonical directory path: the `fs.realpath` of the path given at create
     * time (trailing slashes, `..`, and symlinks all resolved). Present exactly
     * when {@link kind} is `'folder'`; a `virtual` or `remote` workspace has no
     * local directory and is always `undefined` here. Rewritten only by a
     * relink, which moves the workspace onto a new directory and records the old
     * one in {@link anchorPaths}; a directory that merely disappears stays named
     * here (see {@link status}).
     */
    readonly path: string | undefined;
    /**
     * Directories this workspace occupied earlier on this device, most recent
     * first. Device-local: they never enter the account document. A session whose
     * record names one still belongs here, so a relink keeps its sessions.
     */
    readonly anchorPaths: readonly string[];
    /** Display title. Defaults to the final path segment, or a filesystem root's own spelling; duplicates are allowed. */
    readonly title: string;
    /**
     * Account id of the signed-in user who created this workspace, absent when
     * nobody was signed in. A record written before workspaces carried an owner
     * answers with the one account all its sessions belong to, and with none when
     * they belong to several. One Host serves several accounts, and a workspace is
     * reachable only by its owner; the built-in workspace is the product's own
     * and is reachable by every account.
     */
    readonly owner: string | undefined;
    /** ISO-8601 creation instant, stamped at create and never rewritten. */
    readonly createdAt: string;
    /** ISO-8601 instant of the last durable mutation (create counts as one). */
    readonly updatedAt: string;
    /**
     * Header-validated sessions in manually owned order: a new session is
     * prepended at attach, explicit reordering goes through
     * `insertSessionBefore`, and activity never reorders. The durable candidate
     * account is filtered synchronously for a folder workspace — missing
     * headers, invalid cwd values, and canonical cwd mismatches are never
     * returned — while a workspace with no directory binding has no such fact to
     * check and returns its account verbatim. A subsequent workspace mutation
     * prunes those filtered candidates durably.
     */
    readonly sessionIds: readonly SessionId[];
    /**
     * Replace the display title durably.
     * @param title - New title; any string, duplicates across workspaces allowed.
     * @returns resolution after durability.
     */
    setTitle(title: string): Promise<void>;
    /**
     * Prepend a session to this workspace's candidate account. An already
     * accounted id resolves without writing, aside from the durable
     * filtered-candidate prune every accepted mutation performs. Otherwise the
     * candidate must agree with the workspace's own location: for a folder
     * workspace its live or persisted header cwd must resolve to an existing
     * directory equal to {@link path}, and for a workspace with no directory it
     * must record no cwd at all — a machine-local path inside a record expected
     * to travel between machines is refused rather than tolerated. Unknown ids,
     * missing or invalid cwd values, and mismatches reject without writing.
     * @param sessionId - The session to record.
     * @returns resolution after durability.
     */
    attachSession(sessionId: SessionId): Promise<void>;
    /**
     * Move an accounted session within the manual order, DOM-insertBefore-like:
     * with an anchor the session lands before it, without one it appends to the
     * end. Only the moved id changes position. A session or anchor absent from
     * the account rejects without writing; a move to the current position
     * resolves without writing, aside from the durable filtered-candidate
     * prune every accepted mutation performs; decided on the domain write
     * chain.
     * @param sessionId - The accounted session to move.
     * @param beforeSessionId - Accounted anchor to insert before; omitted appends.
     * @returns resolution after durability.
     */
    insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void>;
    /**
     * Remove a session from this workspace's account. Idempotent: an id not on
     * the account resolves without writing, aside from the durable
     * filtered-candidate prune every accepted mutation performs; decided on
     * the domain write chain like attach. Never touches the session's own stored log.
     * @param sessionId - The session to remove.
     * @returns resolution after durability.
     */
    detachSession(sessionId: SessionId): Promise<void>;
    /**
     * Live directory check, uncached: whether {@link path} currently exists and
     * is a directory. A missing directory never mutates the record — the
     * directory may only be temporarily moved. A workspace with no directory
     * binding is always `'ok'`: it makes no filesystem claim to check.
     * @returns `'ok'` when the directory exists, `'missing-dir'` otherwise.
     */
    status(): Promise<'ok' | 'missing-dir'>;
}
/**
 * A {@link Workspace} known to be folder-backed, so {@link Workspace.path} is
 * a present string. Produced only by the `isFolderWorkspace` guard — the
 * narrowing is what lets a consumer that genuinely needs a directory treat the
 * path as authoritative instead of re-checking it.
 */
export type FolderWorkspace = Workspace & {
    readonly kind: 'folder';
    readonly path: string;
};
/**
 * Where one Session sits in this device's registry: which workspace owns it
 * here, whether that workspace has arrived yet, or that no workspace names it.
 *
 * A Session's own header records the directory of the device that created it,
 * so a consumer that needs a directory here asks this question first: `filed`
 * hands it the local workspace (which may still carry no directory), while
 * `pending` and `unfiled` say the workspace identity is known but nothing local
 * can act in a directory yet.
 */
export type SessionPlacement = 
/** A workspace on this device accounts the Session. */
{
    readonly state: 'filed';
    readonly workspace: Workspace;
}
/** The Session names a shared workspace that has not reached this device. */
 | {
    readonly state: 'pending';
    readonly home: string;
}
/** No workspace accounts the Session here. */
 | {
    readonly state: 'unfiled';
};
//# sourceMappingURL=types.d.ts.map