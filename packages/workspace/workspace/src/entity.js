/**
 * Package-private workspace entity: the single {@link Workspace}
 * implementation. Holds a record snapshot that is swapped in place after each
 * durable mutation; every write funnels through the private `mutate` so
 * `updatedAt` stamping and invalid-account pruning happen exactly once.
 * Not re-exported from the package entrypoint — consumers see only the
 * `Workspace` interface.
 * @module @aeven/workspace/src/entity
 */
import { stat } from 'node:fs/promises';
import { realpathNormalize } from "./paths.js";
/** An insertSessionBefore request named a session or anchor not on the account (storage failures stay plain errors). */
export class WorkspaceMoveInvalidError extends Error {
    /**
     * @param message - Which id was unaccounted and where.
     */
    constructor(message) {
        super(message);
        this.name = 'WorkspaceMoveInvalidError';
    }
}
/**
 * A mutation targeted a built-in workspace, which the product pins: the default
 * workspace and every plugin-declared built-in registration can be neither
 * removed, renamed, nor reordered. Defined here rather than beside the registry
 * so the entity can raise it without importing its own owner.
 */
export class WorkspaceDefaultImmutableError extends Error {
    workspaceId;
    operation;
    /**
     * @param workspaceId - The built-in workspace's id.
     * @param operation - The refused operation.
     */
    constructor(workspaceId, operation) {
        super(`cannot ${operation} the built-in workspace '${workspaceId}': it is pinned`);
        this.workspaceId = workspaceId;
        this.operation = operation;
        this.name = 'WorkspaceDefaultImmutableError';
    }
}
/** Chain-slot abort sentinel thrown by the update fn when the record needs no change; only `mutate` observes it. */
const unchangedSentinel = new Error('workspace record unchanged (internal sentinel)');
/**
 * Name one record in error text: its directory canon when it has one, otherwise
 * its stable id — the only fact a pathless workspace can be identified by.
 * @param id - the record's stable id.
 * @param record - the record being named.
 * @returns a label safe to interpolate.
 */
function labelOf(id, record) {
    return record.path ?? String(id);
}
/**
 * Every directory this record owns: the current one plus the ones a relink
 * replaced, most recent first.
 * @param record - the record whose directories are being listed.
 * @returns the owned directories, empty for a record with no directory.
 */
