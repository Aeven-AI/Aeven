/**
 * The account sync worker: the CPU-heavy part of applying a long history, run off the Host's event loop. It opens
 * received frames (authentication and decryption), and it compacts stored documents and seals their snapshots
 * through its own connection to the store. Every request carries the key it needs.
 */
import { parentPort } from 'node:worker_threads'
import Database from 'better-sqlite3'
import * as Y from 'yjs'
import { openEnvelope, sealEnvelope, type OpaqueId } from '@aeven/sync-vault'
import type { MaintainRequest, OpenedFrame, WorkerReply, WorkerRequest } from './offload.ts'

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

/** Merge a document's stored updates, replace them, and queue a sealed snapshot, in one transaction. */
function maintain(request: MaintainRequest): null {
  const db = connection(request.path)
  const rows = db.prepare('SELECT seq, data FROM doc_updates WHERE id = ? ORDER BY seq').all(request.doc) as Array<{ seq: number; data: Buffer }>
  const last = rows.at(-1)
  if (last === undefined) return null
  const merged = rows.length === 1 ? new Uint8Array(last.data) : Y.mergeUpdates(rows.map(row => new Uint8Array(row.data)))
  const { snapshot } = request
  const frame = snapshot === undefined
    ? undefined
    : sealEnvelope({ kind: 'snapshot', id: request.doc as OpaqueId, accountKey: snapshot.accountKey, device: snapshot.device, counter: snapshot.counter, payload: merged })
  db.transaction(() => {
    if (request.compact && rows.length > 1) {
      db.prepare('DELETE FROM doc_updates WHERE id = ? AND seq <= ?').run(request.doc, last.seq)
      db.prepare('INSERT INTO doc_updates (id, data) VALUES (?, ?)').run(request.doc, Buffer.from(merged))
    }
    if (frame !== undefined && snapshot !== undefined) {
      db.prepare('INSERT INTO outbox (frame, covers) VALUES (?, ?)').run(Buffer.from(frame), snapshot.covers)
      db.prepare('DELETE FROM since_snapshot WHERE id = ?').run(request.doc)
    }
  })()
  return null
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
    const value = request.method === 'open' ? openFrames(request) : maintain(request)
    reply = { id: request.id, ok: true, value } as WorkerReply
  } catch (error) {
    reply = { id: request.id, ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  parentPort?.postMessage(reply)
})
