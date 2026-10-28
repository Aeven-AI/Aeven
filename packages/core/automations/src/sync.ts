/**
 * Keeps each account's automation definitions the same on all of its devices through the account's synced
 * `automations` document, while `ctx.sync` serves the account. Each definition is one map entry; a removed
 * automation leaves a tombstone, and the entry changed last wins.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Map as YMap, Transaction, YMapEvent } from 'yjs'
import type { SyncDocument } from '@aeven/sync'
import type { AutomationDefinition, AutomationId } from './types.ts'

const DOCUMENT = 'automations'

/** One automation as the document holds it. */
export interface SyncedDefinition {
  /** The stored definition, or absent once the automation was removed. */
  definition?: AutomationDefinition
  /** When the definition or its removal was written, in milliseconds since the Unix epoch. */
  changedAt: number
}

/** Applies another device's definition or removal locally. */
export type DefinitionApply = (id: AutomationId, entry: SyncedDefinition) => void

/** Mirror between the definition table and each account's synced document. */
export class DefinitionSync {
  private readonly open = new Map<string, Promise<SyncDocument | undefined>>()

  /**
   * @param ctx - the service context; `sync` is read optionally.
   * @param apply - stores another device's definition or removal.
   * @param warn - receives failures to open the document.
   */
  constructor(
    private readonly ctx: Context,
    private readonly apply: DefinitionApply,
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
      const map = handle.doc.getMap<SyncedDefinition>('definitions')
      this.take(map, map.keys())
      map.observe((event: YMapEvent<SyncedDefinition>, transaction: Transaction) => {
        if (!transaction.local) this.take(map, event.keysChanged)
      })
      return handle
    }, (error: unknown) => {
      this.open.delete(owner)
      this.warn(`automations: opening the synced document failed: ${String(error)}`)
      return undefined
    })
    this.open.set(owner, opening)
    return opening
  }

  private take(map: YMap<SyncedDefinition>, keys: Iterable<string>): void {
    for (const key of keys) {
      const entry = map.get(key)
      if (entry === undefined) continue
      this.apply(key as AutomationId, entry)
    }
  }

  /**
   * Publish one definition after a local change.
   * @param owner - the account the automation belongs to.
   * @param definition - the stored definition.
   */
  async publish(owner: string, definition: AutomationDefinition): Promise<void> {
    const handle = await this.attach(owner)
    handle?.doc.getMap<SyncedDefinition>('definitions').set(definition.id, { definition, changedAt: Date.parse(definition.updatedAt) })
  }

  /**
   * Publish the removal of one automation.
   * @param owner - the account the automation belonged to.
   * @param id - the removed automation.
   * @param changedAt - when the removal was stored, in milliseconds since the Unix epoch.
   */
  async forget(owner: string, id: AutomationId, changedAt: number): Promise<void> {
    const handle = await this.attach(owner)
    handle?.doc.getMap<SyncedDefinition>('definitions').set(id, { changedAt })
  }

  /** Close every open document. */
  async dispose(): Promise<void> {
    for (const opening of this.open.values()) (await opening)?.close()
    this.open.clear()
  }
}
