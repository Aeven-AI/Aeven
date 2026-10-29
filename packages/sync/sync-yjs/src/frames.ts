/** Garbage-collected Yjs state and bounded, authenticated transport parts of one logical sync payload. */
import { createHmac } from 'node:crypto'
import * as Y from 'yjs'
import { contentKeyOf, openEnvelope, sealEnvelope, type SealEnvelopeInput } from '@aeven/sync-vault'

/**
 * Collect deleted content while retaining the Yjs clocks, delete set, and unresolved dependencies.
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
