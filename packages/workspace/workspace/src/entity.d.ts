/**
 * Package-private workspace entity: the single {@link Workspace}
 * implementation. Holds a record snapshot that is swapped in place after each
 * durable mutation; every write funnels through the private `mutate` so
 * `updatedAt` stamping and invalid-account pruning happen exactly once.
 * Not re-exported from the package entrypoint — consumers see only the
 * `Workspace` interface.
 * @module @aeven/workspace/src/entity
 */
import type { SessionHeader, SessionId } from '@aeven/session';
import type { KvTable } from '@aeven/storage-domain';
import type { WorkspaceRecord } from './spec.ts';
import type { Workspace, WorkspaceId, WorkspaceKind } from './types.ts';
/** An insertSessionBefore request named a session or anchor not on the account (storage failures stay plain errors). */
export declare class WorkspaceMoveInvalidError extends Error {
    /**
     * @param message - Which id was unaccounted and where.
     */
    constructor(message: string);
}
/**
 * A mutation targeted a built-in workspace, which the product pins: the default
 * workspace and every plugin-declared built-in registration can be neither
 * removed, renamed, nor reordered. Defined here rather than beside the registry
 * so the entity can raise it without importing its own owner.
 */
export declare class WorkspaceDefaultImmutableError extends Error {
    readonly workspaceId: WorkspaceId;
    readonly operation: 'delete' | 'move' | 'rename';
    /**
     * @param workspaceId - The built-in workspace's id.
     * @param operation - The refused operation.
     */
    constructor(workspaceId: WorkspaceId, operation: 'delete' | 'move' | 'rename');
}
/**
 * The registry-owned machinery an entity mutates through. Entities never see
 * the registry itself — only the open table, the canonical session-path
 * index backing the `sessionIds` projection, and attach-time header reads.
 */
