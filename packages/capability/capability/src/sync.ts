/**
 * Keeps each account's learned capabilities the same on all of its devices through the account's synced
 * `capabilities` document, while `ctx.sync` serves the account. Each capability is one entry holding its files
 * keyed by path, so a procedure and its scripts reach the other devices together; a removed capability leaves a
 * tombstone, and the entry written last wins. A device's execution log stays on that device.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Map as YMap, Transaction, YMapEvent } from 'yjs'
import type { SyncDocument } from '@aeven/sync'

const DOCUMENT = 'capabilities'

/** One capability as the document holds it. */
export interface SyncedCapability {
  /** Every file of the capability keyed by its path inside the capability's directory, or absent once removed. */
  files?: Record<string, string>
  /** Revision the files belong to; the newer revision wins, and at equal revisions the later write does. */
  revision?: number
  /** When the capability was written, in milliseconds since the Unix epoch. */
  changedAt: number
  /** Set once the capability was removed. */
  removed?: boolean
}

/** Applies another device's capability or its removal on this device. */
export type CapabilityApply = (owner: string, name: string, entry: SyncedCapability) => void

/** Mirror between the capability directories and each account's synced document. */
export class CapabilitySync {
  private readonly open = new Map<string, Promise<SyncDocument | undefined>>()

  /**
   * @param ctx - the service context; `sync` is read optionally.
   * @param apply - stores another device's capability or removal.
   * @param warn - receives failures to open the document.
   */
  constructor(
    private readonly ctx: Context,
    private readonly apply: CapabilityApply,
    private readonly warn: (message: string) => void,
  ) {}

  /**
   * Open the account's document once this device syncs it and apply what other devices wrote.
   * @param owner - the account.
   * @returns the open document, or undefined while sync does not serve the account.
   */
  attach(owner: string): Promise<SyncDocument | undefined> {
    const existing = this.open.get(owner)
    if (existing !== undefined) return existing
    const sync = this.ctx.get('sync')
    const state = sync?.status(owner).state
    if (sync === undefined || state === 'disabled' || state === 'starting') return Promise.resolve(undefined)
    const opening = sync.openDocument(owner, DOCUMENT).then((handle) => {
      const map = handle.doc.getMap<SyncedCapability>('capabilities')
      this.take(owner, map, map.keys())
      map.observe((event: YMapEvent<SyncedCapability>, transaction: Transaction) => {
        if (!transaction.local) this.take(owner, map, event.keysChanged)
      })
      return handle
    }, (error: unknown) => {
      this.open.delete(owner)
      this.warn(`capabilities: opening the synced document failed: ${String(error)}`)
      return undefined
    })
    this.open.set(owner, opening)
    return opening
  }

  private take(owner: string, map: YMap<SyncedCapability>, keys: Iterable<string>): void {
    for (const key of keys) {
      const entry = map.get(key)
      if (entry !== undefined) this.apply(owner, key, entry)
    }
  }

  /**
   * Publish one capability after a local write.
   * @param owner - the account the capability belongs to.
   * @param name - the capability.
   * @param entry - its files and revision.
   */
  async publish(owner: string, name: string, entry: SyncedCapability): Promise<void> {
    const handle = await this.attach(owner)
    handle?.doc.getMap<SyncedCapability>('capabilities').set(name, entry)
  }

  /**
   * Publish the removal of one capability.
   * @param owner - the account the capability belonged to.
   * @param name - the removed capability.
   * @param changedAt - when the removal was stored, in milliseconds since the Unix epoch.
   */
  async forget(owner: string, name: string, changedAt: number): Promise<void> {
    const handle = await this.attach(owner)
    handle?.doc.getMap<SyncedCapability>('capabilities').set(name, { changedAt, removed: true })
  }

  /** Close every open document. */
  async dispose(): Promise<void> {
    for (const opening of this.open.values()) (await opening)?.close()
    this.open.clear()
  }
}
