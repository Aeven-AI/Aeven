/** Garbage-collected Yjs state and bounded, authenticated transport parts of one logical sync payload. */
import { createHmac } from 'node:crypto'
import * as Y from 'yjs'
import { contentKeyOf, openEnvelope, sealEnvelope, type SealEnvelopeInput } from '@aeven/sync-vault'

/**
 * Collect deleted content while retaining the Yjs clocks, delete set, and unresolved dependencies.
 * @param updates - stored updates in application order.
 * @returns a complete update of the same document.
 */
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
  /** Map and key of the item covering each `client:clock`. */
  const placed = new Map<string, { map: string; key: string | null }>()
  let waiting: Y.Item[] = []
  for (const update of updates) {
    for (const struct of Y.decodeUpdate(update).structs) {
      if (struct instanceof Y.Item) waiting.push(struct)
    }
  }
  const place = (item: Y.Item, map: string, key: string | null): void => {
    for (let offset = 0; offset < item.length; offset++) placed.set(`${String(item.id.client)}:${String(item.id.clock + offset)}`, { map, key })
    const entries = found[map]
    if (key === null || entries === undefined || !(item.content instanceof Y.ContentAny)) return
    const values = entries[key] ?? []
    values.push(...(item.content.arr as unknown[]))
    entries[key] = values
  }
  for (let progressed = true; progressed && waiting.length > 0;) {
    progressed = false
    const unresolved: Y.Item[] = []
    for (const item of waiting) {
      const parent = item.parent as unknown
      const neighbour = item.origin ?? item.rightOrigin
      const known = typeof parent === 'string'
        ? { map: parent, key: item.parentSub }
        : neighbour === null ? undefined : placed.get(`${String(neighbour.client)}:${String(neighbour.clock)}`)
      if (known === undefined) {
        unresolved.push(item)
        continue
      }
      place(item, known.map, known.key)
      progressed = true
    }
    waiting = unresolved
  }
  return found
}

/**
 * Merge stored updates of one document into a single update holding its whole state.
 * @param updates - stored updates in application order.
 * @returns a complete update of the same document.
 */
export function compactUpdates(updates: readonly Uint8Array[]): Uint8Array {
  const doc = new Y.Doc()
  try {
    for (const update of updates) Y.applyUpdate(doc, update)
    return Y.encodeStateAsUpdate(doc)
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
