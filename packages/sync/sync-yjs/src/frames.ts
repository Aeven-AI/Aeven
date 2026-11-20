/** Garbage-collected Yjs state and bounded, authenticated transport parts of one logical sync payload. */
import { createHmac } from 'node:crypto'
import * as Y from 'yjs'
import { contentKeyOf, openEnvelope, sealEnvelope, type SealEnvelopeInput } from '@aeven/sync-vault'

/**
 * Read every value stored updates wrote under each key of some root maps, without integrating the updates into a
 * document. Integration replays the whole history, which for a document rewritten many times costs minutes; decoding
 * only walks the structs. An item names its map and key when it is the first write of that key, and otherwise names
 * the item it follows, so keys are resolved through those references until no more resolve.
 * @param updates - stored updates of one document, any order.
 * @param maps - names of the root maps to read.
 * @returns per map, per key, the values written under it, overwritten ones included; the caller picks the current one.
 */
export function mapEntries(updates: readonly Uint8Array[], maps: readonly string[]): Record<string, Record<string, unknown[]>> {
  const found: Record<string, Record<string, unknown[]>> = Object.fromEntries(maps.map(name => [name, {}]))
  // Each client's items by starting clock. An item covers `length` clocks, which for a deletion can be millions, so
  // a reference is resolved by searching these ranges, never by listing every clock.
  const byClient = new Map<number, Y.Item[]>()
  for (const update of updates) {
    for (const struct of Y.decodeUpdate(update).structs) {
      if (!(struct instanceof Y.Item)) continue
      const items = byClient.get(struct.id.client) ?? []
      items.push(struct)
      byClient.set(struct.id.client, items)
    }
  }
  for (const items of byClient.values()) items.sort((a, b) => a.id.clock - b.id.clock)
  const covering = (client: number, clock: number): Y.Item | undefined => {
    const items = byClient.get(client)
    if (items === undefined) return undefined
    let low = 0
    let high = items.length - 1
    while (low <= high) {
      const middle = (low + high) >> 1
      const item = items[middle]
      if (item === undefined) return undefined
      if (clock < item.id.clock) high = middle - 1
      else if (clock >= item.id.clock + item.length) low = middle + 1
      else return item
    }
    return undefined
  }
  /** Map and key per item once resolved; `null` for an item whose chain reaches no named parent. */
  const resolved = new Map<Y.Item, { map: string; key: string | null } | null>()
  const resolve = (start: Y.Item): { map: string; key: string | null } | null => {
    // The chain of neighbours is walked iteratively, since it can be as long as the document's history.
    const chain: Y.Item[] = []
    const visited = new Set<Y.Item>()
    let item: Y.Item | undefined = start
    let answer: { map: string; key: string | null } | null = null
    while (item !== undefined) {
      const known = resolved.get(item)
      if (known !== undefined) {
        answer = known
        break
      }
      if (visited.has(item)) break
      visited.add(item)
      chain.push(item)
      const parent = item.parent as unknown
      if (typeof parent === 'string') {
        answer = { map: parent, key: item.parentSub }
        break
      }
      const neighbour: Y.ID | null = item.origin ?? item.rightOrigin
      item = neighbour === null ? undefined : covering(neighbour.client, neighbour.clock)
    }
    for (const link of chain) resolved.set(link, answer)
    return answer
  }
  for (const items of byClient.values()) {
    for (const item of items) {
      const place = resolve(item)
      const entries = place === null ? undefined : found[place.map]
      if (place === null || place.key === null || entries === undefined || !(item.content instanceof Y.ContentAny)) continue
      const values = entries[place.key] ?? []
      values.push(...(item.content.arr as unknown[]))
      entries[place.key] = values
    }
  }
  return found
}

/**
 * Allocates a document's next sender counter: one past the stored counter, and never below the clock floor. Takes
 * the document id and the floor, and returns the counter.
 */
export const NEXT_COUNTER_SQL = 'INSERT INTO counters (id, counter) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET counter = max(counter + 1, excluded.counter) RETURNING counter'

/**
 * The lowest counter a frame sealed now may carry: the time in microseconds. Receivers drop a frame whose counter
 * does not exceed the last one they accepted from the same device for the same document, so a device whose stored
 * counters restarted, such as after dropping and taking back the same account key, would otherwise be refused until
 * its counters passed the old ones. Counters advance by one per frame, far slower than the clock, so a counter
 * allocated after any restart exceeds every counter allocated before it.
 * @param now - the current time in milliseconds since the Unix epoch.
 * @returns the floor.
 */
export function counterFloor(now: number): number {
  return now * 1000
}

/**
 * The part of a document's state that another copy of it lacks: structs it never integrated and deletions it never
 * applied.
 * @param local - this device's stored updates of the document.
 * @param other - the updates the other copy holds.
 * @returns an update carrying what the other copy lacks, or undefined when it already holds everything.
 */
