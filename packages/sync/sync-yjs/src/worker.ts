/**
 * The account sync worker: the CPU-heavy part of applying a long history, run off the Host's event loop. It opens
 * received frames (authentication and decryption), and it compacts stored documents and seals their snapshots
 * through its own connection to the store. Every request carries the key it needs.
 */
import { parentPort } from 'node:worker_threads'
import Database from 'better-sqlite3'
import { openEnvelope, sealEnvelope, type OpaqueId } from '@aeven/sync-vault'
import { compactWithMissing, counterFloor, mapEntries, missingFrom, NEXT_COUNTER_SQL, prepareFrame } from './frames.ts'
import type { MaintainRequest, OpenedFrame, ReconcileRequest, WorkerReply, WorkerRequest } from './offload.ts'

const connections = new Map<string, Database.Database>()

function connection(path: string): Database.Database {
  let db = connections.get(path)
  if (db === undefined) {
    db = new Database(path, { fileMustExist: true })
    db.pragma('busy_timeout = 5000')
    db.pragma('synchronous = NORMAL')
    connections.set(path, db)
  }
  return db
}

/**
 * Merge a document's stored updates, replace them, and queue a sealed snapshot, in one transaction. A copy that waits
 * for a missing update queues no snapshot: the snapshot's `covers` would let the relay delete the frames that carry
 * the missing update for the other devices too.
 * @returns each writer's first missing clock, empty when the copy is complete.
 */
function maintain(request: MaintainRequest): Array<[number, number]> {
  const db = connection(request.path)
  const rows = db.prepare('SELECT seq, data FROM doc_updates WHERE id = ? ORDER BY seq').all(request.doc) as Array<{ seq: number; data: Buffer }>
  const last = rows.at(-1)
  if (last === undefined) return []
  const { merged, missing } = compactWithMissing(rows.map(row => new Uint8Array(row.data)))
  const snapshot = missing.length === 0 ? request.snapshot : undefined
  db.transaction(() => {
    if (request.compact && rows.length > 1) {
      db.prepare('DELETE FROM doc_updates WHERE id = ? AND seq <= ?').run(request.doc, last.seq)
      db.prepare('INSERT INTO doc_updates (id, data) VALUES (?, ?)').run(request.doc, Buffer.from(merged))
    }
    if (snapshot !== undefined) {
      // Counter allocation and queue insertion share the write transaction with concurrent Host updates.
      const { counter } = db.prepare(NEXT_COUNTER_SQL).get(request.doc, counterFloor(Date.now())) as { counter: number }
      const frame = sealEnvelope({ kind: 'snapshot', id: request.doc as OpaqueId, accountKey: snapshot.accountKey,
        device: snapshot.device, counter, payload: merged,
      })
      db.prepare('INSERT INTO outbox (frame, covers) VALUES (?, ?)').run(Buffer.from(frame), snapshot.covers)
      db.prepare('DELETE FROM since_snapshot WHERE id = ?').run(request.doc)
    }
  })()
  return missing
}

/**
 * Queue, as one update frame, what this device's stored copy of a document holds and the relay's copy lacks.
 * @param request - the store, the document, the relay copy's updates, and the seal input.
 * @returns whether a frame was queued.
 */
function reconcile(request: ReconcileRequest): boolean {
  const db = connection(request.path)
  const rows = db.prepare('SELECT data FROM doc_updates WHERE id = ? ORDER BY seq').all(request.doc) as Array<{ data: Buffer }>
  if (rows.length === 0) return false
  const missing = missingFrom(rows.map(row => new Uint8Array(row.data)), request.held)
  if (missing === undefined) return false
  db.transaction(() => {
    const { counter } = db.prepare(NEXT_COUNTER_SQL).get(request.doc, counterFloor(Date.now())) as { counter: number }
    const frame = sealEnvelope({ kind: 'update', id: request.doc as OpaqueId, accountKey: request.accountKey,
      device: request.device, counter, payload: missing,
    })
    db.prepare('INSERT INTO outbox (frame) VALUES (?)').run(Buffer.from(frame))
  })()
  return true
}

/** Read the values a document's stored updates wrote under each key of some root maps, without integrating them. */
function entries(request: Extract<WorkerRequest, { method: 'entries' }>): Record<string, Record<string, unknown[]>> {
  const rows = connection(request.path).prepare('SELECT data FROM doc_updates WHERE id = ? ORDER BY seq').all(request.doc) as Array<{ data: Buffer }>
  return mapEntries(rows.map(row => new Uint8Array(row.data)), request.maps)
}

/** Open frames in order; a frame that cannot be opened is reported, not thrown. */
function openFrames(request: Extract<WorkerRequest, { method: 'open' }>): OpenedFrame[] {
  return request.frames.map(({ seq, frame }) => {
    try {
      const opened = openEnvelope(frame, request.accountKey)
      return { seq, header: opened.header, payload: opened.payload }
    } catch (error) {
      return { seq, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

parentPort?.on('message', (request: WorkerRequest) => {
  let reply: WorkerReply
  try {
    const value = request.method === 'open' ? openFrames(request)
      : request.method === 'prepare' ? prepareFrame(request.frame, request.accountKey, request.maxBytes)
        : request.method === 'entries' ? entries(request)
          : request.method === 'reconcile' ? reconcile(request)
            : maintain(request)
    reply = { id: request.id, ok: true, value }
  } catch (error) {
    reply = { id: request.id, ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  parentPort?.postMessage(reply)
})
