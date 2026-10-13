import type { MessageId } from '@aeven/llm/brand'
import type { ContentBlock } from '@aeven/llm/types'
import type { SessionQueuedItem } from '../../types.ts'
import type { SessionEvent } from '@aeven/session/types'
import type { QueuedMessage } from '../contract/snapshot.ts'

const QUEUE_PREVIEW_CHARS = 200

// Image blocks are excluded: queue presentation renders them as thumbnails
// from `content`, so the text preview covers only what has no visual form.
function previewOf(content: readonly ContentBlock[]): string {
  const flat = content
    .filter(block => block.type !== 'image')
    .map(block => (block.type === 'text' ? block.text : `[${block.type}]`))
    .join(' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(flat)
  return chars.length > QUEUE_PREVIEW_CHARS ? `${chars.slice(0, QUEUE_PREVIEW_CHARS).join('')}…` : flat
}

function textOf(content: readonly ContentBlock[]): string | null {
  if (!content.every(block => block.type === 'text')) return null
  return content.map(block => block.text).join('')
}

type QueueItems = readonly SessionQueuedItem[]

/**
 * Authoritative transient queue projection and durable handoff. A user row the
 * Host claims into a turn stays listed until its `user/message` is logged, so
 * the message never leaves the screen between the claim and the log.
 */
export class SessionQueueMirror {
  private current: readonly QueuedMessage[] = []
  /** Claimed user rows awaiting their durable `user/message`; dropped at `turn/end`. */
  private held: readonly QueuedMessage[] = []
  /** User messages logged since the last `turn/end`, so a claim frame that trails its message holds nothing. */
  private readonly logged = new Set<MessageId>()
  private rows: readonly QueuedMessage[] = []

  /**
   * Return the current immutable queue projection.
   * @returns held claimed rows, then current queue rows.
   */
  snapshot(): readonly QueuedMessage[] {
    return this.rows
  }

  /**
   * Replace from one stream baseline, dropping every held claim.
   * @param items - complete host queue snapshot.
   */
  replace(items: QueueItems): void {
    this.held = []
    this.logged.clear()
    this.current = items.map(toQueuedMessage)
    this.publish()
  }

  /**
   * Apply one live queue frame.
   * @param items - complete host queue snapshot.
   * @param claimed - user messages the frame's splice claimed into a turn.
   */
  applyFrame(items: QueueItems, claimed: readonly MessageId[]): void {
    const claimedIds = new Set(claimed)
    const newlyHeld = this.current
      .filter(row => claimedIds.has(row.messageId) && !this.logged.has(row.messageId))
      .map(row => ({ ...row, claimed: true as const }))
    if (newlyHeld.length > 0) this.held = [...this.held, ...newlyHeld]
    this.current = items.map(toQueuedMessage)
    this.publish()
  }

  /**
   * Retire a transient row once its durable message enters the log, and drop
   * held claims when their turn ends without logging them.
   * @param event - newly contiguous durable Session event.
   * @returns whether the projection changed.
   */
  acceptDurable(event: SessionEvent): boolean {
    if (event.type === 'turn/end') {
      this.logged.clear()
      if (this.held.length === 0) return false
      this.held = []
      this.publish()
      return true
    }
    if (event.type !== 'user/message') return false
    const messageId = event.data.id
    this.logged.add(messageId)
    const held = this.held.filter(row => row.messageId !== messageId)
    const current = this.current.filter(row => row.placement !== 'steering' || row.messageId !== messageId)
    if (held.length === this.held.length && current.length === this.current.length) return false
    this.held = held
    this.current = current
    this.publish()
    return true
  }

  private publish(): void {
    this.rows = this.held.length === 0 ? this.current : [...this.held, ...this.current]
  }
}

function toQueuedMessage(item: SessionQueuedItem): QueuedMessage {
  const content = item.message.content as unknown as readonly ContentBlock[]
  return {
    id: item.id,
    messageId: item.message.id,
    placement: item.placement,
    ...(item.rpcId === undefined ? {} : { rpcId: item.rpcId }),
    content,
    preview: previewOf(content),
    text: textOf(content),
  }
}
