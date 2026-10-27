/** Atomic bulk fact storage against the MemOS SQLite and embedding implementations. */
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { brandString } from '@aeven/brand'
import type { SessionId } from '@aeven/session'
import { bootstrapMemoryCore } from '@deepseek-ai/memos-local-plugin/core/index.js'
import { DEFAULT_CONFIG, resolveHome } from '@deepseek-ai/memos-local-plugin/core/config/index.js'
import { OwnerCores } from '../src/cores.ts'
import { LlmRouteContext } from '../src/host-llm.ts'
import { MEMOS_AGENT, MemosMemory, ownerProfile } from '../src/runtime.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'avn-bulk-memory-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const requests: string[][] = []
  let rejectEmbeddings = false
  const respond = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const chunks: Buffer[] = []
    for await (const chunk of request as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString()) as { input: string[] }
    requests.push(body.input)
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ data: rejectEmbeddings ? [] : body.input.map(() => ({ embedding: [1, 0, 0] })) }))
  }
  const server = createServer((request, response) => {
    respond(request, response).catch(() => { response.destroy() })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => { resolve() })
  })
  cleanup.push(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  }))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('embedding server did not bind TCP')
  const home = resolveHome(MEMOS_AGENT, root)
  const config = structuredClone(DEFAULT_CONFIG)
  config.embedding = {
    ...config.embedding, provider: 'openai_compatible', apiKey: 'test-only', model: 'bulk-test',
    endpoint: `http://127.0.0.1:${address.port}/embeddings`,
  }
  config.llm.fallbackToHost = false
  const core = await bootstrapMemoryCore({ agent: MEMOS_AGENT, home, config, autoRecovery: false })
  const memory = new MemosMemory({
    cores: new OwnerCores(async () => core), routes: new LlmRouteContext(),
    toolLimits: { skills: 0, traces: 10, worldModels: 0 }, personFactsTtlMs: 0, warn: () => {}, info: () => {},
  })
  cleanup.push(() => memory.dispose())
  const db = new Database(home.dbFile)
  cleanup.push(async () => { db.close() })
  const scope = { owner: 'bulk-owner', sessionId: brandString<SessionId>('bulk-session'), cwd: '/workspace' }
  const write = async (texts: readonly string[], signal = new AbortController().signal) =>
    (await memory.rememberMany({ scope, facts: texts.map(text => ({ text })), domain: 'person', signal })).ids
  return { core, db, requests, scope, write, rejectEmbeddings: () => { rejectEmbeddings = true } }
}

describe('bulk remembering distilled facts', () => {
  it('preserves each fact, batches embeddings, and scopes reads to the owner', async () => {
    const { core, db, requests, scope, write } = await fixture()
    const facts = ['Mira prefers jasmine tea.', 'Mira lives in Delft.', 'Mira speaks Dutch.']
    const ids = await write(facts)
    expect(ids).toHaveLength(facts.length)
    expect(requests).toEqual([facts])
    const rows = db.prepare('SELECT user_text, summary, length(vec_summary) bytes, tags_json FROM traces ORDER BY rowid').all() as { user_text: string; summary: string; bytes: number; tags_json: string }[]
    expect(rows.map(row => [row.user_text, row.summary])).toEqual(facts.map(fact => [fact, fact]))
    expect(rows.every(row => row.bytes === 12 && (JSON.parse(row.tags_json) as string[]).includes('domain:person'))).toBe(true)
    const namespace = { agentKind: MEMOS_AGENT, profileId: ownerProfile(scope.owner) }
    expect(await core.getTrace(ids[0]!, namespace)).toMatchObject({ userText: facts[0] })
    expect(await core.getTrace(ids[0]!, { ...namespace, profileId: ownerProfile('another-owner') })).toBeNull()
    expect(db.prepare("SELECT count(*) count FROM traces_fts WHERE traces_fts MATCH 'jasmine'").get()).toEqual({ count: 1 })
  })

  it('writes nothing when embeddings fail', async () => {
    const { db, write, rejectEmbeddings } = await fixture()
    rejectEmbeddings()
    await expect(write(['Mira likes tea.', 'Mira likes cycling.'])).rejects.toThrow()
    expect(db.prepare('SELECT count(*) count FROM traces').get()).toEqual({ count: 0 })
  })

  it('rolls back the whole transaction when a later insert fails', async () => {
    const { db, write } = await fixture()
    db.exec("CREATE TRIGGER reject_fact BEFORE INSERT ON traces WHEN NEW.user_text = 'reject' BEGIN SELECT RAISE(ABORT, 'rejected fact'); END")
    await expect(write(['Mira likes tea.', 'reject'])).rejects.toThrow('rejected fact')
    expect(db.prepare('SELECT count(*) count FROM traces').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT count(*) count FROM episodes').get()).toEqual({ count: 0 })
  })

  it('does not embed or write a cancelled batch', async () => {
    const { db, requests, write } = await fixture()
    await expect(write(['Mira likes tea.'], AbortSignal.abort())).rejects.toThrow()
    expect(requests).toEqual([])
    expect(db.prepare('SELECT count(*) count FROM traces').get()).toEqual({ count: 0 })
  })
})
