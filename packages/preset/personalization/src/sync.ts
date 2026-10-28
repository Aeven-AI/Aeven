/**
 * Keeps each account's preferences the same on all of its devices through the account's synced
 * `personalization` document, while `ctx.sync` serves the account. The document holds one map whose fields
 * merge independently, so a voice chosen on one device and notes written on another both survive.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Map as YMap, YMapEvent, Transaction } from 'yjs'
import type { SyncDocument } from '@aeven/sync'
import type { Personalization, PersonalizationVoice } from './types.ts'
import { DEFAULT_PERSONALIZATION, type PersonalizationStore } from './store.ts'

const DOCUMENT = 'personalization'
const FIELDS = ['voice', 'notes', 'masterPrompt'] as const

/** Mirror between per-account preference files and synced documents. */
export class PersonalizationSync {
  private readonly open = new Map<string, Promise<SyncDocument | undefined>>()

  /**
   * @param ctx - the controller context; `sync` is read optionally.
   * @param store - the preference files.
   * @param warn - receives failures to open or apply a document.
   */
  constructor(
    private readonly ctx: Context,
    private readonly store: PersonalizationStore,
    private readonly warn: (message: string) => void,
  ) {}

  private preferences(map: YMap<unknown>): Personalization | undefined {
    const voice = map.get('voice')
    const notes = map.get('notes')
    const masterPrompt = map.get('masterPrompt')
    if (typeof voice !== 'string' || typeof notes !== 'string' || typeof masterPrompt !== 'string') return undefined
    return { voice: voice as PersonalizationVoice, notes, masterPrompt }
  }

  /**
   * Open the account's document once this device syncs it and take the document's preferences when
   * another device already wrote them. An empty document is seeded only by a caught-up device whose person
   * changed something, so a device that opens it before another device's write arrives cannot overwrite that
   * write with defaults.
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
      const map = handle.doc.getMap<unknown>('preferences')
      const synced = this.preferences(map)
      if (synced !== undefined) this.store.apply(owner, synced)
      else if (sync.status(owner).state === 'online' && this.customized(owner)) this.write(map, this.store.read(owner))
      map.observe((_event: YMapEvent<unknown>, transaction: Transaction) => {
        if (transaction.local) return
        const next = this.preferences(map)
        if (next !== undefined) this.store.apply(owner, next)
      })
      return handle
    }, (error: unknown) => {
      this.open.delete(owner)
      this.warn(`personalization: opening the synced document failed: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    })
    this.open.set(owner, opening)
    return opening
  }

  /**
   * Publish this device's preferences after a local change.
   * @param owner - the account.
   * @param preferences - the preferences now stored.
   */
  async publish(owner: string, preferences: Personalization): Promise<void> {
    const handle = await this.attach(owner)
    if (handle !== undefined) this.write(handle.doc.getMap<unknown>('preferences'), preferences)
  }

  private customized(owner: string): boolean {
    const current = this.store.read(owner)
    return FIELDS.some(field => current[field] !== DEFAULT_PERSONALIZATION[field])
  }

  private write(map: YMap<unknown>, preferences: Personalization): void {
    map.doc?.transact(() => {
      for (const field of FIELDS) {
        if (map.get(field) !== preferences[field]) map.set(field, preferences[field])
      }
    })
  }

  /** Close every open document. */
  async dispose(): Promise<void> {
    for (const opening of this.open.values()) (await opening)?.close()
    this.open.clear()
  }
}
