/**
 * Keeps each account's message feedback the same on all of its devices through the account's synced `feedback`
 * document, while `ctx.sync` serves the account. Each rated message is one map entry; removing a rating leaves
 * a tombstone, and the entry changed last wins.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Map as YMap, Transaction, YMapEvent } from 'yjs'
import type { SyncDocument } from '@aeven/sync'
import type { SessionId } from '@aeven/session/types'
import type { MessageFeedbackItem } from './types.ts'

const DOCUMENT = 'feedback'

/** One message's feedback as the document holds it. */
export interface SyncedFeedback {
  /** The Session's creation time, which identifies its lifecycle. */
  sessionCreatedAt: number
  /** The item, or absent once the rating was removed. */
  item?: MessageFeedbackItem
  /** When the item was written or removed, in milliseconds since the Unix epoch. */
  changedAt: number
}

/** Applies another device's feedback change locally. */
export type FeedbackApply = (sessionId: SessionId, messageId: string, entry: SyncedFeedback) => void

/** Map key of one message's feedback. */
function keyOf(sessionId: string, messageId: string): string {
  return `${sessionId}\n${messageId}`
}

/** Mirror between the feedback table and each account's synced document. */
export class FeedbackSync {
  private readonly open = new Map<string, Promise<SyncDocument | undefined>>()

  /**
   * @param ctx - the service context; `sync` is read optionally.
   * @param apply - writes another device's change into the local table.
   * @param warn - receives failures to open the document.
   */
  constructor(
    private readonly ctx: Context,
    private readonly apply: FeedbackApply,
    private readonly warn: (message: string) => void,
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
      const map = handle.doc.getMap<SyncedFeedback>('messages')
      this.take(map, map.keys())
      map.observe((event: YMapEvent<SyncedFeedback>, transaction: Transaction) => {
        if (!transaction.local) this.take(map, event.keysChanged)
      })
      return handle
    }, (error: unknown) => {
      this.open.delete(owner)
      this.warn(`message feedback: opening the synced document failed: ${String(error)}`)
      return undefined
    })
    this.open.set(owner, opening)
    return opening
  }

  private take(map: YMap<SyncedFeedback>, keys: Iterable<string>): void {
    for (const key of keys) {
      const entry = map.get(key)
      const split = key.indexOf('\n')
      if (entry === undefined || split <= 0) continue
      this.apply(key.slice(0, split) as SessionId, key.slice(split + 1), entry)
    }
  }

  /**
   * Publish one message's feedback after a local change.
   * @param owner - the account the Session belongs to.
   * @param sessionId - the Session.
   * @param messageId - the rated message.
   * @param entry - the committed item or its removal.
   */
  async publish(owner: string, sessionId: SessionId, messageId: string, entry: SyncedFeedback): Promise<void> {
    const handle = await this.attach(owner)
    handle?.doc.getMap<SyncedFeedback>('messages').set(keyOf(sessionId, messageId), entry)
  }

  /** Close every open document. */
  async dispose(): Promise<void> {
    for (const opening of this.open.values()) (await opening)?.close()
    this.open.clear()
  }
}
