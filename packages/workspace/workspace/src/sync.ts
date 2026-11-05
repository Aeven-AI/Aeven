/**
 * Keeps the account's workspaces the same on all of its devices through the account's synced `workspaces`
 * document, while `ctx.sync` serves the account. The document holds each workspace's title and timestamps and the
 * account's display order — never a directory path, because a folder lives on the device that opened it: another
 * device receives the workspace pathless and stores it as `remote` until it binds a directory of its own. Session
 * accounting stays device-local for the same reason. The archive set travels: each session's latest archive or
 * unarchive wins, so a conversation reads as archived on every device or on none.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Array as YArray, Map as YMap, Transaction, YArrayEvent, YMapEvent } from 'yjs'
import type { SyncDocument } from '@aeven/sync'
import type { WorkspaceId } from './types.ts'

const DOCUMENT = 'workspaces'

/** One workspace as the document holds it. */
export interface SyncedWorkspace {
  /** Display title shown by every device. */
  title?: string
  /** Account the workspace belongs to. */
  owner?: string
  /** When the workspace was first registered, as a stored timestamp. */
  createdAt?: string
  /** When the title last changed, as a stored timestamp; the later write wins. */
  updatedAt?: string
  /** Set once the workspace was removed. */
  removed?: boolean
  /**
   * Set when the workspace was created without a directory. Another device then stores it as `virtual`, usable
   * as it is, instead of `remote`, which waits for a folder. Once set it stays set: a device that later binds a
   * folder of its own does not turn the workspace into a folder workspace on the others.
   */
  pathless?: true
}

/** The account's workspaces as one device publishes or receives them. */
export interface SyncedWorkspaces {
  /** Every workspace of the account, the removed ones marked. */
  readonly records: readonly ({ readonly id: WorkspaceId } & SyncedWorkspace)[]
  /** The account's workspaces in display order. */
  readonly order: readonly WorkspaceId[]
}

/** Applies another device's workspaces on this device. */
export type WorkspaceApply = (owner: string, projection: SyncedWorkspaces) => void

/** One session's archive state as the document holds it; the later `at` wins. */
export interface ArchiveMark {
  archived: boolean
  /** When a device archived or unarchived it, in milliseconds since the Unix epoch. */
  at: number
}

/** Applies the account's archive marks on this device. */
export type ArchiveApply = (owner: string, marks: ReadonlyMap<string, boolean>) => void

/** Mirror between the workspace registry and each account's synced document. */
export class WorkspaceSync {
  private readonly open = new Map<string, Promise<SyncDocument | undefined>>()

  /**
   * @param ctx - the registry context; `sync` is read optionally.
   * @param apply - stores another device's workspaces on this device.
   * @param warn - receives failures to open the document.
   * @param now - clock for the tombstone timestamp.
   * @param applyArchive - stores the account's archive marks on this device.
   */
  constructor(
    private readonly ctx: Context,
    private readonly apply: WorkspaceApply,
    private readonly warn: (message: string) => void,
    private readonly now: () => Date = () => new Date(),
    private readonly applyArchive?: ArchiveApply,
  ) {}

  /**
   * Open the account's document once this device syncs it and apply what other devices wrote.
   * @param owner - the account.
   * @returns the open document, or undefined while sync does not serve the account.
   */
  /* jscpd:ignore-start -- parallel to the other account-document attachers; this one mirrors a map plus its ordering array. */
  attach(owner: string): Promise<SyncDocument | undefined> {
    const existing = this.open.get(owner)
    if (existing !== undefined) return existing
    const sync = this.ctx.get('sync')
    const state = sync?.status(owner).state
    if (sync === undefined || state === 'disabled' || state === 'starting') return Promise.resolve(undefined)
    const opening = sync.openDocument(owner, DOCUMENT).then((handle) => {
      const records = handle.doc.getMap<SyncedWorkspace>('records')
      const order = handle.doc.getArray<WorkspaceId>('order')
      const take = () => { this.take(owner, records, order) }
      take()
      records.observe((_event: YMapEvent<SyncedWorkspace>, transaction: Transaction) => {
        if (!transaction.local) take()
      })
      order.observe((_event: YArrayEvent<WorkspaceId>, transaction: Transaction) => {
        if (!transaction.local) take()
      })
      const archive = handle.doc.getMap<ArchiveMark>('archived')
      archive.observe((_event: YMapEvent<ArchiveMark>, transaction: Transaction) => {
        if (!transaction.local) this.applyArchive?.(owner, marksOf(archive))
      })
      return handle
    }, (error: unknown) => {
      this.open.delete(owner)
      this.warn(`workspace: opening the synced document failed: ${String(error)}`)
      return undefined
    })
    this.open.set(owner, opening)
    return opening
  }
  /* jscpd:ignore-end */

