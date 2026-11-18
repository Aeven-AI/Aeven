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
import type { Sync, SyncDocument } from '@aeven/sync'
import type { WorkspaceId } from './types.ts'

/**
 * The account's workspace document. The first document, {@link LEGACY_DOCUMENT}, grew to hundreds of megabytes of
 * rewritten order lists and takes minutes to open, so every device moved to this one; see {@link WorkspaceSync.carryOver}.
 */
const DOCUMENT = 'workspaces/2'

/** The document earlier builds used. It is read once without being opened, then retired on this device. */
const LEGACY_DOCUMENT = 'workspaces'

/** Device-local marker that this device carried the legacy document over and retired it. */
const CARRIED_KEY = 'workspace/carried-over'

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
      // What the earlier document held arrives beside the first projection, not before it, so opening never waits.
      void this.carryOver(owner, sync, handle.doc).then((carried) => {
        if (carried) {
          take()
          this.applyArchive?.(owner, marksOf(handle.doc.getMap<ArchiveMark>('archived')))
        }
      }, (error: unknown) => {
        // The marker stays unset, so the next start carries over again.
        this.warn(`workspace: carrying the earlier synced document over failed: ${String(error)}`)
      })
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

  /**
   * Bring what only the legacy document held into this one, once per device: each workspace's record, removal
   * markers included, and each session's archive mark. The legacy document is read without being opened and then
   * retired here. A record or mark this document already holds wins unless the legacy one is later, the same
   * later-write rule the document applies between devices, so devices that each carry over agree.
   * @param owner - the account.
   * @param sync - the account's sync service.
   * @param doc - this document, open.
   * @returns whether this call carried the legacy document over.
   */
  private async carryOver(owner: string, sync: Sync, doc: SyncDocument['doc']): Promise<boolean> {
    if (sync.localValue(owner, CARRIED_KEY) === '1') return false
    const legacy = await sync.documentEntries(owner, LEGACY_DOCUMENT, ['records', 'archived'])
    const records = doc.getMap<SyncedWorkspace>('records')
    const archive = doc.getMap<ArchiveMark>('archived')
    const order = doc.getArray<WorkspaceId>('order')
    const stamp = (entry: SyncedWorkspace | undefined): string => entry?.updatedAt ?? entry?.createdAt ?? ''
    doc.transact(() => {
      for (const [id, written] of Object.entries(legacy['records'] ?? {})) {
        // Stored values come from other devices' documents, so they are checked before they are trusted.
        const latest = written.filter((entry): entry is SyncedWorkspace => typeof entry === 'object' && entry !== null)
          .reduce<SyncedWorkspace | undefined>((best, entry) => best === undefined || stamp(entry) >= stamp(best) ? entry : best, undefined)
        if (latest === undefined) continue
        const held = records.get(id)
        if (held === undefined || stamp(latest) > stamp(held)) records.set(id, latest)
      }
      for (const [id, written] of Object.entries(legacy['archived'] ?? {})) {
        const latest = written
          .filter((mark): mark is ArchiveMark => typeof mark === 'object' && mark !== null && typeof (mark as ArchiveMark).at === 'number')
          .reduce<ArchiveMark | undefined>((best, mark) => best === undefined || mark.at >= best.at ? mark : best, undefined)
        if (latest === undefined) continue
        const held = archive.get(id)
        if (held === undefined || latest.at > held.at) archive.set(id, latest)
      }
      // A carried workspace no device here orders yet still needs a place in the list.
      const listed = new Set(order.toArray())
      const missing = [...records.entries()]
        .filter(([id, entry]) => entry.removed !== true && !listed.has(id as WorkspaceId))
        .map(([id]) => id as WorkspaceId)
      if (missing.length > 0) order.insert(order.length, missing)
    })
    await sync.retireDocument(owner, LEGACY_DOCUMENT)
    sync.setLocalValue(owner, CARRIED_KEY, '1')
    return true
  }

  private take(owner: string, records: YMap<SyncedWorkspace>, order: YArray<WorkspaceId>): void {
    const projection: SyncedWorkspaces = {
      records: [...records.entries()].map(([id, entry]) => ({ id: id as WorkspaceId, ...entry })),
      // Concurrent replacements of the list leave duplicates in it; see {@link publish}.
      order: [...new Set(order.toArray())],
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
      const current = order.toArray()
      // Workspaces this device has not received yet keep their place after the ones it orders. Each id is listed
      // once: two devices that replaced the list at the same time each kept their copy, so the list holds
      // duplicates that only a rewrite removes.
      const next = [...new Set([...projection.order, ...current.filter(id => !held.has(id))])]
      // An unchanged order writes nothing: every write of the list is a whole copy of it in the document's history.
      if (current.length === next.length && current.every((id, index) => id === next[index])) return
      order.delete(0, order.length)
      order.insert(0, next)
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
