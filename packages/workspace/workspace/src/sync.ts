/**
 * Keeps the account's workspaces the same on all of its devices through the account's synced `workspaces`
 * document, while `ctx.sync` serves the account. The document holds each workspace's title and timestamps and the
 * account's display order — never a directory path, because a folder lives on the device that opened it: another
 * device receives the workspace pathless and stores it as `remote` until it binds a directory of its own. Session
 * accounting and the archive set stay device-local for the same reason, since a session body lives where it ran.
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

/** Mirror between the workspace registry and each account's synced document. */
export class WorkspaceSync {
  private readonly open = new Map<string, Promise<SyncDocument | undefined>>()
  /** What this device last published per account, so a removed workspace leaves a tombstone. */
  private readonly published = new Map<string, Map<WorkspaceId, SyncedWorkspace>>()

  /**
   * @param ctx - the registry context; `sync` is read optionally.
   * @param apply - stores another device's workspaces on this device.
   * @param warn - receives failures to open the document.
   * @param now - clock for the tombstone timestamp.
   */
  constructor(
    private readonly ctx: Context,
    private readonly apply: WorkspaceApply,
    private readonly warn: (message: string) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Open the account's document once its vault is enrolled here and apply what other devices wrote.
   * @param owner - the account.
   * @returns the open document, or undefined while sync does not serve the account.
   */
  attach(owner: string): Promise<SyncDocument | undefined> {
    const existing = this.open.get(owner)
    if (existing !== undefined) return existing
    const sync = this.ctx.get('sync')
    const state = sync?.status(owner).state
    if (sync === undefined || state === 'unenrolled' || state === 'joining') return Promise.resolve(undefined)
    const opening = sync.openDocument(owner, DOCUMENT).then((handle) => {
      const records = handle.doc.getMap<SyncedWorkspace>('records')
      const order = handle.doc.getArray<WorkspaceId>('order')
      // What the document already holds is what this device may later have to remove.
      this.published.set(owner, new Map([...records.entries()].map(([id, entry]) => [id as WorkspaceId, entry])))
      const take = () => { this.take(owner, records, order) }
      take()
      records.observe((_event: YMapEvent<SyncedWorkspace>, transaction: Transaction) => {
        if (!transaction.local) take()
      })
      order.observe((_event: YArrayEvent<WorkspaceId>, transaction: Transaction) => {
        if (!transaction.local) take()
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
   * Publish one account's workspaces after a local change, marking the workspaces this device published before
   * and no longer holds as removed.
   * @param owner - the account.
   * @param projection - its workspaces and their order.
   */
  async publish(owner: string, projection: SyncedWorkspaces): Promise<void> {
    const handle = await this.attach(owner)
    if (handle === undefined) return
    const records = handle.doc.getMap<SyncedWorkspace>('records')
    const order = handle.doc.getArray<WorkspaceId>('order')
    const published = new Map<WorkspaceId, SyncedWorkspace>()
    for (const record of projection.records) {
      const { id, ...entry } = record
      published.set(id, entry)
    }
    const tombstone = { removed: true, updatedAt: this.now().toISOString() }
    handle.doc.transact(() => {
      for (const [id, entry] of published) records.set(id, entry)
      for (const id of this.published.get(owner)?.keys() ?? []) {
        if (published.has(id)) continue
        const title = records.get(id)?.title
        records.set(id, title === undefined ? tombstone : { ...tombstone, title })
      }
      order.delete(0, order.length)
      order.insert(0, [...projection.order])
    })
    this.published.set(owner, published)
  }

  /** Close every open document. */
  async dispose(): Promise<void> {
    for (const opening of this.open.values()) (await opening)?.close()
    this.open.clear()
    this.published.clear()
  }
}