  private take(owner: string, records: YMap<SyncedWorkspace>, order: YArray<WorkspaceId>): void {
    const projection: SyncedWorkspaces = {
      records: [...records.entries()].map(([id, entry]) => ({ id: id as WorkspaceId, ...entry })),
      order: order.toArray(),
    }
    this.apply(owner, projection)
  }

  /**
   * Accounts this device has opened a document for.
   * @returns the account ids.
   */
  owners(): readonly string[] {
    return [...this.open.keys()]
  }

  /**
   * Publish one account's workspaces after a local change. A workspace this device does not hold is left as the
   * document has it, since it may be one this device has not received yet; only {@link forget} removes one.
   * @param owner - the account.
   * @param projection - its workspaces and their order.
   */
  async publish(owner: string, projection: SyncedWorkspaces): Promise<void> {
    const handle = await this.attach(owner)
    if (handle === undefined) return
    const records = handle.doc.getMap<SyncedWorkspace>('records')
    const order = handle.doc.getArray<WorkspaceId>('order')
    handle.doc.transact(() => {
      for (const { id, ...entry } of projection.records) {
        const prior = records.get(id)
        const next = prior?.pathless === true && entry.pathless === undefined ? { ...entry, pathless: true as const } : entry
        if (JSON.stringify(prior) !== JSON.stringify(next)) records.set(id, next)
      }
      const held = new Set(projection.order)
      // Workspaces this device has not received yet keep their place after the ones it orders.
      const rest = order.toArray().filter(id => !held.has(id))
      order.delete(0, order.length)
      order.insert(0, [...projection.order, ...rest])
    })
  }

  /**
   * Publish the removal of one workspace this device deleted.
   * @param owner - the account.
   * @param id - the removed workspace.
   * @param title - its last title, kept so a device that never received it can still name it.
   */
  async forget(owner: string, id: WorkspaceId, title: string): Promise<void> {
    const handle = await this.attach(owner)
    handle?.doc.getMap<SyncedWorkspace>('records').set(id, { removed: true, title, updatedAt: this.now().toISOString() })
  }

  /**
   * The account's archive marks.
   * @param owner - the account.
   * @returns each marked session's archive state, or undefined while sync does not serve the account.
   */
  async archiveMarks(owner: string): Promise<ReadonlyMap<string, boolean> | undefined> {
    const handle = await this.attach(owner)
    return handle === undefined ? undefined : marksOf(handle.doc.getMap<ArchiveMark>('archived'))
  }

  /**
   * Record that this device archived or unarchived sessions of the account.
   * @param owner - the account.
   * @param sessionIds - the sessions.
   * @param archived - whether they are archived now.
   */
  async markArchived(owner: string, sessionIds: readonly string[], archived: boolean): Promise<void> {
    const handle = await this.attach(owner)
    if (handle === undefined || sessionIds.length === 0) return
    const archive = handle.doc.getMap<ArchiveMark>('archived')
    const at = this.now().getTime()
    handle.doc.transact(() => { for (const id of sessionIds) archive.set(id, { archived, at }) })
  }

  /* jscpd:ignore-start -- identical in every account-document mirror; each owns its own open map and document. */
  /**
   * Close the account's document because its documents started over under a new key; the next attach opens it anew.
   * @param owner - the account.
   * @returns when the document is closed.
   */
  async reset(owner: string): Promise<void> {
    const opening = this.open.get(owner)
    this.open.delete(owner)
    ;(await opening)?.close()
  }

  /** Close every open document. */
  async dispose(): Promise<void> {
    for (const opening of this.open.values()) (await opening)?.close()
    this.open.clear()
  }
  /* jscpd:ignore-end */
}

/**
 * @param archive - the document's archive map.
 * @returns each marked session's archive state.
 */
function marksOf(archive: YMap<ArchiveMark>): ReadonlyMap<string, boolean> {
  return new Map([...archive.entries()].map(([id, mark]) => [id, mark.archived]))
}
