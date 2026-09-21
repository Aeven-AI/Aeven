/**
 * The workspace domain declaration: record schema and the `defineDomain` spec
 * the registry opens. The zod schema validates the shipped format at the
 * durability boundary and is the direct source of a future RPC wire projection.
 * @module @aeven/workspace/src/spec
 */

import { z } from 'zod'
import { brandString } from '@aeven/brand'
import type { SessionId } from '@aeven/session'
import { defineDomain, domainTable } from '@aeven/storage-domain'
import type { WorkspaceId, WorkspaceKind } from './types.ts'

/** Workspace id schema at the durable boundary; branding has no runtime representation. */
const workspaceId = z.string().transform(value => value as WorkspaceId)

/**
 * Durable shape of one workspace record. `kind` decides how the record binds
 * to a filesystem location and therefore whether `path` is present: a `folder`
 * record names an existing directory through its `fs.realpath` canon, while
 * `virtual` and `remote` records have no local directory at all and must omit
 * `path`. `sessionIds` is the ordered ownership account (array order is
 * display order); timestamps are ISO-8601 strings.
 *
 * `kind` defaults to `'folder'` so every record written before the field
 * existed parses unchanged — those deployments only ever created directory
 * workspaces, which is exactly what the default asserts.
 */
export const workspaceRecord = z.object({
  kind: z.enum(['folder', 'virtual', 'remote']).default('folder'),
  path: z.string().optional(),
  title: z.string(),
  sessionIds: z.array(z.string().transform(value => brandString<SessionId>(value))),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored workspace record, inferred from {@link workspaceRecord}. */
export type WorkspaceRecord = z.infer<typeof workspaceRecord>

/** Durable workspace kinds, in the schema's own order. */
export const WORKSPACE_KINDS: readonly WorkspaceKind[] = ['folder', 'virtual', 'remote']

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
export function kindPathAgrees(
  kind: WorkspaceKind,
  path: string | undefined,
): boolean {
  return kind === 'folder' ? path !== undefined : path === undefined
}

/**
 * Recoverable two-write mutation marker. The marker is persisted before the
 * record/order pair can diverge, so startup can distinguish an interrupted
 * registry operation from unexplained medium corruption.
 */
const workspacePendingMutation = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('create'), workspaceId }),
  z.object({ operation: z.literal('delete'), workspaceId }),
])

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
 * and the absence is what a seeding pass fills. Defaulted or optional fields
 * parse unchanged from earlier records.
 */
export const workspaceDomainState = z.object({
  initialized: z.boolean(),
  workspaceIds: z.array(workspaceId),
  archivedSessionIds: z.array(z.string().transform(value => brandString<SessionId>(value))).default([]),
  defaultWorkspaceId: workspaceId.optional(),
  pendingMutation: workspacePendingMutation.optional(),
})

/** Durable registry state inferred from {@link workspaceDomainState}. */
export type WorkspaceDomainState = z.infer<typeof workspaceDomainState>

/** The global state a never-initialized domain starts from. */
export const INITIAL_WORKSPACE_DOMAIN_STATE: WorkspaceDomainState = {
  initialized: false,
  workspaceIds: [],
  archivedSessionIds: [],
}

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
export const workspaceDomainSpec = defineDomain({
  name: 'workspace',
  version: 2,
  layout: 'per-record',
  global: {
    schema: workspaceDomainState,
    initial: INITIAL_WORKSPACE_DOMAIN_STATE,
  },
  tables: { workspaces: domainTable<WorkspaceId, WorkspaceRecord>(workspaceRecord) },
})
