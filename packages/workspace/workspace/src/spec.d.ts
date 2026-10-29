/**
 * The workspace domain declaration: record schema and the `defineDomain` spec
 * the registry opens. The zod schema validates the shipped format at the
 * durability boundary and is the direct source of a future RPC wire projection.
 * @module @aeven/workspace/src/spec
 */
import { z } from 'zod';
import type { SessionId } from '@aeven/session';
import type { WorkspaceId, WorkspaceKind } from './types.ts';
/**
 * Durable shape of one workspace record. `kind` decides how the record binds
 * to a filesystem location and therefore whether `path` is present: a `folder`
 * record names an existing directory through its `fs.realpath` canon, while
 * `virtual` and `remote` records have no local directory at all and must omit
 * `path`. `sessionIds` is the ordered ownership account (array order is
 * display order); timestamps are ISO-8601 strings. `owner` is the account id of
 * the signed-in user who created the workspace; a workspace records none when
 * created where nobody is signed in.
 *
 * `kind` defaults to `'folder'` so every record written before the field
 * existed parses unchanged — those deployments only ever created directory
 * workspaces, which is exactly what the default asserts.
 *
 * `anchorPaths` lists directories the workspace occupied earlier on this
 * device, most recent first. It is device-local and never enters the account
 * document: a path means nothing on another machine, while a session recorded
 * under a replaced directory must stay attached after a relink.
 */
export declare const workspaceRecord: z.ZodObject<{
    kind: z.ZodDefault<z.ZodEnum<{
        folder: "folder";
        virtual: "virtual";
        remote: "remote";
    }>>;
    path: z.ZodOptional<z.ZodString>;
    anchorPaths: z.ZodOptional<z.ZodArray<z.ZodString>>;
    title: z.ZodString;
    owner: z.ZodOptional<z.ZodString>;
    sessionIds: z.ZodArray<z.ZodPipe<z.ZodString, z.ZodTransform<SessionId, string>>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    titleChangedAt: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** One stored workspace record, inferred from {@link workspaceRecord}. */
export type WorkspaceRecord = z.infer<typeof workspaceRecord>;
/** Durable workspace kinds, in the schema's own order. */
export declare const WORKSPACE_KINDS: readonly WorkspaceKind[];
/**
 * Whether a record's `kind` and `path` agree. `folder` requires a directory
 * canon; every other kind forbids one — a pathless record that nonetheless
 * carries a path would make membership checks and sync ambiguous about which
 * fact is authoritative, so the registry refuses it at both the durable and
 * the in-memory boundary.
 * @param kind - the record's durable kind.
 * @param path - the record's directory canon, when it has one.
 * @returns whether the pair is consistent.
 */
export declare function kindPathAgrees(kind: WorkspaceKind, path: string | undefined): boolean;
/**
 * Durable registry state. `initialized` distinguishes a valid empty registry
 * from one that still needs the header-only history bootstrap;
 * `workspaceIds` is the authoritative display order. `archivedSessionIds` is
 * the registry-global archive set layered over workspace accounting: an
 * archived session keeps its `sessionIds` slot (unarchiving must restore the
 * position), so the set never participates in the one-owner accounting
 * invariant. `defaultWorkspaceId` names the built-in Chats registration — the
 * one workspace a reader always has, so a first run never opens on a state that
 * demands a folder before it accepts a message. It is optional because every
 * registry written before the field existed simply has no built-in workspace,
 * and the absence is what a seeding pass fills. `builtInWorkspaceIds` binds
 * each plugin-declared built-in registration to its declaring key, so the same
 * registration returns across restarts. Defaulted or optional fields parse
 * unchanged from earlier records.
 */
export declare const workspaceDomainState: z.ZodObject<{
    initialized: z.ZodBoolean;
    workspaceIds: z.ZodArray<z.ZodPipe<z.ZodString, z.ZodTransform<WorkspaceId, string>>>;
    archivedSessionIds: z.ZodDefault<z.ZodArray<z.ZodPipe<z.ZodString, z.ZodTransform<SessionId, string>>>>;
    defaultWorkspaceId: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<WorkspaceId, string>>>;
    builtInWorkspaceIds: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodPipe<z.ZodString, z.ZodTransform<WorkspaceId, string>>>>;
    pendingMutation: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
        operation: z.ZodLiteral<"create">;
        workspaceId: z.ZodPipe<z.ZodString, z.ZodTransform<WorkspaceId, string>>;
    }, z.core.$strip>, z.ZodObject<{
        operation: z.ZodLiteral<"delete">;
        workspaceId: z.ZodPipe<z.ZodString, z.ZodTransform<WorkspaceId, string>>;
    }, z.core.$strip>], "operation">>;
}, z.core.$strip>;
/** Durable registry state inferred from {@link workspaceDomainState}. */
export type WorkspaceDomainState = z.infer<typeof workspaceDomainState>;
/** The global state a never-initialized domain starts from. */
export declare const INITIAL_WORKSPACE_DOMAIN_STATE: WorkspaceDomainState;
/**
 * The workspace domain spec: one `workspaces` table keyed by
 * {@link WorkspaceId} plus the bootstrap/order singleton. The registry opens
 * this through `ctx.storage.domain`; the spec object is the single source of
 * the domain's identity, version, and schemas.
 *
 * The `per-record` layout scopes each write to the record it changes. Under
 * the whole-unit layout every write republished the writing process's entire
 * in-memory snapshot, so two harness processes sharing one home overwrote
 * each other's workspaces and archive set — the one loss here that no log can
 * rebuild. Per-record narrows a write to the record it touches, and the
 * domain layer converges each process on the other's writes
 * (.agents/notes/implemented/architecture/2026-09-16-cross-process-domain-coherence.md).
 * Convergence is eventual, so simultaneous edits to the order or archive set,
 * which share `global.json`, still resolve last-writer-wins. An existing
 * `workspace.json` migrates on first open through the JSON backend's legacy
 * bootstrap, global included.
 */
