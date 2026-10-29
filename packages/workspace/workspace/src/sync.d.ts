/**
 * Keeps the account's workspaces the same on all of its devices through the account's synced `workspaces`
 * document, while `ctx.sync` serves the account. The document holds each workspace's title and timestamps and the
 * account's display order — never a directory path, because a folder lives on the device that opened it: another
 * device receives the workspace pathless and stores it as `remote` until it binds a directory of its own. Session
 * accounting and the archive set stay device-local for the same reason, since a session body lives where it ran.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SyncDocument } from '@aeven/sync';
import type { WorkspaceId } from './types.ts';
/** One workspace as the document holds it. */
export interface SyncedWorkspace {
    /** Display title shown by every device. */
    title?: string;
    /** Account the workspace belongs to. */
    owner?: string;
    /** When the workspace was first registered, as a stored timestamp. */
    createdAt?: string;
    /** When the title last changed, as a stored timestamp; the later write wins. */
    updatedAt?: string;
    /** Set once the workspace was removed. */
    removed?: boolean;
}
/** The account's workspaces as one device publishes or receives them. */
export interface SyncedWorkspaces {
    /** Every workspace of the account, the removed ones marked. */
    readonly records: readonly ({
        readonly id: WorkspaceId;
    } & SyncedWorkspace)[];
    /** The account's workspaces in display order. */
    readonly order: readonly WorkspaceId[];
}
/** Applies another device's workspaces on this device. */
export type WorkspaceApply = (owner: string, projection: SyncedWorkspaces) => void;
/** Mirror between the workspace registry and each account's synced document. */
export declare class WorkspaceSync {
    private readonly ctx;
    private readonly apply;
    private readonly warn;
    private readonly now;
    private readonly open;
    /**
     * @param ctx - the registry context; `sync` is read optionally.
     * @param apply - stores another device's workspaces on this device.
     * @param warn - receives failures to open the document.
     * @param now - clock for the tombstone timestamp.
     */
    constructor(ctx: Context, apply: WorkspaceApply, warn: (message: string) => void, now?: () => Date);
    /**
     * Open the account's document once this device syncs it and apply what other devices wrote.
     * @param owner - the account.
     * @returns the open document, or undefined while sync does not serve the account.
     */
    attach(owner: string): Promise<SyncDocument | undefined>;
    private take;
    /**
     * Accounts this device has opened a document for.
     * @returns the account ids.
     */
    owners(): readonly string[];
    /**
     * Publish one account's workspaces after a local change. A workspace this device does not hold is left as the
     * document has it, since it may be one this device has not received yet; only {@link forget} removes one.
     * @param owner - the account.
     * @param projection - its workspaces and their order.
     */
    publish(owner: string, projection: SyncedWorkspaces): Promise<void>;
    /**
     * Publish the removal of one workspace this device deleted.
     * @param owner - the account.
     * @param id - the removed workspace.
     * @param title - its last title, kept so a device that never received it can still name it.
     */
    forget(owner: string, id: WorkspaceId, title: string): Promise<void>;
    /** Close every open document. */
    dispose(): Promise<void>;
}
//# sourceMappingURL=sync.d.ts.map