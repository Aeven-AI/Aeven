/** What an account's memory costs after a Host start: the saved vector index and the saved person listing. */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, resolveHome } from '@deepseek-ai/memos-local-plugin/core/config/index.js'
import { bootstrapMemoryCore } from '@deepseek-ai/memos-local-plugin/core/index.js'
import { openDb } from '@deepseek-ai/memos-local-plugin/core/storage/connection.js'
import { indexedTopK } from '@deepseek-ai/memos-local-plugin/core/storage/vector-index.js'
import { OwnerCores } from '../src/cores.ts'
import { LlmRouteContext } from '../src/host-llm.ts'
import { MEMOS_AGENT, MemosMemory } from '../src/runtime.ts'
import { fakeCore } from './harness.ts'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'avn-restart-cost-'))
  cleanup.push(() => { rmSync(root, { recursive: true, force: true }) })
  return root
}

/** A migrated memory database with one session and episode; returns its file and a writer of raw rows. */
async function database(): Promise<{ file: string; raw: Database.Database }> {
  const root = temporaryRoot()
  const config = structuredClone(DEFAULT_CONFIG)
  config.llm.fallbackToHost = false
  config.embedding = { ...config.embedding, provider: 'openai_compatible', apiKey: 'unused', model: 'unused', endpoint: 'http://127.0.0.1:9/e' }
  const home = resolveHome(MEMOS_AGENT, root)
  const core = await bootstrapMemoryCore({ agent: MEMOS_AGENT, home, config, autoRecovery: false, initLogging: false })
  await core.init()
  await core.shutdown()
  const raw = new Database(home.dbFile)
  cleanup.push(() => { raw.close() })
  raw.prepare('INSERT INTO sessions (id, agent, started_at, last_seen_at) VALUES (\'s1\', ?, 0, 0)').run(MEMOS_AGENT)
  raw.prepare('INSERT INTO episodes (id, session_id, started_at, status) VALUES (\'closed-ep\', \'s1\', 0, \'closed\'), (\'open-ep\', \'s1\', 0, \'open\')').run()
  return { file: home.dbFile, raw }
}

function vector(...values: number[]): Buffer {
  return Buffer.from(new Float32Array(values).buffer)
}

function insertTrace(raw: Database.Database, id: string, vec: Buffer): void {
  raw.prepare(`INSERT INTO traces (id, episode_id, session_id, ts, user_text, agent_text, turn_id, vec_summary)
    VALUES (@id, 'closed-ep', 's1', 0, 'u', 'a', 1, @vec)`).run({ id, vec })
}

function search(file: string, query: number[]): string[] {
  // A new connection stands in for a restarted process: the index keeps its entries per connection.
  const db = openDb({ filepath: file, agent: MEMOS_AGENT })
  try {
    return indexedTopK(db, 'traces', [], Float32Array.from(query), 2, { vecColumn: 'vec_summary' }).map(hit => hit.id)
  } finally {
    db.close()
  }
}

describe('the saved vector index', () => {
  it('restores after a restart without rebuilding, and reads rows added since', async () => {
    const { file, raw } = await database()
    insertTrace(raw, 'east', vector(1, 0, 0))
    insertTrace(raw, 'north', vector(0, 1, 0))
    expect(search(file, [1, 0, 0])[0]).toBe('east')
    const saved = `${file}-vectors/traces.vec_summary.bin`
    expect(existsSync(saved)).toBe(true)
    const written = statSync(saved).mtimeMs
    insertTrace(raw, 'up', vector(0, 0, 1))
    // A restore reads the file and the new row; it does not rebuild, so the file is not rewritten.
    expect(search(file, [0, 0, 1])[0]).toBe('up')
    expect(statSync(saved).mtimeMs).toBe(written)
  })

  it('rebuilds when another connection rewrote a vector in place while no process held the index', async () => {
    const { file, raw } = await database()
    insertTrace(raw, 'east', vector(1, 0, 0))
    insertTrace(raw, 'north', vector(0, 1, 0))
    expect(search(file, [1, 0, 0])[0]).toBe('east')
    // The trigger counts this write, so the saved file no longer matches the table.
    raw.prepare('UPDATE traces SET vec_summary = ? WHERE id = \'north\'').run(vector(1, 0, 0.01))
    raw.prepare('UPDATE traces SET vec_summary = ? WHERE id = \'east\'').run(vector(0, 1, 0))
    expect(search(file, [1, 0, 0])[0]).toBe('north')
  })

  it('keeps the saved index when an upsert sets the same vector again, as memory sync does', async () => {
    const { file, raw } = await database()
    insertTrace(raw, 'east', vector(1, 0, 0))
    expect(search(file, [1, 0, 0])).toEqual(['east'])
    const saved = `${file}-vectors/traces.vec_summary.bin`
    const written = statSync(saved).mtimeMs
    raw.prepare(`INSERT INTO traces (id, episode_id, session_id, ts, user_text, agent_text, turn_id, vec_summary)
      VALUES ('east', 'closed-ep', 's1', 0, 'u', 'edited', 1, @vec)
      ON CONFLICT (id) DO UPDATE SET agent_text = excluded.agent_text, vec_summary = excluded.vec_summary`).run({ vec: vector(1, 0, 0) })
    expect(search(file, [1, 0, 0])).toEqual(['east'])
    expect(statSync(saved).mtimeMs).toBe(written)
  })

  it('replaces a torn file instead of reading it', async () => {
    const { file, raw } = await database()
    insertTrace(raw, 'east', vector(1, 0, 0))
    expect(search(file, [1, 0, 0])).toEqual(['east'])
    const saved = `${file}-vectors/traces.vec_summary.bin`
    writeFileSync(saved, readFileSync(saved).subarray(0, 40))
    expect(search(file, [1, 0, 0])).toEqual(['east'])
    expect(statSync(saved).size).toBeGreaterThan(40)
  })
})

