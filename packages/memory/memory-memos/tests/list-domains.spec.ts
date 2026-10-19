/**
 * Listing by domain: the memory manager lists one tab's domains at a time, so a page, its offset, and the total
 * count only memories in those domains, including domains read from a workspace instead of a tag.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { openDb, runMigrations } from '@deepseek-ai/memos-local-plugin/core/storage/index.js'
import { makeTracesRepo } from '@deepseek-ai/memos-local-plugin/core/storage/repos/traces.js'
import type { StorageDb, TraceListFilter } from '@deepseek-ai/memos-local-plugin/core/storage/types.js'
import { normalizeNamespace } from '@deepseek-ai/memos-local-plugin/core/runtime/namespace.js'
import { OwnerCores } from '../src/cores.ts'
import { LlmRouteContext } from '../src/host-llm.ts'
import { MemosMemory, ownerProfile } from '../src/runtime.ts'
import { signal } from './harness.ts'

interface ListedTrace {
  readonly id: string
  readonly tags: readonly string[]
  readonly ownerWorkspaceId: string | null
  readonly ownerProfileId: string
}

const OWNER = 'owner-1'

const databases: StorageDb[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

/** Exercise the provider's page requests against MemOS's actual SQLite predicates. */
function listingCore(traces: readonly ListedTrace[]) {
  const db = openDb({ filepath: ':memory:', agent: 'memory-list-test' })
  databases.push(db)
  runMigrations(db)
  db.exec("INSERT INTO sessions(id, agent, started_at, last_seen_at) VALUES ('s', 'test', 0, 0)")
  db.exec("INSERT INTO episodes(id, session_id, started_at) VALUES ('e', 's', 0)")
  const repo = makeTracesRepo(db)
  for (const [index, trace] of traces.entries()) {
    repo.insert({
      ...trace, tags: [...trace.tags], ownerAgentKind: 'deepseek-harness',
      ts: traces.length - index, summary: trace.id, userText: '', agentText: '', sessionId: 's', episodeId: 'e',
      toolCalls: [], reflection: null, value: 0, alpha: 0, rHuman: null, priority: 0,
      vecSummary: null, vecAction: null, turnId: index, schemaVersion: 1,
    })
  }
  const calls: { limit: number; offset: number }[] = []
  const core = {
    listTraces: async (filter: TraceListFilter & { limit: number; offset: number }) => {
      calls.push({ limit: filter.limit, offset: filter.offset })
      return repo.list(filter)
    },
    countTraces: async (filter: TraceListFilter) => repo.count(filter),
  }
  return { core, calls }
}

function provider(traces: readonly ListedTrace[]) {
  const { core, calls } = listingCore(traces)
  const memory = new MemosMemory({
    cores: new OwnerCores(async () => core as never),
    routes: new LlmRouteContext(),
    toolLimits: { skills: 8, traces: 8, worldModels: 8 },
    warn: () => {},
    info: () => {},
  })
  return { memory, calls }
}

const trace = (id: string, tags: readonly string[], ownerWorkspaceId: string | null = null): ListedTrace =>
  ({ id, tags, ownerWorkspaceId, ownerProfileId: ownerProfile(OWNER) })

// Person memories sit among project and untagged ones, so a page of person memories spans several chunks.
const TRACES: readonly ListedTrace[] = [
  trace('p1', ['domain:person']),
  trace('w1', [], 'ws-1'),
  trace('p2', ['domain:person']),
  trace('x1', []),
  trace('j1', ['domain:project']),
  trace('p3', ['domain:person']),
  trace('k1', ['domain:world']),
]

describe('listing memories by domain', () => {
  it('pages and counts only the requested domains', async () => {
    const { memory } = provider(TRACES)
    const first = await memory.list({ owner: OWNER, domains: ['person'], limit: 2, offset: 0, signal })
    const second = await memory.list({ owner: OWNER, domains: ['person'], limit: 2, offset: 2, signal })
    expect(first.records.map(record => record.id)).toEqual(['p1', 'p2'])
    expect(second.records.map(record => record.id)).toEqual(['p3'])
    expect([first.total, second.total]).toEqual([3, 3])
  })

  it('counts a workspace trace without a domain tag as project, and an untagged one outside a workspace as experience', async () => {
    const { memory } = provider(TRACES)
    const project = await memory.list({ owner: OWNER, domains: ['project'], limit: 10, offset: 0, signal })
    const knowledge = await memory.list({ owner: OWNER, domains: ['world', 'experience'], limit: 10, offset: 0, signal })
    expect(project.records.map(record => record.id)).toEqual(['w1', 'j1'])
    expect(knowledge.records.map(record => record.id)).toEqual(['x1', 'k1'])
  })

  it('leaves out another profile\'s traces from the page and the total', async () => {
    const { memory } = provider([...TRACES, { ...trace('p4', ['domain:person']), ownerProfileId: ownerProfile('owner-2') }])
    const page = await memory.list({ owner: OWNER, domains: ['person'], limit: 10, offset: 0, signal })
    expect(page.records.map(record => record.id)).toEqual(['p1', 'p2', 'p3'])
    expect(page.total).toBe(3)
  })

  it('requests only the requested page instead of walking every trace', async () => {
    const { memory, calls } = provider(TRACES)
    await memory.list({ owner: OWNER, domains: ['person'], limit: 3, offset: 0, signal })
    expect(calls).toEqual([{ limit: 3, offset: 0 }])
  })

  it('uses the first valid domain tag and treats an empty domain filter as no matches', async () => {
    const { memory } = provider([trace('p', ['domain:unknown', 'domain:person', 'domain:world'])])
    const page = await memory.list({ owner: OWNER, domains: ['person'], limit: 2, offset: 0, signal })
    expect(page.records.map(record => record.id)).toEqual(['p'])
    expect(page.total).toBe(1)
    expect(await memory.list({ owner: OWNER, domains: [], limit: 2, offset: 0, signal }))
      .toEqual({ records: [], total: 0 })
  })

  it('restricts project memories to the workspace while retaining other domains', async () => {
    const cwd = '/project'
    const workspace = normalizeNamespace({ workspacePath: cwd }, 'deepseek-harness').workspaceId!
    const { memory } = provider([
      trace('mine', [], workspace), trace('other', [], 'another-workspace'), trace('person', ['domain:person']),
    ])
    const page = await memory.list({ owner: OWNER, cwd, limit: 10, offset: 0, signal })
    expect(page.records.map(record => record.id)).toEqual(['mine', 'person'])
    expect(page.total).toBe(2)
  })

  it('counts matches beyond the repository page cap without fetching every page', async () => {
    const { memory, calls } = provider(Array.from({ length: 1001 }, (_, i) => trace(`p${i}`, ['domain:person'])))
    const page = await memory.list({ owner: OWNER, domains: ['person'], limit: 2, offset: 999, signal })
    expect(page.records.map(record => record.id)).toEqual(['p999', 'p1000'])
    expect(page.total).toBe(1001)
    expect(calls).toEqual([{ limit: 2, offset: 999 }])
  })

  it('passes the core\'s page and count through when no domain is requested', async () => {
    const { memory, calls } = provider(TRACES)
    const page = await memory.list({ owner: OWNER, limit: 3, offset: 3, signal })
    expect(page.records.map(record => record.id)).toEqual(['x1', 'j1', 'p3'])
    expect(page.total).toBe(TRACES.length)
    expect(calls).toEqual([{ limit: 3, offset: 3 }])
  })
})
