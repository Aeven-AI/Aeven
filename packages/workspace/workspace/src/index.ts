/**
 * Workspace entity registry (`ctx.workspaceRegistry`): durable workspace records,
 * stable registry order, and header-validated session membership over the
 * domain data form.
 * @module @aeven/workspace
 */

import type {} from '@aeven/session-handoff'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SessionHeader, SessionId } from '@aeven/session'
import type {} from '@aeven/session-persistence'
import type { DomainGlobal, KvTable } from '@aeven/storage-domain'
import { WorkspaceDefaultImmutableError, WorkspaceEntity } from './entity.ts'
import type { WorkspaceEntityHost } from './entity.ts'

export { WorkspaceDefaultImmutableError, WorkspaceMoveInvalidError } from './entity.ts'
import { defaultWorkspaceTitle, realpathNormalize } from './paths.ts'
import { kindPathAgrees, workspaceDomainSpec } from './spec.ts'
import type { WorkspaceDomainState, WorkspaceRecord } from './spec.ts'
import { WorkspaceSync, type SyncedWorkspaces, type SyncedWorkspace } from './sync.ts'
import type { FolderWorkspace, Workspace, WorkspaceId as WorkspaceIdBrand } from './types.ts'

export type { FolderWorkspace, Workspace, WorkspaceKind } from './types.ts'
export {
  INITIAL_WORKSPACE_DOMAIN_STATE,
  kindPathAgrees,
  WORKSPACE_KINDS,
  workspaceDomainSpec,
  workspaceDomainState,
  workspaceRecord,
} from './spec.ts'
export type { WorkspaceDomainState, WorkspaceRecord } from './spec.ts'
export { realpathNormalize } from './paths.ts'

/** Whether a registry without a built-in workspace seeds one (the schema default). */
export const DEFAULT_SEED_DEFAULT_WORKSPACE = true

/** Display title a newly seeded built-in workspace is given (the schema default). */
export const DEFAULT_DEFAULT_WORKSPACE_TITLE = 'Chats'

/** Plugin configuration for the registry. */
export interface Config {
  /** Whether a registry without a built-in workspace seeds one at startup (default: true). */
  seedDefaultWorkspace?: boolean
  /** Display title given to a newly seeded workspace (default: `Chats`). */
  defaultWorkspaceTitle?: string
}

/** Identifies one workspace record (see `src/types.ts` for the brand rationale). */
export type WorkspaceId = WorkspaceIdBrand

/**
 * Whether one workspace is folder-backed, narrowing {@link Workspace.path} to a
 * present string. The registry's own `create` is the only producer of folder
 * workspaces today, but consumers must not rely on that: the narrowing is how
 * a caller that genuinely needs a directory states the requirement instead of
 * asserting it.
 * @param workspace - any workspace.
 * @returns true when the workspace has a canonical directory path.
 */
export function isFolderWorkspace(workspace: Workspace): workspace is FolderWorkspace {
  return workspace.kind === 'folder' && workspace.path !== undefined
}

/**
 * Brand a string as a {@link WorkspaceId}.
 * @param id - Raw workspace id string.
 * @returns the same string, branded at compile time.
 */
export function WorkspaceId(id: string): WorkspaceId {
  return id as WorkspaceId
}

/**
 * An archiveSession request named a session neither live nor in session
 * persistence — a definite miss only; storage faults propagate as themselves.
 */
export class WorkspaceUnknownSessionError extends Error {
  /**
   * @param sessionId - The unknown session id.
   */
  constructor(readonly sessionId: SessionId) {
    super(`cannot archive session '${sessionId}': live sessions and session persistence hold no such session`)
    this.name = 'WorkspaceUnknownSessionError'
  }
}

/** A workspace reorder named a source or anchor absent from the durable registry order. */
export class WorkspaceOrderInvalidError extends Error {
  /**
   * @param workspaceId - Missing source or anchor id.
   */
  constructor(readonly workspaceId: WorkspaceId) {
    super(`cannot reorder unknown workspace '${workspaceId}'`)
    this.name = 'WorkspaceOrderInvalidError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workspaceRegistry: WorkspaceRegistry
  }
}

interface BootstrapGroup {
  readonly path: string
  readonly headers: SessionHeader[]
  readonly newestAt: number
}

