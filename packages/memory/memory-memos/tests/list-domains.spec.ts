/**
 * Listing by domain: the memory manager lists one tab's domains at a time, so a page, its offset, and the total
 * count only memories in those domains, including domains read from a workspace instead of a tag.
 */
import { describe, expect, it } from 'vitest'
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

/**
 * A core whose listing pages through the given traces, newest first as given, and records each page it served.
 * @param traces - every trace the owner's listing matches.
 * @returns the core and the `{ limit, offset }` of each listing call.
 */
function listingCore(traces: readonly ListedTrace[]) {
  const calls: { limit: number; offset: number }[] = []
  const core = {
    listTraces: async ({ limit, offset }: { limit: number; offset: number }) => {
      calls.push({ limit, offset })
      return traces.slice(offset, offset + limit).map(trace => ({
        ...trace, ts: 0, summary: trace.id, userText: '', agentText: '', sessionId: 's', episodeId: 'e',
      }))
    },
    countTraces: async () => traces.length,
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

  it('reads the listing in page-sized chunks until a short chunk ends it', async () => {
    const { memory, calls } = provider(TRACES)
    await memory.list({ owner: OWNER, domains: ['person'], limit: 3, offset: 0, signal })
    expect(calls).toEqual([{ limit: 3, offset: 0 }, { limit: 3, offset: 3 }, { limit: 3, offset: 6 }])
  })

  it('passes the core\'s page and count through when no domain is requested', async () => {
    const { memory, calls } = provider(TRACES)
    const page = await memory.list({ owner: OWNER, limit: 3, offset: 3, signal })
    expect(page.records.map(record => record.id)).toEqual(['x1', 'j1', 'p3'])
    expect(page.total).toBe(TRACES.length)
    expect(calls).toEqual([{ limit: 3, offset: 3 }])
  })
})