describe('the saved person listing', () => {
  it('serves the previous run\'s listing at once after a start and refreshes it in the background', async () => {
    const root = temporaryRoot()
    const file = join(root, 'person-facts.json')
    const fact = (id: string, summary: string) => ({ refId: id, id, ts: 1_000, tags: ['domain:person'], userText: summary, summary })
    const memory = (listTraces: () => Promise<readonly ReturnType<typeof fact>[]>) => {
      const created = new MemosMemory({
        cores: new OwnerCores(async () => ({ ...fakeCore([], { listTraces }), shutdown: async () => {} }) as never),
        routes: new LlmRouteContext(),
        toolLimits: { skills: 0, traces: 10, worldModels: 0 }, personFactsTtlMs: 60_000, personFactsFile: () => file,
        warn: () => {}, info: () => {},
      })
      cleanup.push(() => created.dispose())
      return created
    }
    const signal = new AbortController().signal
    const first = memory(async () => [fact('a', 'Mira was born on 3 March 1990.')])
    expect((await first.profile({ scope: { owner: 'o', sessionId: 's' as never }, signal })).dates.length).toBe(1)
    expect((JSON.parse(readFileSync(file, 'utf8')) as { facts: unknown[] }).facts).toHaveLength(1)

    let release: (value: readonly ReturnType<typeof fact>[]) => void = () => {}
    const second = memory(() => new Promise((resolve) => { release = resolve }))
    // The listing has not answered, yet the saved one is served.
    const served = await second.profile({ scope: { owner: 'o', sessionId: 's' as never }, signal })
    expect(served.dates.length).toBe(1)
    release([fact('a', 'Mira was born on 3 March 1990.'), fact('b', 'Noor was born on 9 July 1985.')])
    await expect.poll(() => (JSON.parse(readFileSync(file, 'utf8')) as { facts: unknown[] }).facts.length).toBe(2)
  })

  it('drops the saved listing when a memory is forgotten, and discards a listing that started before', async () => {
    const root = temporaryRoot()
    const file = join(root, 'person-facts.json')
    const fact = (id: string, summary: string) => ({ refId: id, id, ts: 1_000, tags: ['domain:person'], userText: summary, summary })
    let listed: readonly ReturnType<typeof fact>[] = [fact('a', 'Mira was born on 3 March 1990.')]
    // While set, a listing that started waits on it before answering with what it read.
    let gate: Promise<void> | undefined
    let open = (): void => {}
    const owned = { ownerProfileId: '' }
    const created = new MemosMemory({
      cores: new OwnerCores(async () => ({
        ...fakeCore([], {
          listTraces: async () => {
            const snapshot = listed
            if (gate !== undefined) await gate
            return snapshot
          },
        }),
        getTrace: async () => owned,
        deleteTrace: async () => { listed = []; return { deleted: true } },
        shutdown: async () => {},
      }) as never),
      routes: new LlmRouteContext(),
      toolLimits: { skills: 0, traces: 10, worldModels: 0 }, personFactsTtlMs: 0, personFactsFile: () => file,
      warn: () => {}, info: () => {},
    })
    cleanup.push(() => created.dispose())
    const { ownerProfile } = await import('../src/runtime.ts')
    owned.ownerProfileId = ownerProfile('o')
    const signal = new AbortController().signal
    await created.profile({ scope: { owner: 'o', sessionId: 's' as never }, signal })
    expect(existsSync(file)).toBe(true)
    // A listing that read the memory before it was forgotten is held open while the memory is forgotten.
    gate = new Promise((resolve) => { open = resolve })
    const reading = created.profile({ scope: { owner: 'o', sessionId: 's' as never }, signal })
    await created.forget({ owner: 'o', id: 'a' as never, signal })
    expect(existsSync(file)).toBe(false)
    gate = undefined
    open()
    await reading
    expect(existsSync(file)).toBe(false)
    const after = await created.profile({ scope: { owner: 'o', sessionId: 's' as never }, signal })
    expect(after.dates).toEqual([])
    expect((JSON.parse(readFileSync(file, 'utf8')) as { facts: unknown[] }).facts).toEqual([])
  })
})