const sameIds = (left: readonly WorkspaceId[], right: readonly WorkspaceId[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

const compareHeaders = (left: SessionHeader, right: SessionHeader): number =>
  right.createdAt - left.createdAt || String(left.id).localeCompare(String(right.id))

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
export class WorkspaceRegistry extends Service {
  static inject = ['storageDomain', 'sessionPersistence']

  // Inline schema call: the config catalog walks `static Config` statically.
  static Config: z<Config> = z.object({
    /**
     * Whether a registry with no built-in workspace seeds one at startup. On by
     * default: a first run must be able to accept a message without first
     * demanding a folder, and an off deployment has to opt out explicitly.
     */
    seedDefaultWorkspace: z.boolean().default(DEFAULT_SEED_DEFAULT_WORKSPACE),
    /**
     * Display title of the seeded workspace. A durable record keeps the title it
     * was seeded with; this only names one at creation time.
     */
    defaultWorkspaceTitle: z.string().default(DEFAULT_DEFAULT_WORKSPACE_TITLE),
  })

  private table?: KvTable<WorkspaceId, WorkspaceRecord>
  private global?: DomainGlobal<WorkspaceDomainState>
  private state?: WorkspaceDomainState
  private readonly entities = new Map<WorkspaceId, WorkspaceEntity>()
  private readonly headers = new Map<SessionId, SessionHeader>()
  /** Imported sessions whose shared workspace has not reached this device yet, by shared workspace name. */
  private readonly unfiled = new Map<SessionId, string>()
  /** Observers of sessions filed after their workspace arrived from another device. */
  private readonly lateFiling = new Set<() => void>()
  /** Accounts whose ownerless workspaces this process already claimed. */
  private readonly claimed = new Set<string>()
  private readonly sessionPaths = new Map<SessionId, string>()
  private readonly invalidSessionPaths = new Map<SessionId, string>()
  private operationTail: Promise<void> = Promise.resolve()
  private readonly synced: WorkspaceSync

  private readonly host: WorkspaceEntityHost = {
    table: () => this.requireTable(),
    sessionPath: id => this.sessionPaths.get(id),
    sessionOwner: id => this.headers.get(id)?.owner,
    replicated: (id) => {
      const header = this.headers.get(id)
      return header?.replica === true || (header?.owner !== undefined
        && this.ctx.get('sessionHandoff')?.shared(header.owner, id) === true)
    },
    titleChanged: () => { this.publish() },
    readSessionHeader: id => this.readSessionHeader(id),
    rememberSessionPath: (id, path) => {
      this.sessionPaths.set(id, path)
      this.invalidSessionPaths.delete(id)
    },
    isDefault: id => this.requireState().defaultWorkspaceId === id,
    isBuiltIn: id => this.isBuiltInId(this.requireState(), id),
  }

  /**
   * @param ctx - Host context the registry publishes itself on.
   * @param config - Seeding configuration. Optional so a direct
   *   `ctx.plugin(WorkspaceRegistry)` mount stays valid; the defaults are stated
   *   once as {@link DEFAULT_SEED_DEFAULT_WORKSPACE} and
   *   {@link DEFAULT_DEFAULT_WORKSPACE_TITLE} and resolved at each use, so they
   *   hold whether or not a loader applied `WorkspaceRegistry.Config`.
   */
  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'workspaceRegistry')
    // Every birth re-derives membership, so no creation path can strand a
    // Session outside the Workspace its own cwd names.
    ctx.on('session/created', (session) => { void this.adoptByCwd(session.header) })
    this.synced = new WorkspaceSync(
      ctx,
      (owner, projection) => { void this.applySynced(owner, projection) },
      (message) => { ctx.logger('workspace').warn(message) },
    )
    // The account's workspaces follow it to every device its sync vault holds, once that vault is served here.
    ctx.on('sync/status', (owner) => {
      void this.synced.attach(owner).then(async (handle) => {
        if (handle === undefined || this.claimed.has(owner)) return
        this.claimed.add(owner)
        await this.claimOwnerless(owner)
      }).catch((error: unknown) => {
        ctx.logger('workspace').warn(`workspace: claiming workspaces for the account failed: ${String(error)}`)
      })
    })
    ctx.effect(() => () => this.synced.dispose(), 'workspace.sync')
  }

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
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(workspaceDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'workspace.domainClose')
    this.table = domain.table('workspaces')
    this.global = domain.global
    this.state = domain.global.get()

    await this.recoverPendingMutation()
    this.validateStoredState(this.state)
    if (!this.state.initialized) {
      const headers = await this.ctx.sessionPersistence.list()
      await this.replaceHeaderIndex(headers)
      await this.bootstrap(headers)
    } else if (this.table.size > 0) {
      await this.replaceHeaderIndex(await this.ctx.sessionPersistence.list())
    }

    await this.indexLiveSessions()
    this.validateStoredState(this.requireState())
    await this.ensureDefaultWorkspace()
    await this.pinDefaultWorkspaceHead()
    this.validateStoredState(this.requireState())
    this.rebuildEntities()
    await this.reconcileMembership()
    this.reportFilteredCandidates()
  }

  /**
   * Restore the built-in workspace to the head of the durable order.
   *
   * A registration created before the head was held was prepended above it, so
   * an order read back from storage can hold the head lower than the product
   * puts it. The repair is one write, made only when the order disagrees and
   * before any consumer reads the order, so a stored arrangement converges on
   * the pinned one at the next mount instead of waiting for a drag.
   */
  private async pinDefaultWorkspaceHead(): Promise<void> {
    const state = this.requireState()
    const workspaceIds = this.pinnedHead(state, state.workspaceIds)
    if (workspaceIds === state.workspaceIds) return
    await this.setState(this.carryState(state, { initialized: state.initialized, workspaceIds }))
  }

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
  async create(path: string, title?: string, owner?: string): Promise<Workspace> {
    const canonical = await realpathNormalize(path)
    if (!(await stat(canonical)).isDirectory()) {
      throw new Error(`cannot create a workspace at '${canonical}': path is not a directory`)
    }
    return await this.enqueueOperation(() => this.createCanonical(canonical, title, owner))
  }

  /**
   * Look up a workspace by id.
   * @param id - Workspace id.
   * @returns the workspace, or `undefined` when unknown.
   */
  get(id: WorkspaceId): Workspace | undefined {
    return this.entities.get(id)
  }

  /**
   * Synchronous workspace projection in durable registry order. Every
   * entity's `sessionIds` getter is already filtered by the startup/live
   * canonical-cwd header index; this method performs no persistence reads.
   * @returns a fresh ordered array of workspace entities.
   */
  list(): Workspace[] {
    return this.requireState().workspaceIds.map((id) => {
      const entity = this.entities.get(id)
      if (entity === undefined) {
        throw new Error(`workspace registry order references missing workspace '${id}'`)
      }
      return entity
    })
  }

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
  delete(id: WorkspaceId): Promise<boolean> {
    return this.enqueueOperation(async () => {
      if (this.isBuiltInId(this.requireState(), id)) {
        throw new WorkspaceDefaultImmutableError(id, 'delete')
      }
      const record = this.requireTable().get(id)
      const deleted = await this.deleteKnown(id)
      // The removal reaches the account's other devices only as this explicit tombstone.
      if (deleted && record?.owner !== undefined) {
        void this.synced.forget(record.owner, id, record.title).catch((error: unknown) => {
          this.ctx.logger('workspace').warn(`workspace: publishing a removal to the account's other devices failed: ${String(error)}`)
        })
      }
      return deleted
    })
  }

  /**
   * Name the workspace a session belongs to in the terms every device of the account shares: `default` for the
   * built-in default workspace, `builtin:<key>` for a plugin-declared one, and the workspace id otherwise.
   * @param sessionId - the session.
   * @returns the shared name, or undefined when no workspace holds the session.
   */
  sessionHome(sessionId: SessionId): string | undefined {
    const home = this.list().find(workspace => workspace.sessionIds.includes(sessionId))
    return home === undefined ? undefined : this.sharedName(home.id)
  }

  /**
   * Name the workspace of every filed session at once, as {@link sessionHome} names each, in one pass over the
   * registry; a caller that asks about many sessions uses this instead of one {@link sessionHome} call per session.
   * @returns each filed session's shared workspace name.
   */
  sessionHomes(): ReadonlyMap<SessionId, string> {
    const homes = new Map<SessionId, string>()
    for (const workspace of this.list()) {
      const home = this.sharedName(workspace.id)
      for (const sessionId of workspace.sessionIds) if (!homes.has(sessionId)) homes.set(sessionId, home)
    }
    return homes
  }

  private sharedName(id: WorkspaceId): string {
    const state = this.requireState()
    if (state.defaultWorkspaceId === id) return 'default'
    const key = Object.entries(state.builtInWorkspaceIds ?? {}).find(([, builtIn]) => builtIn === id)?.[0]
    return key === undefined ? id : `builtin:${key}`
  }

  /**
   * File a session another device published into the workspace its {@link sessionHome} names, when this device
   * holds that workspace and the session is not filed yet.
   * @param sessionId - the session, already stored on this device.
   * @param home - the shared workspace name.
   * @param header - received metadata when the body has not been downloaded yet.
   * @returns whether the session is now filed there.
   */
  async fileSession(sessionId: SessionId, home: string, header?: SessionHeader): Promise<boolean> {
    if (header !== undefined) {
      if (header.id !== sessionId) throw new Error('shared session metadata names another session')
      this.headers.set(sessionId, header)
    }
    const state = this.requireState()
    const id = home === 'default'
      ? state.defaultWorkspaceId
      : home.startsWith('builtin:') ? state.builtInWorkspaceIds?.[home.slice('builtin:'.length)] : WorkspaceId(home)
    const target = id === undefined ? undefined : this.entities.get(id)
    if (target === undefined) {
      this.unfiled.set(sessionId, home)
      return false
    }
    this.unfiled.delete(sessionId)
    if (this.list().some(workspace => workspace.sessionIds.includes(sessionId))) return true
    await target.attachSession(sessionId)
    return true
  }

  /**
   * Observe sessions that {@link fileSession} could not file earlier joining their workspace once it arrived from
   * another device.
   * @param listener - called after one or more such sessions were filed.
   * @returns the disposer.
   */
  onLateFiling(listener: () => void): () => void {
    this.lateFiling.add(listener)
    return () => { this.lateFiling.delete(listener) }
  }

  /**
   * Give a workspace that another device of the account registered a directory on this device. The directory
   * stays here; the account's other devices keep their own.
   * @param id - a workspace without a directory on this device.
   * @param path - existing directory, in a fully qualified spelling.
   * @returns the workspace, now folder-backed.
   */
  async bind(id: WorkspaceId, path: string): Promise<Workspace> {
    const canonical = await realpathNormalize(path)
    if (!(await stat(canonical)).isDirectory()) {
      throw new Error(`cannot bind a workspace to '${canonical}': path is not a directory`)
    }
    return await this.enqueueOperation(async () => {
      const entity = this.entities.get(id)
      if (entity === undefined) throw new Error(`no workspace '${id}'`)
      const taken = this.list().find(other => other.id !== id && other.path === canonical && other.owner === entity.owner)
      if (taken !== undefined) throw new Error(`'${canonical}' is already the directory of workspace '${taken.title}'`)
      await entity.bindDirectory(canonical)
      return entity
    })
  }

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
  insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]> {
    return this.enqueueOperation(async () => {
      const state = this.requireState()
      // A built-in workspace does not move at all — not by an anchor, not by
      // an append: its position is where the product puts it, so the registry
      // refuses the move instead of computing one and undoing it afterwards.
      if (this.isBuiltInId(state, id)) {
        throw new WorkspaceDefaultImmutableError(id, 'move')
      }
      if (!state.workspaceIds.includes(id)) throw new WorkspaceOrderInvalidError(id)
      if (beforeId !== undefined && !state.workspaceIds.includes(beforeId)) {
        throw new WorkspaceOrderInvalidError(beforeId)
      }
      if (beforeId === id) return state.workspaceIds
      const without = state.workspaceIds.filter(workspaceId => workspaceId !== id)
      const at = beforeId === undefined ? without.length : without.indexOf(beforeId)
      const workspaceIds = this.pinnedHead(state, [...without.slice(0, at), id, ...without.slice(at)])
      if (sameIds(workspaceIds, state.workspaceIds)) return state.workspaceIds
      await this.setState({ ...state, workspaceIds: [...workspaceIds] })
      return workspaceIds
    })
  }

  /**
   * The registry-global archive set: sessions hidden from every grouping
   * surface. Archiving never touches workspace accounting — an archived
   * session keeps its `sessionIds` slot so unarchiving restores its position.
   * @returns the archived session ids in archive order.
   */
  get archivedSessionIds(): readonly SessionId[] {
    return this.requireState().archivedSessionIds
  }

  /**
   * Archive one session durably. The session must exist (live or in session
   * persistence); its workspace accounting — or lack of one — is irrelevant.
   * An already archived id resolves without writing.
   * @param sessionId - The session to archive.
   * @returns resolution after durability.
   */
  archiveSession(sessionId: SessionId): Promise<void> {
    return this.enqueueOperation(async () => {
      // The chain slot serializes against every other registry write, so this
      // check-then-write pair cannot interleave with another archive.
      if (this.requireState().archivedSessionIds.includes(sessionId)) return
      if (!(await this.sessionKnown(sessionId))) {
        throw new WorkspaceUnknownSessionError(sessionId)
      }
      const state = this.requireState()
      await this.setState({ ...state, archivedSessionIds: [...state.archivedSessionIds, sessionId] })
    })
  }

  /**
   * Unarchive one session durably by dropping it from the registry-global
   * archive set; the accounting slot was never touched, so the session
   * returns to its recorded position. Removing an id cannot introduce an
   * unknown one, so no session-existence check runs. An id that is not
   * archived resolves without writing.
   * @param sessionId - The session to unarchive.
   * @returns resolution after durability.
   */
  unarchiveSession(sessionId: SessionId): Promise<void> {
    return this.enqueueOperation(async () => {
      const state = this.requireState()
      if (!state.archivedSessionIds.includes(sessionId)) return
      await this.setState({ ...state, archivedSessionIds: state.archivedSessionIds.filter(id => id !== sessionId) })
    })
  }

  /**
   * Drop every registry fact about a deleted session: its workspace
   * accounting, its archive entry, and its indexed header. The caller has
   * already removed the session from live state and persistence, so nothing
   * re-adopts it.
   * @param sessionId - The deleted session.
   * @returns resolution after durability.
   */
  forgetSession(sessionId: SessionId): Promise<void> {
    return this.enqueueOperation(async () => {
      this.headers.delete(sessionId)
      this.unfiled.delete(sessionId)
      this.sessionPaths.delete(sessionId)
      this.invalidSessionPaths.delete(sessionId)
      // `sessionIds` is the path-filtered projection, so it no longer lists the
      // dropped id; detach reads the stored record and writes only on a change.
      for (const entity of this.entities.values()) await entity.detachSession(sessionId)
      const state = this.requireState()
      if (state.archivedSessionIds.includes(sessionId)) {
        await this.setState({ ...state, archivedSessionIds: state.archivedSessionIds.filter(id => id !== sessionId) })
      }
    })
  }

  /**
   * Publish each account's workspaces to its synced document after a committed mutation.
   *
   * A directory path, session accounting, and the archive set stay on this device; what travels is the
   * workspace's identity, title, and timestamps together with the account's display order.
   */
  private publish(): void {
    if (this.ctx.get('sync') === undefined) return
    const state = this.requireState()
    const accounts = new Map<string, { records: ({ readonly id: WorkspaceId } & SyncedWorkspace)[]; order: WorkspaceId[] }>()
    // An account whose last workspace was just deleted still has to publish that removal.
    for (const owner of this.synced.owners()) accounts.set(owner, { records: [], order: [] })
    for (const id of state.workspaceIds) {
      const record = this.requireTable().get(id)
      // A built-in registration is declared by the composition on every device, so it is not the account's.
      if (record?.owner === undefined || this.isBuiltInId(state, id)) continue
      const group = accounts.get(record.owner) ?? { records: [], order: [] }
      group.records.push({
        id, title: record.title, owner: record.owner, createdAt: record.createdAt, updatedAt: record.titleChangedAt ?? record.createdAt,
      })
      group.order.push(id)
      accounts.set(record.owner, group)
    }
    for (const [owner, projection] of accounts) {
      void this.synced.publish(owner, projection).catch((error: unknown) => {
        this.ctx.logger('workspace').warn(`workspace: publishing to the account's other devices failed: ${String(error)}`)
      })
    }
  }

  /**
   * Give the account each workspace that has no owner and holds sessions of that account and of no other, then
   * publish. Workspaces registered before workspaces carried an owner would otherwise never reach the account's
   * other devices, and their sessions would arrive there without a workspace.
   * @param owner - the account this device now syncs.
   * @returns when the claimed workspaces are stored and published.
   */
  private async claimOwnerless(owner: string): Promise<void> {
    await this.enqueueOperation(async () => {
      const state = this.requireState()
      const table = this.requireTable()
      let changed = false
      for (const id of state.workspaceIds) {
        const record = table.get(id)
        if (record === undefined || record.owner !== undefined || this.isBuiltInId(state, id)) continue
        const owners = new Set(record.sessionIds.flatMap(sessionId => this.headers.get(sessionId)?.owner ?? []))
        if (owners.size !== 1 || !owners.has(owner)) continue
        await table.put(id, { ...record, owner, updatedAt: new Date().toISOString() })
        changed = true
      }
      if (changed) this.rebuildEntities()
    })
  }

  /**
   * Store another device's workspaces of one account.
   *
   * A workspace this device opened a directory for keeps its path and kind, and one it only received is `remote`,
   * which is the kind a workspace without a directory here has always had. A later title wins, and a removal drops
   * this device's record without touching a directory or a session log.
   * @param owner - the account the workspaces belong to.
   * @param projection - its workspaces and their order as another device published them.
   */
  private async applySynced(owner: string, projection: SyncedWorkspaces): Promise<void> {
    try {
      await this.enqueueOperation(async () => {
        const table = this.requireTable()
        const remote = new Map(projection.records.map(record => [record.id, record]))
        // A removal takes the same path as one made here, so the workspace's sessions join the archive set.
        for (const id of this.requireState().workspaceIds) {
          const record = table.get(id)
          // A built-in registration and a workspace of another account are not this account's to remove here.
          const foreign = this.isBuiltInId(this.requireState(), id) || record?.owner !== owner
          if (!foreign && remote.get(id)?.removed === true) await this.deleteKnown(id)
        }
        const state = this.requireState()
        const kept: WorkspaceId[] = []
        for (const id of state.workspaceIds) {
          const record = table.get(id)
          if (record === undefined) continue
          const entry = remote.get(id)
          if (entry === undefined || entry.removed === true) {
            // The account's document says nothing about it yet, or it is another account's; this device keeps it.
            kept.push(id)
            continue
          }
          const titled = record.titleChangedAt ?? record.createdAt
          if (entry.title !== undefined && entry.updatedAt !== undefined && entry.updatedAt > titled && entry.title !== record.title) {
            await table.put(id, { ...record, title: entry.title, titleChangedAt: entry.updatedAt, updatedAt: new Date().toISOString() })
          }
          kept.push(id)
        }
        const known = new Set(kept)
        for (const entry of projection.records) {
          if (entry.removed === true || known.has(entry.id) || entry.title === undefined) continue
          const at = entry.updatedAt ?? new Date().toISOString()
          await table.put(entry.id, {
            kind: 'remote',
            title: entry.title,
            ...entry.owner === undefined ? {} : { owner: entry.owner },
            sessionIds: [],
            createdAt: entry.createdAt ?? at,
            updatedAt: at,
            ...entry.updatedAt === undefined ? {} : { titleChangedAt: entry.updatedAt },
          })
          kept.push(entry.id)
        }
        const rank = new Map(projection.order.map((id, index) => [id, index]))
        const account = kept.filter(id => rank.has(id)).sort((left, right) => (rank.get(left) ?? 0) - (rank.get(right) ?? 0))
        const workspaceIds = [...this.pinnedHead(state, [...account, ...kept.filter(id => !rank.has(id))])]
        // Observers of the state write look the new workspaces up, so their entities exist before it commits.
        this.rebuildEntities(workspaceIds)
        try {
          if (!sameIds(workspaceIds, state.workspaceIds)) await this.setState({ ...state, workspaceIds })
        } finally {
          this.rebuildEntities()
        }
        this.validateStoredState(this.requireState())
      }, false)
      // Sessions imported before their workspace arrived join it now.
      let filed = false
      for (const [sessionId, home] of [...this.unfiled]) {
        filed = await this.fileSession(sessionId, home).catch((error: unknown) => {
          this.ctx.logger('workspace').warn(`workspace: filing session '${sessionId}' into '${home}' failed: ${String(error)}`)
          return false
        }) || filed
      }
      if (filed) for (const listener of this.lateFiling) listener()
    } catch (error: unknown) {
      this.ctx.logger('workspace').warn(`workspace: another device's workspaces were not stored: ${String(error)}`)
    }
  }

  /**
   * Whether a session is live, header-indexed, or present in a fresh
   * persistence listing. Only a definite miss returns false — a failing
   * `sessionPersistence.list()` propagates so storage faults never
   * masquerade as an unknown session.
   */
  private async sessionKnown(id: SessionId): Promise<boolean> {
    if (this.ctx.get('sessions')?.get(id) !== undefined) return true
    if (this.headers.has(id)) return true
    await this.indexHeaders(await this.ctx.sessionPersistence.list())
    return this.headers.has(id)
  }

  /**
   * Resolve by canonical directory path without creating or mutating a
   * workspace. A missing path rejects during `realpath`; an existing unowned
   * directory returns `undefined`.
   * @param path - Existing directory path in a fully qualified spelling.
   * @param owner - Account whose workspace to find; absent finds the one no account owns.
   * @returns that account's workspace for the canonical path, when one exists.
   */
  async resolveByPath(path: string, owner?: string): Promise<Workspace | undefined> {
    const canonical = await realpathNormalize(path)
    for (const entity of this.entities.values()) {
      if (entity.path === canonical && entity.owner === owner) return entity
    }
    return undefined
  }

  /**
   * Owner recorded in an indexed session header.
   * @param sessionId - the session to read.
   * @returns the account id, or `undefined` when the session records none or is not indexed.
   */
  sessionOwner(sessionId: SessionId): string | undefined {
    return this.headers.get(sessionId)?.owner
  }

  private async createCanonical(canonical: string, title?: string, owner?: string): Promise<WorkspaceEntity> {
    for (const entity of this.entities.values()) {
      if (entity.path === canonical && entity.owner === owner) return entity
    }

    const workspaceName = title ?? defaultWorkspaceTitle(canonical)
    const table = this.requireTable()
    const state = this.requireState()
    const id = WorkspaceId(randomUUID())
    const now = new Date().toISOString()
    const record: WorkspaceRecord = {
      kind: 'folder',
      path: canonical,
      title: workspaceName,
      ...owner === undefined ? {} : { owner },
      sessionIds: [],
      createdAt: now,
      updatedAt: now,
    }
    const entity = new WorkspaceEntity(this.host, id, record)
    this.entities.set(id, entity)
    await this.writePendingCreate(id, state, record, `workspace '${id}' record write and pending-marker rollback both failed`)

    try {
      await this.setState(this.carryState(state, {
        initialized: true,
        workspaceIds: this.withNewWorkspace(state, id),
      }))
    } catch (error) {
      this.entities.delete(id)
      try {
        await table.delete(id)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' order write and record rollback both failed; the pending marker remains recoverable`,
        )
      }
      try {
        await this.setState(state)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' order write and pending-marker rollback both failed`,
        )
      }
      throw error
    }
    return entity
  }

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
  builtIn(key: string, title: string): Promise<Workspace> {
    return this.enqueueOperation(async () => {
      const existing = this.requireState().builtInWorkspaceIds?.[key]
      const entity = existing === undefined ? undefined : this.entities.get(existing)
      if (entity !== undefined) {
        if (entity.title !== title) await entity.adoptDeclaredTitle(title)
        return entity
      }
      return await this.createVirtualCanonical(title, (state, id) => ({
        ...this.carryState(state, { initialized: true, workspaceIds: this.withNewWorkspace(state, id) }),
        builtInWorkspaceIds: { ...state.builtInWorkspaceIds, [key]: id },
      }))
    })
  }

  /**
   * Create one workspace that has no directory, using the same three-write
   * choreography as {@link createCanonical} — pending marker, record, then
   * order — so an interrupted seeding is recovered exactly like any other
   * create.
   * @param title - display title for the new registration.
   * @param place - the committed state that orders and marks the new registration.
   * @returns the newly durable pathless entity, already cached.
   */
  private async createVirtualCanonical(
    title: string,
    place: (state: WorkspaceDomainState, id: WorkspaceId) => WorkspaceDomainState,
  ): Promise<WorkspaceEntity> {
    const table = this.requireTable()
    const state = this.requireState()
    const id = WorkspaceId(randomUUID())
    const now = new Date().toISOString()
    // No `path` key at all, not an explicit `undefined`: the record schema is
    // the shape that reaches durable storage, and `kind`/`path` agreement is
    // exactly what the domain refuses to violate.
    const record: WorkspaceRecord = {
      kind: 'virtual',
      title,
      sessionIds: [],
      createdAt: now,
      updatedAt: now,
    }
    const entity = new WorkspaceEntity(this.host, id, record)
    this.entities.set(id, entity)
    const pendingState: WorkspaceDomainState = {
      ...state,
      pendingMutation: { operation: 'create', workspaceId: id },
    }
    await this.writePendingCreate(
      id,
      state,
      record,
      `built-in workspace '${id}' record write and pending-marker rollback both failed`,
      pendingState,
    )

    try {
      await this.setState(place(state, id))
    } catch (error) {
      this.entities.delete(id)
      try {
        await table.delete(id)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `built-in workspace '${id}' order write and record rollback both failed; the pending marker remains recoverable`,
        )
      }
      try {
        await this.setState(state)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `built-in workspace '${id}' order write and pending-marker rollback both failed`,
        )
      }
      throw error
    }
    return entity
  }

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
  private async ensureDefaultWorkspace(): Promise<void> {
    if (!(this.config.seedDefaultWorkspace ?? DEFAULT_SEED_DEFAULT_WORKSPACE)) return
    const state = this.requireState()
    if (state.defaultWorkspaceId !== undefined) return
    const table = this.requireTable()
    const adoptable = state.workspaceIds.find((id) => {
      const record = table.get(id)
      return record !== undefined && record.kind !== 'folder' && !this.isBuiltInId(state, id)
    })
    if (adoptable !== undefined) {
      await this.setState({ ...state, defaultWorkspaceId: adoptable })
      return
    }
    await this.createVirtualCanonical(this.config.defaultWorkspaceTitle ?? DEFAULT_DEFAULT_WORKSPACE_TITLE, (current, id) => ({
      ...this.carryState(current, { initialized: true, workspaceIds: [id, ...current.workspaceIds] }),
      defaultWorkspaceId: id,
    }))
  }

  /**
   * The id of the built-in workspace, when this registry has one.
   * @returns the durable default workspace id, or `undefined`.
   */
  get defaultWorkspaceId(): WorkspaceId | undefined {
    return this.requireState().defaultWorkspaceId
  }

  private async deleteKnown(id: WorkspaceId): Promise<boolean> {
    const entity = this.entities.get(id)
    if (entity === undefined) return false
    const state = this.requireState()
    const archived = new Set(state.archivedSessionIds)
    const nextState = {
      ...this.carryState(state, {
        initialized: true,
        workspaceIds: state.workspaceIds.filter(workspaceId => workspaceId !== id),
      }),
      archivedSessionIds: [
        ...state.archivedSessionIds,
        ...entity.sessionIds.filter(sessionId => !archived.has(sessionId)),
      ],
    }
    await this.setState({
      ...nextState,
      pendingMutation: { operation: 'delete', workspaceId: id },
    })
    this.entities.delete(id)
    try {
      await this.requireTable().delete(id)
    } catch (error) {
      this.entities.set(id, entity)
      try {
        await this.setState(state)
      } catch (rollbackError) {
        // The durable marker still says to finish deletion, so the cache must
        // agree with that recoverable direction rather than republish a row
        // absent from the persisted order.
        this.entities.delete(id)
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' record deletion and registry-order rollback both failed`,
        )
      }
      throw error
    }
    try {
      await this.setState(nextState)
    } catch (error) {
      // The deletion committed at the table write and was already published
      // to Host streams. Keep the durable marker for startup recovery rather
      // than reporting failure after the requested state became true.
      this.ctx.logger.warn(
        `workspace '${id}' was deleted but its pending marker could not be cleared: ${String(error)}`,
      )
    }
    return true
  }

  /**
   * Complete the one mutation explicitly named by durable state. Unexplained
   * order/table divergence still reaches {@link validateStoredState} and
   * fails loud; this path never guesses which operation created a row from its shape alone.
   */
  private async recoverPendingMutation(): Promise<void> {
    const state = this.requireState()
    const pending = state.pendingMutation
    if (pending === undefined) return
    if (state.workspaceIds.includes(pending.workspaceId)) {
      throw new Error(
        `workspace domain is inconsistent: pending ${pending.operation} workspace `
        + `'${pending.workspaceId}' is still present in registry order`,
      )
    }
    await this.requireTable().delete(pending.workspaceId)
    await this.setState(this.carryState(state, {
      initialized: state.initialized,
      workspaceIds: state.workspaceIds,
    }))
  }

  private async bootstrap(headers: readonly SessionHeader[]): Promise<void> {
    const table = this.requireTable()
    const state = this.requireState()
    const groupsByPath = new Map<string, SessionHeader[]>()
    for (const header of headers) {
      const path = this.sessionPaths.get(header.id)
      if (path === undefined) continue
      const group = groupsByPath.get(path)
      if (group === undefined) groupsByPath.set(path, [header])
      else group.push(header)
    }
    const groups: BootstrapGroup[] = [...groupsByPath].map(([path, groupHeaders]) => {
      groupHeaders.sort(compareHeaders)
      const newest = groupHeaders[0] as SessionHeader
      return { path, headers: groupHeaders, newestAt: newest.createdAt }
    }).sort((left, right) =>
      right.newestAt - left.newestAt || left.path.localeCompare(right.path))

    const byPath = new Map<string, WorkspaceId>()
    const accounted = new Map<SessionId, WorkspaceId>()
    for (const [id, record] of table.entries()) {
      // A pathless record owns no directory, so it can never be the group a
      // header-derived path resolves to; its account stays intact below.
      if (record.path !== undefined) byPath.set(record.path, id)
      for (const sessionId of record.sessionIds) accounted.set(sessionId, id)
    }

    for (const group of groups) {
      let id = byPath.get(group.path)
      if (id === undefined) {
        const sessionIds = group.headers
          .map(header => header.id)
          .filter(sessionId => !accounted.has(sessionId))
        if (sessionIds.length === 0) continue
        id = WorkspaceId(randomUUID())
        const createdAt = new Date(group.newestAt).toISOString()
        const record: WorkspaceRecord = {
          kind: 'folder',
          path: group.path,
          title: defaultWorkspaceTitle(group.path),
          sessionIds,
          createdAt,
          updatedAt: createdAt,
        }
        await table.put(id, record)
        byPath.set(group.path, id)
        for (const sessionId of sessionIds) accounted.set(sessionId, id)
        continue
      }

      const current = table.get(id) as WorkspaceRecord
      const historical = group.headers
        .map(header => header.id)
        .filter(sessionId => accounted.get(sessionId) === undefined || accounted.get(sessionId) === id)
      const historicalSet = new Set(historical)
      const sessionIds = [
        ...historical,
        ...current.sessionIds.filter(sessionId => !historicalSet.has(sessionId)),
      ]
      if (sameSessionIds(current.sessionIds, sessionIds)) continue
      await table.update(id, record => ({
        ...record,
        sessionIds,
        updatedAt: new Date().toISOString(),
      }))
      for (const sessionId of historical) accounted.set(sessionId, id)
    }

    const groupRank = new Map(groups.map(group => [group.path, group.newestAt]))
    const priorRank = new Map(state.workspaceIds.map((id, index) => [id, index]))
    // Time rank, falling back to the record's own creation instant. A pathless
    // record has no header group to rank by, so its `createdAt` is the answer.
    // Ranking orders the registrations; it never decides the head (pinnedHead).
    const rankOf = (record: WorkspaceRecord): number => (
      record.path === undefined ? Date.parse(record.createdAt) : groupRank.get(record.path) ?? Date.parse(record.createdAt)
    )
    const workspaceIds = this.pinnedHead(state, [...table.entries()]
      .sort(([leftId, left], [rightId, right]) => {
        const leftTime = rankOf(left)
        const rightTime = rankOf(right)
        return rightTime - leftTime
          || (priorRank.get(leftId) ?? Number.MAX_SAFE_INTEGER)
            - (priorRank.get(rightId) ?? Number.MAX_SAFE_INTEGER)
          || String(leftId).localeCompare(String(rightId))
      })
      .map(([id]) => id))

    if (!sameIds(state.workspaceIds, workspaceIds)) {
      await this.setState(this.carryState(state, { initialized: false, workspaceIds }))
    }
    await this.setState(this.carryState(state, { initialized: true, workspaceIds }))
  }

  private validateStoredState(state: WorkspaceDomainState): void {
    const table = this.requireTable()
    const order = new Set<WorkspaceId>()
    for (const id of state.workspaceIds) {
      if (order.has(id)) {
        throw new Error(`workspace domain is inconsistent: registry order repeats workspace '${id}'`)
      }
      if (table.get(id) === undefined) {
        throw new Error(`workspace domain is inconsistent: registry order references missing workspace '${id}'`)
      }
      order.add(id)
    }
    if (state.initialized && order.size !== table.size) {
      const orphan = [...table.keys()].find(id => !order.has(id))
      throw new Error(
        `workspace domain is inconsistent: workspace '${orphan as WorkspaceId}' is absent from registry order`,
      )
    }
    // The built-in marker names a registration that must exist. A marker left
    // pointing at a vanished record is exactly the state seeding exists to
    // repair, so it is checked here and repaired in `ensureDefaultWorkspace`
    // rather than tolerated as an ordinary absence.
    if (state.defaultWorkspaceId !== undefined && !order.has(state.defaultWorkspaceId)) {
      throw new Error(
        `workspace domain is inconsistent: default workspace '${state.defaultWorkspaceId}' `
        + 'is absent from registry order',
      )
    }
    for (const [key, id] of Object.entries(state.builtInWorkspaceIds ?? {})) {
      if (!order.has(id)) {
        throw new Error(`workspace domain is inconsistent: built-in workspace '${key}' (${id}) is absent from registry order`)
      }
    }

    const paths = new Map<string, WorkspaceId>()
    const accounted = new Map<SessionId, WorkspaceId>()
    for (const [id, record] of table.entries()) {
      if (!kindPathAgrees(record.kind, record.path)) {
        throw new Error(
          `workspace domain is inconsistent: workspace '${id}' is kind '${record.kind}' `
          + (record.path === undefined
            ? 'but records no path'
            : `but records path '${record.path}'`),
        )
      }
      // Only a folder workspace claims a directory, so only it can collide on
      // one. Pathless records are deliberately excluded: keying the uniqueness
      // map on `undefined` would report two virtual workspaces as sharing a
      // path neither of them has.
      if (record.path !== undefined) {
        const pathHolder = paths.get(record.path)
        if (pathHolder !== undefined) {
          throw new Error(
            `workspace domain is inconsistent: path '${record.path}' is claimed `
            + `by both workspace '${pathHolder}' and workspace '${id}'`,
          )
        }
        paths.set(record.path, id)
      }
      for (const sessionId of record.sessionIds) {
        const holder = accounted.get(sessionId)
        if (holder !== undefined) {
          throw new Error(
            `workspace domain is inconsistent: session '${sessionId}' is accounted `
            + `by both workspace '${holder}' and workspace '${id}'`,
          )
        }
        accounted.set(sessionId, id)
      }
    }
  }

  private rebuildEntities(workspaceIds: readonly WorkspaceId[] = this.requireState().workspaceIds): void {
    this.entities.clear()
    for (const id of workspaceIds) {
      const record = this.requireTable().get(id) as WorkspaceRecord
      this.entities.set(id, new WorkspaceEntity(this.host, id, record))
    }
  }

  private async replaceHeaderIndex(headers: readonly SessionHeader[]): Promise<void> {
    this.headers.clear()
    this.sessionPaths.clear()
    this.invalidSessionPaths.clear()
    await this.indexHeaders(headers)
  }

  private async indexHeaders(headers: readonly SessionHeader[]): Promise<void> {
    for (const header of headers) await this.indexHeader(header)
  }

  private async indexHeader(header: SessionHeader): Promise<void> {
    this.headers.set(header.id, header)
    this.sessionPaths.delete(header.id)
    if (header.cwd === undefined) {
      this.invalidSessionPaths.set(header.id, 'header has no cwd')
      return
    }
    try {
      const path = await realpathNormalize(header.cwd)
      if (!(await stat(path)).isDirectory()) {
        this.invalidSessionPaths.set(header.id, `cwd '${header.cwd}' is not a directory`)
        return
      }
      this.sessionPaths.set(header.id, path)
      this.invalidSessionPaths.delete(header.id)
    } catch {
      this.invalidSessionPaths.set(header.id, `cwd '${header.cwd}' does not resolve`)
    }
  }

  private async indexLiveSessions(): Promise<void> {
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) return
    await this.indexHeaders(sessions.list().map(session => session.header))
  }

  /**
   * Re-assert membership the durable record may have lost while another Host
   * held the shared storage root: ordinary Sessions with a matching folder
   * are attached again, and unassigned pathless Sessions enter Chats. An already-accounted
   * Session costs one set lookup and no write, so a healthy start performs no
   * storage write at all. A registration the user deleted stays deleted: only
   * Workspaces that still exist admit.
   */
  private async reconcileMembership(): Promise<void> {
    const byPath = new Map<string, Workspace>()
    const accounted = new Set<SessionId>()
    for (const workspace of this.list()) {
      if (isFolderWorkspace(workspace)) byPath.set(workspace.path, workspace)
      for (const sessionId of workspace.sessionIds) accounted.add(sessionId)
    }
    const defaultWorkspace = this.defaultWorkspaceId === undefined ? undefined : this.get(this.defaultWorkspaceId)
    const pending: Array<{ sessionId: SessionId; workspace: Workspace; header: SessionHeader }> = []
    for (const [sessionId, header] of this.headers) {
      if (header.origin === 'subagent' || accounted.has(sessionId)) continue
      const path = this.sessionPaths.get(sessionId)
      const workspace = header.cwd === undefined ? defaultWorkspace : path === undefined ? undefined : byPath.get(path)
      if (workspace === undefined || workspace.owner !== header.owner) continue
      pending.push({ sessionId, workspace, header })
    }
    // Attach prepends, so adopting oldest-first leaves the newest Session on top.
    pending.sort((left, right) => compareHeaders(right.header, left.header))
    for (const { sessionId, workspace } of pending) {
      try {
        await workspace.attachSession(sessionId)
      } catch (error) {
        this.ctx.logger.warn(
          `workspace '${workspace.id}' could not re-admit session '${sessionId}': ${String(error)}`,
        )
      }
    }
  }

  /**
   * Attach one just-announced Session to the Workspace that owns its canonical
   * cwd, if any. The product offers no way to leave such a Session
   * deliberately ungrouped, so a cwd match means the Session belongs in that
   * group and the record is simply missing the fact.
   * @param header - header of the Session that was just entered and announced.
   */
  private async adoptByCwd(header: SessionHeader): Promise<void> {
    try {
      // A Session may be announced before this registry finished starting; its
      // own startup pass adopts it from the header index in that case.
      // A Session reaches a store through `enter()`, which publishes only after
      // its mount settles, and this registry's startup assigns `state` before
      // its first await; so by the time any announcement reaches this listener
      // the state is always there. The guard stays as the belt to that braces:
      // adopting off a half-built registry would read an empty `entities` and
      // write nothing anyway.
      /* v8 ignore next */
      if (this.state === undefined) return
      await this.indexHeader(header)
      const path = this.sessionPaths.get(header.id)
      if (path === undefined) return
      // Adoption is a folder-workspace mechanism only: it exists to recover a
      // membership the durable record lost, keyed on a cwd match. A pathless
      // workspace has no cwd to match and its record is the sole authority, so
      // there is nothing to adopt from a header.
      // Only a workspace of the account the session belongs to adopts it.
      const target = this.list().find(
        workspace => isFolderWorkspace(workspace) && workspace.path === path && workspace.owner === header.owner,
      )
      if (target === undefined || target.sessionIds.includes(header.id)) return
      await target.attachSession(header.id)
    } catch (error) {
      this.ctx.logger.warn(
        `workspace could not admit session '${header.id}' by its cwd: ${String(error)}`,
      )
    }
  }

  private reportFilteredCandidates(): void {
    for (const entity of this.entities.values()) {
      const record = this.requireTable().get(entity.id) as WorkspaceRecord
      // A workspace with no directory filters nothing: every accounted session
      // is a member by definition, so reporting one would be a false alarm.
      if (record.kind !== 'folder' || record.path === undefined) continue
      for (const sessionId of record.sessionIds) {
        const path = this.sessionPaths.get(sessionId)
        if (path === record.path) continue
        const reason = this.invalidSessionPaths.get(sessionId)
          ?? (this.headers.has(sessionId)
            ? `canonical cwd '${path}' differs from workspace path '${record.path}'`
            : 'session header is missing')
        this.ctx.logger.warn(
          `workspace '${entity.id}' filtered session '${sessionId}' from membership: ${reason}`,
        )
      }
    }
  }

  private async readSessionHeader(id: SessionId): Promise<SessionHeader> {
    const live = this.ctx.get('sessions')?.get(id)
    if (live !== undefined) {
      this.headers.set(id, live.header)
      return live.header
    }
    const cached = this.headers.get(id)
    if (cached !== undefined) return cached

    const headers = await this.ctx.sessionPersistence.list()
    await this.indexHeaders(headers)
    const header = this.headers.get(id)
    if (header === undefined) {
      throw new Error(`cannot validate session '${id}': session persistence holds no such session`)
    }
    return header
  }

  private requireTable(): KvTable<WorkspaceId, WorkspaceRecord> {
    if (this.table === undefined) throw new Error('workspace registry is not started yet')
    return this.table
  }

  private requireState(): WorkspaceDomainState {
    if (this.state === undefined) throw new Error('workspace registry is not started yet')
    return this.state
  }

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
  private async writePendingCreate(
    id: WorkspaceId,
    state: WorkspaceDomainState,
    record: WorkspaceRecord,
    recordWriteMessage: string,
    pendingState: WorkspaceDomainState = {
      ...state,
      pendingMutation: { operation: 'create', workspaceId: id },
    },
  ): Promise<void> {
    const table = this.requireTable()
    try {
      await this.setState(pendingState)
    } catch (error) {
      this.entities.delete(id)
      throw error
    }
    try {
      await table.put(id, record)
    } catch (error) {
      this.entities.delete(id)
      try {
        await this.setState(state)
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], recordWriteMessage)
      }
      throw error
    }
  }

  private async setState(state: WorkspaceDomainState): Promise<void> {
    await (this.global as DomainGlobal<WorkspaceDomainState>).set(state)
    this.state = state
  }

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
  private pinnedHead(state: WorkspaceDomainState, workspaceIds: readonly WorkspaceId[]): readonly WorkspaceId[] {
    const pinned = state.defaultWorkspaceId
    if (pinned === undefined || workspaceIds[0] === pinned) return workspaceIds
    return [pinned, ...workspaceIds.filter(id => id !== pinned)]
  }

  /**
   * Place a newly created workspace in the durable order: directly below the
   * built-in one, or at the head while no built-in exists.
   * @param state - state the create is derived from.
   * @param id - the newly durable workspace.
   * @returns complete order for the create write.
   */
  private withNewWorkspace(state: WorkspaceDomainState, id: WorkspaceId): readonly WorkspaceId[] {
    const at = state.defaultWorkspaceId !== undefined && state.workspaceIds[0] === state.defaultWorkspaceId ? 1 : 0
    return [...state.workspaceIds.slice(0, at), id, ...state.workspaceIds.slice(at)]
  }

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
  private carryState(
    state: WorkspaceDomainState,
    changes: { readonly initialized: boolean; readonly workspaceIds: readonly WorkspaceId[] },
  ): WorkspaceDomainState {
    return {
      initialized: changes.initialized,
      workspaceIds: [...changes.workspaceIds],
      archivedSessionIds: state.archivedSessionIds,
      ...state.defaultWorkspaceId === undefined ? {} : { defaultWorkspaceId: state.defaultWorkspaceId },
      ...state.builtInWorkspaceIds === undefined ? {} : { builtInWorkspaceIds: state.builtInWorkspaceIds },
    }
  }

  private isBuiltInId(state: WorkspaceDomainState, id: WorkspaceId): boolean {
    return state.defaultWorkspaceId === id || Object.values(state.builtInWorkspaceIds ?? {}).includes(id)
  }

  private enqueueOperation<T>(operation: () => Promise<T>, publish = true): Promise<T> {
    const result = this.operationTail.then(async () => {
      // A committed delete may leave only its marker cleanup pending. Retry
      // recovery before another create/delete can overwrite that pending operation record.
      await this.recoverPendingMutation()
      return await operation()
    })
    this.operationTail = result.then(() => {}, () => {})
    // Publish after the write committed, so the account's other devices never see a half-applied mutation.
    return result.then((committed) => {
      if (publish) this.publish()
      return committed
    })
  }
}

const sameSessionIds = (left: readonly SessionId[], right: readonly SessionId[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

export default WorkspaceRegistry
