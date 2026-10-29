/**
 * Workspace entity registry (`ctx.workspaceRegistry`): durable workspace records,
 * stable registry order, and header-validated session membership over the
 * domain data form.
 * @module @aeven/workspace
 */
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { SessionHeader, SessionId } from '@aeven/session';
export { WorkspaceDefaultImmutableError, WorkspaceMoveInvalidError } from './entity.ts';
import type { FolderWorkspace, SessionPlacement, Workspace, WorkspaceId as WorkspaceIdBrand } from './types.ts';
export type { FolderWorkspace, SessionPlacement, Workspace, WorkspaceKind } from './types.ts';
export { INITIAL_WORKSPACE_DOMAIN_STATE, kindPathAgrees, WORKSPACE_KINDS, workspaceDomainSpec, workspaceDomainState, workspaceRecord, } from './spec.ts';
export type { WorkspaceDomainState, WorkspaceRecord } from './spec.ts';
export { realpathNormalize } from './paths.ts';
/** Whether a registry without a built-in workspace seeds one (the schema default). */
export declare const DEFAULT_SEED_DEFAULT_WORKSPACE = true;
/** Display title a newly seeded built-in workspace is given (the schema default). */
export declare const DEFAULT_DEFAULT_WORKSPACE_TITLE = "Chats";
/** Plugin configuration for the registry. */
export interface Config {
    /** Whether a registry without a built-in workspace seeds one at startup (default: true). */
    seedDefaultWorkspace?: boolean;
    /** Display title given to a newly seeded workspace (default: `Chats`). */
    defaultWorkspaceTitle?: string;
}
/** Identifies one workspace record (see `src/types.ts` for the brand rationale). */
export type WorkspaceId = WorkspaceIdBrand;
/**
 * Whether one workspace is folder-backed, narrowing {@link Workspace.path} to a
 * present string. The registry's own `create` is the only producer of folder
 * workspaces today, but consumers must not rely on that: the narrowing is how
 * a caller that genuinely needs a directory states the requirement instead of
 * asserting it.
 * @param workspace - any workspace.
 * @returns true when the workspace has a canonical directory path.
 */
export declare function isFolderWorkspace(workspace: Workspace): workspace is FolderWorkspace;
/**
 * Brand a string as a {@link WorkspaceId}.
 * @param id - Raw workspace id string.
 * @returns the same string, branded at compile time.
 */
export declare function WorkspaceId(id: string): WorkspaceId;
/**
 * An archiveSession request named a session neither live nor in session
 * persistence — a definite miss only; storage faults propagate as themselves.
 */
export declare class WorkspaceUnknownSessionError extends Error {
    readonly sessionId: SessionId;
    /**
     * @param sessionId - The unknown session id.
     */
    constructor(sessionId: SessionId);
}
/** A workspace reorder named a source or anchor absent from the durable registry order. */
export declare class WorkspaceOrderInvalidError extends Error {
    readonly workspaceId: WorkspaceId;
    /**
     * @param workspaceId - Missing source or anchor id.
     */
    constructor(workspaceId: WorkspaceId);
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        workspaceRegistry: WorkspaceRegistry;
    }
}
/**
 * Durable workspace registry. Startup waits for `sessionPersistence`, builds
 * one canonical-cwd header index, completes the one-time history bootstrap,
 * and re-derives membership from that index before the service becomes
 * active. The persistence dependency is mandatory so an unavailable peer can
 * never be mistaken for an empty history and commit the initialized marker.
 *
 * Membership is re-derived rather than trusted because the durable record is
 * not safe to trust alone: its domain is a whole-document store with no
 * cross-process write locking, so another Host sharing this storage root can
 * replace the record with a snapshot that never saw these Sessions. A cwd that
 * canonically equals an existing Workspace's path is the one fact that
 * survives on its own.
 */
