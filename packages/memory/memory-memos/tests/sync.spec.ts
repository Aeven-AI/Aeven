/**
 * Account memory across two devices on MemOS's real schema: every write path is published through the
 * triggers, rows land on the other device without echoing back, a delete wins over a concurrent edit,
 * vectors cross only between devices on the same embedding model, and full-text search sees synced rows.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDb, runMigrations } from '@deepseek-ai/memos-local-plugin/core/storage/index.js'
import { MemorySyncNetwork, type MemorySyncDevice } from '../../../sync/sync/tests/memory.ts'
import { MemorySyncMirror } from '../src/sync.ts'

const OWNER = 'owner-1'
const MODEL = 'model-a'
const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

/** A MemOS database with the current schema, and a MemOS-like connection to write it. */
function memos(): { file: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'memory-sync-'))
  const file = join(dir, 'memos.db')
  const created = openDb({ filepath: file, agent: 'memory-sync-test' })
  runMigrations(created)
  created.close()
  const db = new Database(file)
  db.pragma('foreign_keys = ON')
  cleanups.push(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return { file, db }
}

function mirror(device: MemorySyncDevice, file: string, model = MODEL): { mirror: MemorySyncMirror; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn()
  const created = new MemorySyncMirror(OWNER, file, device.asSync(), model, { drainMs: 20, drainBatch: 100 }, warn)
  device.documentChanged = (id) => { created.documentChanged(id) }
  cleanups.push(() => { created.dispose() })
  return { mirror: created, warn }
}

function insertTrace(db: Database.Database, id: string, summary: string, vector?: Buffer): void {
  db.prepare("INSERT OR IGNORE INTO sessions (id, agent, started_at, last_seen_at) VALUES ('11111111-aaaa', 'test', 0, 0)").run()
  db.prepare("INSERT OR IGNORE INTO episodes (id, session_id, started_at) VALUES ('ep_episode0001', '11111111-aaaa', 0)").run()
  db.prepare(`INSERT INTO traces (id, episode_id, session_id, ts, user_text, agent_text, summary, turn_id, vec_summary)
    VALUES (?, 'ep_episode0001', '11111111-aaaa', 1, ?, 'answer', ?, 1, ?)`).run(id, `question about ${summary}`, summary, vector ?? null)
}

const summaryOf = (db: Database.Database, id: string): unknown => (db.prepare('SELECT summary FROM traces WHERE id = ?').get(id) as { summary?: unknown } | undefined)?.summary