export function missingFrom(local: readonly Uint8Array[], other: readonly Uint8Array[]): Uint8Array | undefined {
  const theirs = Y.mergeUpdates([...other])
  const diff = Y.diffUpdate(Y.mergeUpdates([...local]), Y.encodeStateVectorFromUpdate(theirs))
  const { structs, ds } = Y.decodeUpdate(diff)
  if (structs.some(struct => struct instanceof Y.Item || struct instanceof Y.GC)) return diff
  const held = Y.decodeUpdate(theirs).ds.clients
  for (const [client, deleted] of ds.clients) {
    const ranges = [...held.get(client) ?? []].sort((a, b) => a.clock - b.clock)
    for (const { clock, len } of deleted) {
      let reached = clock
      for (const range of ranges) {
        if (range.clock > reached) break
        reached = Math.max(reached, range.clock + range.len)
        if (reached >= clock + len) break
      }
      if (reached < clock + len) return diff
    }
  }
  return undefined
}

/**
 * The writer clocks a document's copy waits for: updates it holds that build on an update it never received stay
 * pending, and so does everything later from the same writers.
 * @param doc - a document with its stored updates applied.
 * @returns each writer's first missing clock, empty when nothing is pending.
 */
export function missingClocks(doc: Y.Doc): Array<[client: number, clock: number]> {
  const pending = doc.store.pendingStructs
  if (pending === null) return []
  return [...pending.missing.entries()].sort((a, b) => a[0] - b[0])
}

/**
 * Whether a received update carries structs a copy of its document lacks. A frame whose sender counter is not above
 * the highest one seen from that device can still be one that arrived late, after a later frame, and dropping it would
 * leave every later update of its writer pending.
 * @param update - the received update.
 * @param held - the state vector of the stored copy.
 * @returns true when some writer's clocks in the update reach past the copy's, or the update carries only deletions.
 */
export function addsTo(update: Uint8Array, held: Map<number, number>): boolean {
  const reach = Y.decodeStateVector(Y.encodeStateVectorFromUpdate(update))
  if (reach.size === 0) return Y.decodeUpdate(update).ds.clients.size > 0
  for (const [client, clock] of reach) if (clock > (held.get(client) ?? 0)) return true
  return false
}

/**
 * Collect deleted content while retaining the Yjs clocks, delete set, and unresolved dependencies.
 * @param updates - stored updates in application order.
 * @returns a complete update of the same document.
 */
export function compactUpdates(updates: readonly Uint8Array[]): Uint8Array {
  return compactWithMissing(updates).merged
}

/**
 * Collect deleted content like {@link compactUpdates}, and report the writer clocks the copy still waits for.
 * @param updates - stored updates in application order.
 * @returns the complete update and each writer's first missing clock, empty when nothing is pending.
 */
export function compactWithMissing(updates: readonly Uint8Array[]): { merged: Uint8Array; missing: Array<[number, number]> } {
  const doc = new Y.Doc()
  try {
    for (const update of updates) Y.applyUpdate(doc, update)
    return { merged: Y.encodeStateAsUpdate(doc), missing: missingClocks(doc) }
  } finally {
    doc.destroy()
  }
}

/**
 * Seal a logical payload in parts without exposing partial transactions to its consumers.
 * @param input - complete payload and its sender counter.
 * @param maxBytes - maximum complete encrypted frame size.
 * @returns authenticated frames in part order.
 */
export function sealParts(input: SealEnvelopeInput, maxBytes: number): Uint8Array[] {
  const whole = sealEnvelope(input)
  if (whole.length <= maxBytes) return [whole]
  const id = createHmac('sha256', contentKeyOf(input.accountKey, input.id))
    .update(`${String(maxBytes)}\0`).update(input.payload).digest('hex')
  const overhead = sealEnvelope({ ...input, payload: new Uint8Array(),
    fragment: { id, index: Number.MAX_SAFE_INTEGER, count: Number.MAX_SAFE_INTEGER },
  }).length
  const width = maxBytes - overhead
  if (width < 1) throw new Error('sync frame limit cannot hold an encrypted fragment header')
  const count = Math.ceil(input.payload.length / width)
  return Array.from({ length: count }, (_, index) => sealEnvelope({ ...input,
    payload: input.payload.subarray(index * width, (index + 1) * width), fragment: { id, index, count },
  }))
}

/**
 * Prepare an already-queued frame, including snapshots made before garbage collection was enabled.
 * @param frame - the durable encrypted frame.
 * @param accountKey - key authenticating the frame.
 * @param maxBytes - maximum encrypted transport frame size.
 * @returns transport parts preserving the original sender counter.
 */
export function prepareFrame(frame: Uint8Array, accountKey: Uint8Array, maxBytes: number): Uint8Array[] {
  if (frame.length <= maxBytes) return [frame]
  const { header, payload } = openEnvelope(frame, accountKey)
  return sealParts({ ...header, accountKey,
    payload: header.kind === 'snapshot' ? compactUpdates([payload]) : payload,
  }, maxBytes)
}