export declare class WorkspaceRegistry extends Service {
    private readonly config;
    static inject: string[];
    static Config: z<Config>;
    private table?;
    private global?;
    private state?;
    private readonly entities;
    private readonly headers;
    /** Imported sessions whose shared workspace has not reached this device yet, by shared workspace name. */
    private readonly unfiled;
    /** Observers of sessions filed after their workspace arrived from another device. */
    private readonly lateFiling;
    /** Accounts whose ownerless workspaces this process already claimed. */
    private readonly claimed;
    private readonly sessionPaths;
    private readonly invalidSessionPaths;
    private operationTail;
    private readonly synced;
    private readonly host;
    /**
     * @param ctx - Host context the registry publishes itself on.
     * @param config - Seeding configuration. Optional so a direct
     *   `ctx.plugin(WorkspaceRegistry)` mount stays valid; the defaults are stated
     *   once as {@link DEFAULT_SEED_DEFAULT_WORKSPACE} and
     *   {@link DEFAULT_DEFAULT_WORKSPACE_TITLE} and resolved at each use, so they
     *   hold whether or not a loader applied `WorkspaceRegistry.Config`.
     */
    constructor(ctx: Context, config?: Config);
    /**
     * Open the domain, finish bootstrap when required, seed the built-in
     * workspace, and rebuild the ordered cache.
     *
     * Seeding happens here, before the service becomes active, and never in a
     * separate startup plugin. A consumer that observes the registry must never
     * see a first run without its built-in workspace: the client's startup
     * navigation resolves a workspace exactly once and latches, so a workspace
     * that appeared after its first baseline would leave the reader on the
     * blocked empty state for the rest of the session.
     */
    protected [Service.init](): Promise<void>;
    /**
     * Restore the built-in workspace to the head of the durable order.
     *
     * A registration created before the head was held was prepended above it, so
     * an order read back from storage can hold the head lower than the product
     * puts it. The repair is one write, made only when the order disagrees and
     * before any consumer reads the order, so a stored arrangement converges on
     * the pinned one at the next mount instead of waiting for a drag.
     */
    private pinDefaultWorkspaceHead;
    /**
     * Create or reuse a workspace for an existing directory. The fully qualified
     * path is canonicalized through `fs.realpath`; a relative, nonexistent, or
     * non-directory path rejects. Repeated calls for the same canonical path and
     * owner return the existing entity without changing its title; another
     * account registering the same directory gets a workspace of its own.
     * A newly created workspace lands directly below the built-in one, which
     * keeps the head of the order — and so the first screen — where the reader
     * left it instead of handing it to whichever registration was created last.
     * Different canonical paths may share a display title.
     * @param path - Existing directory to own, in a fully qualified path spelling.
     * @param title - Display title used only when a new record is created.
     * @param owner - Account id of the signed-in user registering the directory; absent when nobody is signed in.
     * @returns the existing or newly durable workspace.
     */
    create(path: string, title?: string, owner?: string): Promise<Workspace>;
    /**
     * Look up a workspace by id.
     * @param id - Workspace id.
     * @returns the workspace, or `undefined` when unknown.
     */
    get(id: WorkspaceId): Workspace | undefined;
    /**
     * Synchronous workspace projection in durable registry order. Every
     * entity's `sessionIds` getter is already filtered by the startup/live
     * canonical-cwd header index; this method performs no persistence reads.
     * @returns a fresh ordered array of workspace entities.
     */
    list(): Workspace[];
    /**
     * Delete one workspace registration while retaining its directory and every
     * session log. The workspace's sessions join the archive set in the same
     * write that removes it from the durable order, so no session is left
     * without a group. The order and archive write precedes the table deletion;
     * a failed table write restores the prior order and archive set and keeps
     * the entity published. Unknown ids are an idempotent no-op for domain
     * callers.
     *
     * The built-in workspace refuses deletion. It is the one registration the
     * product guarantees a reader has, and removing it would restore the state
     * the registration exists to prevent — a first screen that demands a folder
     * before it accepts a message. A deployment that does not want one turns
     * seeding off in configuration rather than deleting it at runtime.
     * @param id - Workspace registration to remove.
     * @returns `true` when a record was deleted, `false` when it was unknown.
     * @throws {WorkspaceDefaultImmutableError} when the id names the built-in workspace.
     */
    delete(id: WorkspaceId): Promise<boolean>;
    /**
     * Name the workspace a session belongs to in the terms every device of the account shares: `default` for the
     * built-in default workspace, `builtin:<key>` for a plugin-declared one, and the workspace id otherwise.
     * @param sessionId - the session.
     * @returns the shared name, or undefined when no workspace holds the session.
     */
    sessionHome(sessionId: SessionId): string | undefined;
    /**
     * Name the workspace of every filed session at once, as {@link sessionHome} names each, in one pass over the
     * registry; a caller that asks about many sessions uses this instead of one {@link sessionHome} call per session.
     * @returns each filed session's shared workspace name.
     */
    sessionHomes(): ReadonlyMap<SessionId, string>;
    /**
     * Name the workspace that accounts a Session on this device, as a consumer that needs a directory reads it.
     *
     * The answer is about this device only: a Session imported from another device is `pending` until its
     * workspace arrives, never filed by the path in its header, because that path names another machine's folder.
     * @param sessionId - the session.
     * @returns the local workspace, the shared name it awaits, or the fact that none accounts it.
     */
    placeSession(sessionId: SessionId): SessionPlacement;
    /**
     * Whether a Session's log was published by another device, so the directory its header records belongs to that
     * device rather than to this one.
     * @param sessionId - the session to check.
     * @returns whether this device holds a copy of another device's log.
     */
    replicated(sessionId: SessionId): boolean;
    private sharedName;
    /**
     * File a session another device published into the workspace its {@link sessionHome} names, when this device
     * holds that workspace and the session is not filed yet.
     * @param sessionId - the session, already stored on this device.
     * @param home - the shared workspace name.
     * @param header - received metadata when the body has not been downloaded yet.
     * @returns whether the session is now filed there.
     */
    fileSession(sessionId: SessionId, home: string, header?: SessionHeader): Promise<boolean>;
    /**
     * Observe sessions that {@link fileSession} could not file earlier joining their workspace once it arrived from
     * another device.
     * @param listener - called after one or more such sessions were filed.
     * @returns the disposer.
     */
    onLateFiling(listener: () => void): () => void;
    /**
     * Point a workspace at a directory on this device. A record another device
     * registered gains its first directory here; a folder record whose directory
     * moved is relinked to the new one. Either way the account's other devices
     * keep their own paths: the binding is device-local, while the workspace id
     * is what they share.
     * @param id - the workspace to point at a directory here.
     * @param path - existing directory, in a fully qualified spelling.
     * @returns the workspace, folder-backed and naming that directory.
     */
    bind(id: WorkspaceId, path: string): Promise<Workspace>;
    /**
     * Move one workspace within the durable display order, DOM-insertBefore-like.
     * With an anchor it lands before that workspace; without one it appends.
     *
     * The built-in workspace holds the head of the order: it is where a reader
     * lands when nothing is selected, so its position is part of what makes the
     * first screen predictable rather than a preference a drag can reorder. An
     * anchor of the built-in therefore lands the moved workspace directly below
     * it, the same place a new registration takes.
     * @param id - Workspace to move.
     * @param beforeId - Workspace anchor; omitted appends.
     * @returns the complete committed workspace order.
     * @throws {WorkspaceDefaultImmutableError} when the id names a built-in workspace.
     */
    insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]>;
    /**
     * The registry-global archive set: sessions hidden from every grouping
     * surface. Archiving never touches workspace accounting — an archived
     * session keeps its `sessionIds` slot so unarchiving restores its position.
     * @returns the archived session ids in archive order.
     */
    get archivedSessionIds(): readonly SessionId[];
    /**
     * Archive one session durably. The session must exist (live or in session
     * persistence); its workspace accounting — or lack of one — is irrelevant.
     * An already archived id resolves without writing.
     * @param sessionId - The session to archive.
     * @returns resolution after durability.
     */
    archiveSession(sessionId: SessionId): Promise<void>;
    /**
     * Unarchive one session durably by dropping it from the registry-global
     * archive set; the accounting slot was never touched, so the session
     * returns to its recorded position. Removing an id cannot introduce an
     * unknown one, so no session-existence check runs. An id that is not
     * archived resolves without writing.
     * @param sessionId - The session to unarchive.
     * @returns resolution after durability.
     */
    unarchiveSession(sessionId: SessionId): Promise<void>;
    /**
     * Drop every registry fact about a deleted session: its workspace
     * accounting, its archive entry, and its indexed header. The caller has
     * already removed the session from live state and persistence, so nothing
     * re-adopts it.
     * @param sessionId - The deleted session.
     * @returns resolution after durability.
     */
    forgetSession(sessionId: SessionId): Promise<void>;
    /**
     * Publish each account's workspaces to its synced document after a committed mutation.
     *
     * A directory path, session accounting, and the archive set stay on this device; what travels is the
     * workspace's identity, title, and timestamps together with the account's display order.
     */
    private publish;
    /**
     * Give the account each workspace that has no owner and holds sessions of that account and of no other, then
     * publish. Workspaces registered before workspaces carried an owner would otherwise never reach the account's
     * other devices, and their sessions would arrive there without a workspace.
     * @param owner - the account this device now syncs.
     * @returns when the claimed workspaces are stored and published.
     */
    private claimOwnerless;
    /**
     * Store another device's workspaces of one account.
     *
     * A workspace this device opened a directory for keeps its path and kind, and one it only received is `remote`,
     * which is the kind a workspace without a directory here has always had. A later title wins, and a removal drops
     * this device's record without touching a directory or a session log.
     * @param owner - the account the workspaces belong to.
     * @param projection - its workspaces and their order as another device published them.
     */
    private applySynced;
    /**
     * Whether a session is live, header-indexed, or present in a fresh
     * persistence listing. Only a definite miss returns false — a failing
     * `sessionPersistence.list()` propagates so storage faults never
     * masquerade as an unknown session.
     */
    private sessionKnown;
    /**
     * Resolve by canonical directory path without creating or mutating a
     * workspace. A missing path rejects during `realpath`; an existing unowned
     * directory returns `undefined`.
     * @param path - Existing directory path in a fully qualified spelling.
     * @param owner - Account whose workspace to find; absent finds the one no account owns.
     * @returns that account's workspace for the canonical path, when one exists.
     */
    resolveByPath(path: string, owner?: string): Promise<Workspace | undefined>;
    /**
     * Owner recorded in an indexed session header.
     * @param sessionId - the session to read.
     * @returns the account id, or `undefined` when the session records none or is not indexed.
     */
    sessionOwner(sessionId: SessionId): string | undefined;
    private createCanonical;
    /**
     * Seed or return one built-in workspace declared by a plugin under a stable
     * key. The registration has no directory, every account reaches it, and it
     * refuses delete, rename, and move like the default workspace. The key binds
     * durably to the registration, so repeated calls and restarts return the
     * same workspace; a changed declared title is adopted on the next call, and a
     * new one lands directly below the default workspace.
     * @param key - stable key naming the declaring plugin's registration.
     * @param title - display title the declaring plugin owns.
     * @returns the built-in workspace.
     */
    builtIn(key: string, title: string): Promise<Workspace>;
    /**
     * Create one workspace that has no directory, using the same three-write
     * choreography as {@link createCanonical} — pending marker, record, then
     * order — so an interrupted seeding is recovered exactly like any other
     * create.
     * @param title - display title for the new registration.
     * @param place - the committed state that orders and marks the new registration.
     * @returns the newly durable pathless entity, already cached.
     */
    private createVirtualCanonical;
    /**
     * Ensure the registry publishes its built-in workspace, creating it when the
     * deployment asks for one and this registry has none.
     *
     * This runs inside startup, before the service becomes active, because the
     * built-in workspace is a precondition of the product's first screen rather
     * than a convenience: a consumer that resolves "the workspace to start in"
     * does so once and latches, so a registration that appeared a moment later
     * would leave the reader on the blocked empty state for the rest of the
     * session.
     *
     * The recorded id is the fast path: when it names a registration, startup
     * performs no write at all — `validateStoredState` has already proved the
     * record exists and is ordered, and a marker naming a missing record fails
     * loud there rather than being silently repaired, exactly as every other
     * order/table divergence does.
     *
     * A registry with no marker adopts a pathless registration it already holds
     * before seeding a new one: the durable global and the table are written
     * separately, so another process sharing this storage root can republish a
     * snapshot that predates the marker while the record itself survives, and
     * creating a second built-in workspace would be the wrong answer to that.
     */
    private ensureDefaultWorkspace;
    /**
     * The id of the built-in workspace, when this registry has one.
     * @returns the durable default workspace id, or `undefined`.
     */
    get defaultWorkspaceId(): WorkspaceId | undefined;
    private deleteKnown;
    /**
     * Complete the one mutation explicitly named by durable state. Unexplained
     * order/table divergence still reaches {@link validateStoredState} and
     * fails loud; this path never guesses which operation created a row from its shape alone.
     */
    private recoverPendingMutation;
    private bootstrap;
    private validateStoredState;
    private rebuildEntities;
    private replaceHeaderIndex;
    private indexHeaders;
    private indexHeader;
    private indexLiveSessions;
    /**
     * Re-assert membership the durable record may have lost while another Host
     * held the shared storage root: ordinary Sessions with a matching folder
     * are attached again, and unassigned pathless Sessions enter Chats. An already-accounted
     * Session costs one set lookup and no write, so a healthy start performs no
     * storage write at all. A registration the user deleted stays deleted: only
     * Workspaces that still exist admit.
     */
    private reconcileMembership;
    /**
     * Attach one just-announced Session to the Workspace that owns its canonical
     * cwd, if any. The product offers no way to leave such a Session
     * deliberately ungrouped, so a cwd match means the Session belongs in that
     * group and the record is simply missing the fact.
     * @param header - header of the Session that was just entered and announced.
     */
    private adoptByCwd;
    private reportFilteredCandidates;
    private readSessionHeader;
    private requireTable;
    private requireState;
    /**
     * Publish the first two writes of one create: the pending-create marker, then
     * the record itself, rolling the published entity back when either fails.
     *
     * The two create paths — a folder-backed registration and the built-in
     * pathless one — differ only in the state they finally commit and in the
     * wording of their failure, so the marker/record/rollback choreography lives
     * here once. Marker before record is what makes an interrupted create
     * recoverable: a record without a marker is invisible to recovery, while a
     * marker without a record is exactly the state {@link recoverPendingMutation}
     * completes.
     * @param id - id of the record being written, and the entity to unpublish on failure.
     * @param state - the state the create is derived from, restored if the record write fails.
     * @param record - the record itself.
     * @param recordWriteMessage - failure text naming the caller's registration kind.
     * @param pendingState - complete marker state; defaults to the caller's state plus the marker.
     */
    private writePendingCreate;
    private setState;
    /**
     * Force the built-in workspace to the head of an order derived without it.
     *
     * The built-in workspace is the one entry no order write may displace: it is
     * where a reader lands when nothing is selected, so its position is part of
     * what makes the first screen predictable rather than a preference. Ranking,
     * insertion, and load-time repair all end here, which keeps that promise in
     * one place instead of at each writer.
     * @param state - state whose built-in id applies.
     * @param workspaceIds - derived order.
     * @returns the order with the built-in first, or the input when it already is.
     */
    private pinnedHead;
    /**
     * Place a newly created workspace in the durable order: directly below the
     * built-in one, or at the head while no built-in exists.
     * @param state - state the create is derived from.
     * @param id - the newly durable workspace.
     * @returns complete order for the create write.
     */
    private withNewWorkspace;
    /**
     * Build the next global state for a write that changes only the initialized
     * marker and the workspace order, carrying every other field over from the
     * state it was derived from.
     *
     * Reconstructing the global from a fresh object literal is how a field
     * silently disappears: an optional field left out of the literal is dropped
     * from durable storage without a type error, and nothing else in the registry
     * would notice. Funnelling those five writes through one helper keeps the
     * carried fields in a single place, and the `pendingMutation` marker is
     * deliberately never carried — every caller here is either clearing it
     * because its operation settled, or re-adding one afterwards.
     * @param state - the state the change is derived from.
     * @param changes - the marker and order this write establishes.
     * @returns complete state for this write.
     */
    private carryState;
    private isBuiltInId;
    private enqueueOperation;
}
export default WorkspaceRegistry;
//# sourceMappingURL=index.d.ts.map