describe('memory sync', () => {
  it('publishes existing memory, applies it on the other device, and carries edits, inserts, and deletes both ways', async () => {
    const network = new MemorySyncNetwork()
    const a = network.device()
    const b = network.device()
    const homeA = memos()
    const homeB = memos()
    const vector = Buffer.from(new Float32Array([0.25, 0.5, 0.75]).buffer)
    insertTrace(homeA.db, 'tr_aa11111111', 'the user lives in Amsterdam', vector)
    const mirrorB = mirror(b, homeB.file)
    await mirrorB.mirror.start()
    const mirrorA = mirror(a, homeA.file)
    await mirrorA.mirror.start()

    await vi.waitFor(() => { expect(summaryOf(homeB.db, 'tr_aa11111111')).toBe('the user lives in Amsterdam') })
    const copied = homeB.db.prepare('SELECT vec_summary, episode_id FROM traces WHERE id = ?').get('tr_aa11111111') as { vec_summary: Buffer; episode_id: string }
    expect(Buffer.compare(copied.vec_summary, vector)).toBe(0)
    expect(homeB.db.prepare('SELECT id FROM episodes').all()).toEqual([{ id: 'ep_episode0001' }])
    expect(homeB.db.prepare("SELECT COUNT(*) AS n FROM traces_fts WHERE traces_fts MATCH 'Amsterdam'").get()).toEqual({ n: 1 })
    expect(homeB.db.prepare('SELECT COUNT(*) AS n FROM sync_changes').get()).toEqual({ n: 0 })

    homeA.db.prepare('UPDATE traces SET summary = ? WHERE id = ?').run('the user moved to Utrecht', 'tr_aa11111111')
    await vi.waitFor(() => { expect(summaryOf(homeB.db, 'tr_aa11111111')).toBe('the user moved to Utrecht') })

    insertTrace(homeB.db, 'tr_bb22222222', 'the user has a daughter')
    await vi.waitFor(() => { expect(summaryOf(homeA.db, 'tr_bb22222222')).toBe('the user has a daughter') })

    homeA.db.prepare('DELETE FROM traces WHERE id = ?').run('tr_aa11111111')
    await vi.waitFor(() => { expect(summaryOf(homeB.db, 'tr_aa11111111')).toBeUndefined() })
    expect(mirrorA.warn).not.toHaveBeenCalled()
    expect(mirrorB.warn).not.toHaveBeenCalled()
  })

  it('lets a delete win over an edit made while one device was offline', async () => {
    const network = new MemorySyncNetwork()
    const a = network.device()
    const b = network.device()
    const homeA = memos()
    const homeB = memos()
    insertTrace(homeA.db, 'tr_cc33333333', 'original')
    await mirror(b, homeB.file).mirror.start()
    await mirror(a, homeA.file).mirror.start()
    await vi.waitFor(() => { expect(summaryOf(homeB.db, 'tr_cc33333333')).toBe('original') })
    b.setState('offline')
    homeB.db.prepare('UPDATE traces SET summary = ? WHERE id = ?').run('edited offline', 'tr_cc33333333')
    homeA.db.prepare('DELETE FROM traces WHERE id = ?').run('tr_cc33333333')
    await new Promise(resolve => setTimeout(resolve, 60))
    b.setState('online')
    await vi.waitFor(() => {
      expect(summaryOf(homeA.db, 'tr_cc33333333')).toBeUndefined()
      expect(summaryOf(homeB.db, 'tr_cc33333333')).toBeUndefined()
    })
  })

  it('keeps its own vectors when the other device runs another embedding model', async () => {
    const network = new MemorySyncNetwork()
    const a = network.device()
    const b = network.device()
    const homeA = memos()
    const homeB = memos()
    insertTrace(homeA.db, 'tr_dd44444444', 'vectors', Buffer.from([1, 2, 3, 4]))
    await mirror(b, homeB.file, 'model-b').mirror.start()
    await mirror(a, homeA.file).mirror.start()
    await vi.waitFor(() => { expect(summaryOf(homeB.db, 'tr_dd44444444')).toBe('vectors') })
    expect(homeB.db.prepare('SELECT vec_summary FROM traces WHERE id = ?').get('tr_dd44444444')).toEqual({ vec_summary: null })
  })

  it('writes nothing when a shard it already applied arrives again', async () => {
    const network = new MemorySyncNetwork()
    const a = network.device()
    const b = network.device()
    const homeA = memos()
    const homeB = memos()
    insertTrace(homeA.db, 'tr_ff66666666', 'stable')
    const mirrorB = mirror(b, homeB.file)
    await mirrorB.mirror.start()
    await mirror(a, homeA.file).mirror.start()
    await vi.waitFor(() => { expect(summaryOf(homeB.db, 'tr_ff66666666')).toBe('stable') })
    homeB.db.exec('CREATE TABLE writes (n INTEGER); CREATE TRIGGER count_writes AFTER UPDATE ON traces BEGIN INSERT INTO writes VALUES (1); END;')
    mirrorB.mirror.documentChanged('id:memory/traces/ff')
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(homeB.db.prepare('SELECT COUNT(*) AS n FROM writes').get()).toEqual({ n: 0 })
  })

  it('seeds existing rows only once per device', async () => {
    const network = new MemorySyncNetwork()
    const home = memos()
    insertTrace(home.db, 'tr_ee55555555', 'seeded')
    const first = mirror(network.device(), home.file)
    await first.mirror.start()
    await vi.waitFor(() => { expect(home.db.prepare('SELECT COUNT(*) AS n FROM sync_changes').get()).toEqual({ n: 0 }) })
    first.mirror.dispose()
    const second = mirror(network.device(), home.file)
    await second.mirror.start()
    expect(home.db.prepare("SELECT value FROM sync_state WHERE key = 'seeded'").get()).toEqual({ value: '1' })
    expect(home.db.prepare('SELECT COUNT(*) AS n FROM sync_changes').get()).toEqual({ n: 0 })
  })

  it('reports documents it cannot open or rows it cannot apply, and ignores documents it does not own', async () => {
    const network = new MemorySyncNetwork()
    const home = memos()
    const device = network.device()
    const sync = device.asSync()
    const { warn } = mirror(device, home.file)
    const failing = new MemorySyncMirror(OWNER, home.file, { documentId: (owner: string, name: string) => sync.documentId(owner, name), openDocument: () => Promise.reject(new Error('locked')) } as never, MODEL, { drainMs: 20, drainBatch: 100 }, warn)
    cleanups.push(() => { failing.dispose() })
    failing.documentChanged('id:memory/traces/aa')
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('memory sync: opening memory/traces/aa failed: Error: locked') })
    failing.documentChanged('id:settings/account')

    const handle = await sync.openDocument(OWNER, 'memory/traces/zz')
    handle.doc.getMap('rows').set('["tr_zz99999999"]', { id: 'tr_zz99999999', episode_id: 'e', session_id: 's', ts: 'not a number', user_text: '', agent_text: '', turn_id: 1 })
    const own = new MemorySyncMirror(OWNER, home.file, sync, MODEL, { drainMs: 20, drainBatch: 100 }, warn)
    cleanups.push(() => { own.dispose() })
    own.documentChanged('id:memory/traces/zz')
    own.documentChanged('id:memory/traces/zz')
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^memory sync: applying memory\/traces\/zz failed/)) })
    await failing.drain()
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^memory sync: publishing changes failed/))
  })
})