export interface WorkspaceEntityHost {
    /**
     * Resolve the open `workspaces` table.
     * @returns the table; throws while the registry has not started yet.
     */
    table(): KvTable<WorkspaceId, WorkspaceRecord>;
    /**
     * Read a session's canonical directory from the registry's header index.
     * @param id - Session whose indexed path is requested.
     * @returns the canonical directory, or `undefined` when the header is
     * missing or its cwd cannot identify an existing directory.
     */
    sessionPath(id: SessionId): string | undefined;
    /**
     * Read a session's owner from the registry's header index.
     * @param id - Session whose indexed owner is requested.
     * @returns the account id, or `undefined` when the header is missing or records none.
     */
    sessionOwner(id: SessionId): string | undefined;
    /**
     * Read one stored session header for attach validation.
     * @param id - The session whose header to read.
     * @returns the header; rejects when session persistence is absent or holds
     * no session with this id.
     */
    readSessionHeader(id: SessionId): Promise<SessionHeader>;
    /**
     * Whether a session is a replica of another device's log. Its recorded cwd names that device's folder, so the
     * record alone decides its membership here.
     * @param id - Session to check.
     * @returns whether the indexed header marks the session as replicated.
     */
    replicated(id: SessionId): boolean;
    /** Tell the registry a reader renamed a workspace, so the account's other devices receive the title. */
    titleChanged(): void;
    /**
     * Publish a successfully validated canonical cwd to the projection index.
     * @param id - Validated session id.
     * @param path - Canonical existing directory from the immutable header cwd.
     */
    rememberSessionPath(id: SessionId, path: string): void;
    /**
     * Whether this id names the registry's built-in workspace. The bit lives in
     * the domain global rather than the record, so the entity asks for it instead
     * of carrying a copy that a cross-process write could leave stale.
     * @param id - workspace whose built-in status is requested.
     * @returns whether the registry publishes that id as its built-in workspace.
     */
    isDefault(id: WorkspaceId): boolean;
    /**
     * Whether this id names the default workspace or a plugin-declared built-in one.
     * @param id - workspace whose built-in status is requested.
     * @returns whether the registry publishes that id as built-in.
     */
    isBuiltIn(id: WorkspaceId): boolean;
}
/** The single {@link Workspace} implementation; constructed only by the registry. */
export declare class WorkspaceEntity implements Workspace {
    private readonly host;
    readonly id: WorkspaceId;
    private record;
    /**
     * @param host - Registry-owned table, session-path index, and header reads.
     * @param id - The record's stable id.
     * @param record - The validated record snapshot loaded or just written.
     */
    constructor(host: WorkspaceEntityHost, id: WorkspaceId, record: WorkspaceRecord);
    get kind(): WorkspaceKind;
    /**
     * Whether this is the registry's built-in workspace. Asked of the host on
     * every read rather than cached in the record, because the bit lives in the
     * domain global and another process sharing this storage root may have set or
     * cleared it since this snapshot was taken.
     */
    get isDefault(): boolean;
    get isBuiltIn(): boolean;
    get path(): string | undefined;
    get title(): string;
    /**
     * A record written before workspaces carried an owner takes the owner of its
     * sessions when they all belong to one account; otherwise it has none.
     */
    get owner(): string | undefined;
    get createdAt(): string;
    get updatedAt(): string;
    get anchorPaths(): readonly string[];
    get sessionIds(): readonly SessionId[];
    /**
     * Whether one accounted session currently belongs to this workspace.
     *
     * A folder workspace decides membership by canonical cwd equality: the
     * directory IS the workspace, so a session whose header cwd stopped
     * resolving to it is filtered out. A workspace with no directory binding has
     * no such fact to check, so its own account is the whole answer — which is
     * why membership for a pathless workspace survives a restart even though
     * nothing in the session header names it.
     * @param id - session in this workspace's durable account.
     * @returns whether the session is a current member.
     */
    private member;
    /**
     * A human-identifiable label for error text: the directory canon when the
     * workspace has one, otherwise the stable id, which is the only fact a
     * pathless workspace can be named by.
     */
    private get label();
    setTitle(title: string): Promise<void>;
    /**
     * Adopt the title its declaring plugin now declares. A built-in title is
     * product copy, so the plugin that owns the registration — never a reader —
     * is what renames it.
     * @param title - the title the declaring plugin currently declares.
     */
    adoptDeclaredTitle(title: string): Promise<void>;
    /**
     * Give a workspace another device registered a directory on this device. The directory stays on this device:
     * account sync carries the workspace's title and order, never its path.
     * @param path - canonical existing directory.
     */
    bindDirectory(path: string): Promise<void>;
    /**
     * Point a folder workspace at the directory it now occupies on this device.
     *
     * The directory it leaves joins {@link anchorPaths}, so the sessions recorded
     * under it stay members: a moved workspace is the same workspace in a new
     * place, and its sessions must not fall out of it.
     * @param path - canonical existing directory on this device.
     */
    relinkDirectory(path: string): Promise<void>;
    attachSession(sessionId: SessionId): Promise<void>;
    /**
     * Prove one candidate session may join this workspace, rejecting with the
     * reason when it may not.
     *
     * The two kinds admit opposite shapes, because the requirement is always
     * "the session's location must agree with the workspace's": a folder
     * workspace demands a header cwd that resolves to its own directory, while a
     * workspace with no directory demands a session that records no cwd either.
     * Admitting a cwd-carrying session into a pathless workspace would leave a
     * machine-local path inside a record that is expected to sync, so it is
     * refused rather than silently tolerated.
     * @param sessionId - session being admitted.
     */
    private validateAdmission;
    insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void>;
    detachSession(sessionId: SessionId): Promise<void>;
    status(): Promise<'ok' | 'missing-dir'>;
    /**
     * The single write path: run `fn` on the domain write chain via
     * `table.update`, stamping `updatedAt` and pruning candidates that no
     * longer pass the id-plus-canonical-cwd membership check, then swap the
     * snapshot.
     *
     * `fn` sees the value current at its chain slot, so membership decisions
     * (attach/detach idempotence) are race-free against queued writes; a fn
     * signalling no change by returning `current` verbatim aborts the slot
     * through the sentinel when pruning also finds nothing, so a no-op neither
     * rewrites the medium nor emits a change event.
     */
    private mutate;
}
//# sourceMappingURL=entity.d.ts.map