export declare const workspaceDomainSpec: {
    name: string;
    version: number;
    layout: "per-record";
    global: {
        schema: z.ZodObject<{
            initialized: z.ZodBoolean;
            workspaceIds: z.ZodArray<z.ZodPipe<z.ZodString, z.ZodTransform<WorkspaceId, string>>>;
            archivedSessionIds: z.ZodDefault<z.ZodArray<z.ZodPipe<z.ZodString, z.ZodTransform<SessionId, string>>>>;
            defaultWorkspaceId: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<WorkspaceId, string>>>;
            builtInWorkspaceIds: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodPipe<z.ZodString, z.ZodTransform<WorkspaceId, string>>>>;
            pendingMutation: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                operation: z.ZodLiteral<"create">;
                workspaceId: z.ZodPipe<z.ZodString, z.ZodTransform<WorkspaceId, string>>;
            }, z.core.$strip>, z.ZodObject<{
                operation: z.ZodLiteral<"delete">;
                workspaceId: z.ZodPipe<z.ZodString, z.ZodTransform<WorkspaceId, string>>;
            }, z.core.$strip>], "operation">>;
        }, z.core.$strip>;
        initial: {
            initialized: boolean;
            workspaceIds: WorkspaceId[];
            archivedSessionIds: SessionId[];
            defaultWorkspaceId?: WorkspaceId | undefined;
            builtInWorkspaceIds?: Record<string, WorkspaceId> | undefined;
            pendingMutation?: {
                operation: "create";
                workspaceId: WorkspaceId;
            } | {
                operation: "delete";
                workspaceId: WorkspaceId;
            } | undefined;
        };
    };
    tables: {
        workspaces: import("@aeven/storage-domain").DomainTableSpec<WorkspaceId, {
            kind: "folder" | "virtual" | "remote";
            title: string;
            sessionIds: SessionId[];
            createdAt: string;
            updatedAt: string;
            path?: string | undefined;
            anchorPaths?: string[] | undefined;
            owner?: string | undefined;
            titleChangedAt?: string | undefined;
        }>;
    };
};
//# sourceMappingURL=spec.d.ts.map