function ownedPaths(record) {
    if (record.path === undefined)
        return [];
    return [record.path, ...record.anchorPaths ?? []];
}
/** The single {@link Workspace} implementation; constructed only by the registry. */
export class WorkspaceEntity {
    host;
    id;
    record;
    /**
     * @param host - Registry-owned table, session-path index, and header reads.
     * @param id - The record's stable id.
     * @param record - The validated record snapshot loaded or just written.
     */
    constructor(host, id, record) {
        this.host = host;
        this.id = id;
        this.record = record;
    }
    get kind() {
        return this.record.kind;
    }
    /**
     * Whether this is the registry's built-in workspace. Asked of the host on
     * every read rather than cached in the record, because the bit lives in the
     * domain global and another process sharing this storage root may have set or
     * cleared it since this snapshot was taken.
     */
    get isDefault() {
        return this.host.isDefault(this.id);
    }
    get isBuiltIn() {
        return this.host.isBuiltIn(this.id);
    }
    get path() {
        return this.record.path;
    }
    get title() {
        return this.record.title;
    }
    /**
     * A record written before workspaces carried an owner takes the owner of its
     * sessions when they all belong to one account; otherwise it has none.
     */
    get owner() {
        if (this.record.owner !== undefined)
            return this.record.owner;
        const owners = new Set(this.sessionIds.map(id => this.host.sessionOwner(id)));
        const [only] = owners;
        return owners.size === 1 ? only : undefined;
    }
    get createdAt() {
        return this.record.createdAt;
    }
    get updatedAt() {
        return this.record.updatedAt;
    }
    get anchorPaths() {
        return this.record.anchorPaths ?? [];
    }
    get sessionIds() {
        return this.record.sessionIds.filter(id => this.member(id));
    }
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
    member(id) {
        const path = this.record.path;
        if (this.record.kind !== 'folder' || path === undefined || this.host.replicated(id))
            return true;
        const sessionPath = this.host.sessionPath(id);
        return sessionPath !== undefined && ownedPaths(this.record).includes(sessionPath);
    }
    /**
     * A human-identifiable label for error text: the directory canon when the
     * workspace has one, otherwise the stable id, which is the only fact a
     * pathless workspace can be named by.
     */
    get label() {
        return this.record.path ?? String(this.id);
    }
    async setTitle(title) {
        // A built-in workspace's name is product copy rather than a field a reader
        // owns. Renaming it would also desynchronise every client that renders its
        // own localized label for that registration.
        if (this.host.isBuiltIn(this.id)) {
            throw new WorkspaceDefaultImmutableError(this.id, 'rename');
        }
        await this.mutate(record => ({ ...record, title, titleChangedAt: new Date().toISOString() }));
        this.host.titleChanged();
    }
    /**
     * Adopt the title its declaring plugin now declares. A built-in title is
     * product copy, so the plugin that owns the registration — never a reader —
     * is what renames it.
     * @param title - the title the declaring plugin currently declares.
     */
    async adoptDeclaredTitle(title) {
        await this.mutate(record => record.title === title ? record : { ...record, title });
    }
    /**
     * Give a workspace another device registered a directory on this device. The directory stays on this device:
     * account sync carries the workspace's title and order, never its path.
     * @param path - canonical existing directory.
     */
    async bindDirectory(path) {
        if (this.record.kind !== 'remote')
            throw new Error(`workspace '${this.label}' already has its directory on this device`);
        await this.mutate(record => ({ ...record, kind: 'folder', path }));
    }
    /**
     * Point a folder workspace at the directory it now occupies on this device.
     *
     * The directory it leaves joins {@link anchorPaths}, so the sessions recorded
     * under it stay members: a moved workspace is the same workspace in a new
     * place, and its sessions must not fall out of it.
     * @param path - canonical existing directory on this device.
     */
    async relinkDirectory(path) {
        const previous = this.record.path;
        if (this.record.kind !== 'folder' || previous === undefined) {
            throw new Error(`workspace '${this.label}' has no directory on this device to relink`);
        }
        if (previous === path)
            return;
        await this.mutate(record => ({
            ...record,
            path,
            anchorPaths: [previous, ...(record.anchorPaths ?? []).filter(anchor => anchor !== previous && anchor !== path)],
        }));
    }
    async attachSession(sessionId) {
        // Validation is skipped when the settled snapshot already accounts the
        // id: the cwd fact was checked when it first attached and both inputs
        // (stored header cwd, workspace path) are immutable. Membership itself is
        // decided on the write chain inside `mutate`, never on this snapshot.
        if (!this.record.sessionIds.includes(sessionId)) {
            await this.validateAdmission(sessionId);
        }
        await this.mutate(record => record.sessionIds.includes(sessionId)
            ? record
            : { ...record, sessionIds: [sessionId, ...record.sessionIds] });
    }
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
    async validateAdmission(sessionId) {
        const header = await this.host.readSessionHeader(sessionId);
        // A replica's cwd names the folder of the device it came from; the account's record files it here.
        if (this.host.replicated(sessionId))
            return;
        const path = this.record.path;
        if (this.record.kind !== 'folder' || path === undefined) {
            if (header.cwd !== undefined) {
                throw new Error(`cannot attach session '${sessionId}' to workspace '${this.label}': `
                    + `that workspace has no directory, but the session records cwd '${header.cwd}'`);
            }
            return;
        }
        if (header.cwd === undefined) {
            throw new Error(`cannot attach session '${sessionId}' to workspace '${this.label}': `
                + 'its stored header carries no cwd to validate against');
        }
        let cwd;
        try {
            cwd = await realpathNormalize(header.cwd);
        }
        catch (error) {
            throw new Error(`cannot attach session '${sessionId}' to workspace '${this.label}': `
                + `its cwd '${header.cwd}' does not resolve, so it cannot be validated`, { cause: error });
        }
        if (!(await stat(cwd)).isDirectory()) {
            throw new Error(`cannot attach session '${sessionId}' to workspace '${this.label}': `
                + `its cwd '${header.cwd}' is not a directory`);
        }
        if (!ownedPaths(this.record).includes(cwd)) {
            throw new Error(`cannot attach session '${sessionId}' to workspace '${this.label}': `
                + `its cwd resolves to '${cwd}'`);
        }
        this.host.rememberSessionPath(sessionId, cwd);
    }
    async insertSessionBefore(sessionId, beforeSessionId) {
        await this.mutate((record) => {
            // Messages name the chain-current record, not this entity's snapshot:
            // the write chain's value is the one the decision was made against.
            const label = labelOf(this.id, record);
            if (!record.sessionIds.includes(sessionId)) {
                throw new WorkspaceMoveInvalidError(`cannot move session '${sessionId}' in workspace '${label}': the session is not accounted`);
            }
            if (beforeSessionId !== undefined && !record.sessionIds.includes(beforeSessionId)) {
                throw new WorkspaceMoveInvalidError(`cannot move session '${sessionId}' before '${beforeSessionId}' in workspace '${label}': `
                    + 'the anchor session is not accounted');
            }
            if (beforeSessionId === sessionId)
                return record;
            const without = record.sessionIds.filter(id => id !== sessionId);
            const at = beforeSessionId === undefined ? without.length : without.indexOf(beforeSessionId);
            const sessionIds = [...without.slice(0, at), sessionId, ...without.slice(at)];
            return sessionIds.every((id, index) => id === record.sessionIds[index])
                ? record
                : { ...record, sessionIds };
        });
    }
    async detachSession(sessionId) {
        await this.mutate(record => record.sessionIds.includes(sessionId)
            ? { ...record, sessionIds: record.sessionIds.filter(id => id !== sessionId) }
            : record);
    }
    async status() {
        const path = this.record.path;
        // A workspace with no directory binding makes no filesystem claim, so it
        // is never "missing" anything; only a folder workspace can lose its dir.
        if (this.record.kind !== 'folder' || path === undefined)
            return 'ok';
        try {
            return (await stat(path)).isDirectory() ? 'ok' : 'missing-dir';
        }
        catch {
            // Any stat failure (ENOENT, dangling parent, permission loss) means the
            // directory is not usable right now; the record itself never mutates.
            return 'missing-dir';
        }
    }
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
    async mutate(fn) {
        let next;
        try {
            next = await this.host.table().update(this.id, (current) => {
                const changed = fn(current);
                const owned = ownedPaths(changed);
                const sessionIds = changed.sessionIds.filter((id) => {
                    if (this.host.replicated(id) || changed.path === undefined)
                        return true;
                    const sessionPath = this.host.sessionPath(id);
                    return sessionPath !== undefined && owned.includes(sessionPath);
                });
                if (changed === current && sessionIds.length === current.sessionIds.length) {
                    throw unchangedSentinel;
                }
                return { ...changed, sessionIds, updatedAt: new Date().toISOString() };
            });
        }
        catch (error) {
            if (error === unchangedSentinel)
                return;
            throw error;
        }
        this.record = next;
    }
}
//# sourceMappingURL=entity.js.map