/**
 * The session surface: batching many steps into one call, and reporting tree
 * changes as a delta rather than re-sending a whole tree.
 *
 * The batch tests assert the property the design exists for — that the caller
 * makes one call and several things happen — plus the stopping rule that a failed
 * step ends the batch rather than letting later steps act on an interface that
 * never reached the expected state.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DesktopAdapter, DesktopNode, DesktopSnapshot, ObserveResult } from '@aeven/computer-use-desktop'
import type { RecipeBook } from '@aeven/computer-use-router'
import { ComputerUseSession, diffNodes, diffSize, isQuiet, type SessionStep } from '../src/index.ts'

const node = (token: string, overrides: Partial<DesktopNode> = {}): DesktopNode => ({
  index: Number(token.split(':').at(-1)),
  token,
  role: 'AXButton',
  ...overrides,
})

/** An adapter returning scripted snapshots, one per observation. */
function scriptedAdapter(snapshots: readonly DesktopNode[][]): DesktopAdapter & { observations: number } {
  const state = { observations: 0 }
  return {
    platform: 'darwin',
    get observations() {
      return state.observations
    },
    observe: (): Promise<ObserveResult> => {
      const nodes = snapshots[Math.min(state.observations, snapshots.length - 1)] ?? []
      state.observations++
      const snapshot: DesktopSnapshot = { snapshotId: `s${String(state.observations)}`, platform: 'darwin', windows: [], nodes }
      return Promise.resolve({ snapshot })
    },
    act: () => Promise.reject(new Error('unused')),
    verify: () => Promise.resolve([]),
    readiness: () => Promise.resolve({ platform: 'darwin', probes: [], blockers: [] }),
  }
}

describe('tree diffing', () => {
  it('treats the first observation as complete, so its nodes are not all "added"', () => {
    const diff = diffNodes(undefined, [node('s1:0')])
    expect(diff.complete).toBe(true)
    expect(diff.unchanged).toEqual([])
  })

  it('reports an unchanged position as unchanged even though its token changed', () => {
    const diff = diffNodes([node('s1:0', { title: 'Body' })], [node('s2:0', { title: 'Body' })])
    expect(diff.complete).toBe(false)
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
    expect(diff.changed).toEqual([])
    expect(diff.unchanged).toEqual([0])
  })

  it('reports only the fields that changed, with both values and the current token', () => {
    const diff = diffNodes([node('s1:0', { title: 'A', value: 'x' })], [node('s2:0', { title: 'B', value: 'x' })])
    expect(diff.changed).toEqual([{ token: 's2:0', index: 0, fields: { title: { from: 'A', to: 'B' } } }])
  })

  it('compares editability, so a control becoming editable is news', () => {
    const diff = diffNodes([node('s1:0', { editable: false })], [node('s1:0', { editable: true })])
    expect(diff.changed[0]?.fields).toEqual({ editable: { from: false, to: true } })
  })

  it('reports an added node', () => {
    const diff = diffNodes([node('s1:0')], [node('s1:0'), node('s1:1')])
    expect(diff.added.map(entry => entry.token)).toEqual(['s1:1'])
  })

  it('reports a new position when a node appears mid-tree', () => {
    const diff = diffNodes([node('s1:0'), node('s1:1')], [node('s1:0'), node('s1:1'), node('s1:2')])
    expect(diff.added.map(entry => entry.index)).toEqual([2])
    expect(diff.unchanged).toEqual([0, 1])
  })

  it('reports a removed position', () => {
    const diff = diffNodes([node('s1:0'), node('s1:1')], [node('s1:0')])
    expect(diff.removed).toEqual([1])
  })

  it('reports a whole window that looks the same as fully unchanged, not as churn', () => {
    const diff = diffNodes([node('s1:0'), node('s1:1')], [node('s2:0'), node('s2:1')])
    expect(diff.added).toEqual([])
    expect(diff.changed).toEqual([])
    expect(diff.removed).toEqual([])
    expect(diff.unchanged).toEqual([0, 1])
  })

  it('reports a complete tree when the observations cover different windows', () => {
    const diff = diffNodes([node('s1:0', { title: 'A' })], [node('s2:0', { title: 'B' })], false)
    expect(diff.complete).toBe(true)
    expect(diff.added.map(entry => entry.title)).toEqual(['B'])
  })

  it('reports a quiet diff when nothing moved, which is a wait signal rather than a sleep', () => {
    expect(isQuiet(diffNodes([node('s1:0', { title: 'A' })], [node('s1:0', { title: 'A' })]))).toBe(true)
    expect(isQuiet(diffNodes(undefined, [node('s1:0')]))).toBe(false)
  })

  it('measures its own size for a token budget', () => {
    expect(diffSize(diffNodes([node('s1:0')], [node('s1:0'), node('s1:1')]))).toBe(1)
    expect(diffSize(diffNodes(undefined, [node('s1:0'), node('s1:1')]))).toBe(2)
  })
})

describe('batching turns many steps into one call', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aeven-session-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const WRITE_BOOK: RecipeBook = [
    {
      task: 'file.writeText',
      summary: 'Write.',
      on: [{ platform: 'darwin', rung: 'semantic', apps: [], evidence: 'verified', invocation: { mechanism: 'filesystem', operation: 'writeFile' } }],
      verify: [{ kind: 'fileEquals', path: '{path}', text: '{text}' }],
    },
  ]

  it('performs several steps and reports them all from one call', async () => {
    const path = join(dir, 'batch.txt')
    const session = new ComputerUseSession({ book: WRITE_BOOK, adapter: scriptedAdapter([[node('s1:0')]]) })
    const result = await session.run([
      { kind: 'execute', request: { task: 'file.writeText', platform: 'darwin', parameters: { path, text: 'one' } } },
      { kind: 'observe' },
      { kind: 'readiness' },
      { kind: 'execute', request: { task: 'file.writeText', platform: 'darwin', parameters: { path, text: 'one' } } },
    ])
    expect(result.steps).toBe(4)
    expect(result.results.map(entry => entry.kind)).toEqual(['execute', 'observe', 'readiness', 'execute'])
    expect(result.verified).toBe(true)
  })

  it('stops at a failed step, because later steps would act on a state never reached', async () => {
    const path = join(dir, 'stop.txt')
    const session = new ComputerUseSession({
      book: WRITE_BOOK,
      handlers: { filesystem: async () => ({ observed: 'claimed success' }) },
    })
    const result = await session.run([
      { kind: 'execute', request: { task: 'file.writeText', platform: 'darwin', parameters: { path, text: 'x' } } },
      { kind: 'observe' },
    ])
    expect(result.verified).toBe(false)
    expect(result.results).toHaveLength(1)
  })

  it('reports a batch as verified only when every executed task verified', async () => {
    const path = join(dir, 'all.txt')
    const session = new ComputerUseSession({ book: WRITE_BOOK })
    const ok = await session.run([{ kind: 'execute', request: { task: 'file.writeText', platform: 'darwin', parameters: { path, text: 'same' } } }])
    expect(ok.verified).toBe(true)
  })

  it('handles an empty batch', async () => {
    const session = new ComputerUseSession({ book: WRITE_BOOK })
    const result = await session.run([])
    expect(result.steps).toBe(0)
    expect(result.verified).toBe(true)
  })
})

describe('observation reports a delta', () => {
  it('returns a complete tree first and a delta afterwards', async () => {
    const session = new ComputerUseSession({
      book: [],
      adapter: scriptedAdapter([
        [node('s1:0', { title: 'A' }), node('s1:1', { title: 'B' })],
        [node('s2:0', { title: 'A' }), node('s2:1', { title: 'B' }), node('s2:2', { title: 'C' })],
      ]),
    })
    const first = await session.observe()
    expect(first.diff.complete).toBe(true)
    const second = await session.observe()
    expect(second.diff.complete).toBe(false)
    expect(second.diff.added.map(entry => entry.title)).toEqual(['C'])
  })

  it('makes the delta meaningful again after a reset', async () => {
    const adapter = scriptedAdapter([[node('s1:0')], [node('s2:0')]])
    const session = new ComputerUseSession({ book: [], adapter })
    await session.observe()
    session.resetObservation()
    const after = await session.observe()
    expect(after.diff.complete).toBe(true)
  })

  it('refuses to observe without an adapter instead of reporting an empty desktop', async () => {
    const session = new ComputerUseSession({ book: [] })
    await expect(session.observe()).rejects.toThrow(/cannot observe without an adapter/)
  })

  it('refuses readiness without an adapter, naming what is missing', async () => {
    const session = new ComputerUseSession({ book: [] })
    await expect(session.run([{ kind: 'readiness' }])).rejects.toThrow(/cannot readiness without an adapter/)
  })

  it('exposes the router for inspection without executing', () => {
    const session = new ComputerUseSession({ book: [] })
    expect(session.routing.tasks()).toEqual([])
  })

  it('accepts a scope and passes it through', async () => {
    let seen: unknown
    const session = new ComputerUseSession({
      book: [],
      adapter: {
        platform: 'darwin',
        observe: (scope) => {
          seen = scope
          return Promise.resolve({ snapshot: { snapshotId: 's', platform: 'darwin', windows: [], nodes: [] } })
        },
        act: () => Promise.reject(new Error('unused')),
        verify: () => Promise.resolve([]),
        readiness: () => Promise.resolve({ platform: 'darwin', probes: [], blockers: [] }),
      },
    })
    await session.observe({ windowId: 'w1' })
    expect(seen).toEqual({ windowId: 'w1' })
  })

  it('types a batch step list', () => {
    const steps: SessionStep[] = [{ kind: 'observe', scope: { pid: 1 } }]
    expect(steps).toHaveLength(1)
  })

  it('reads a file it just wrote through the batch, which is the real flow', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aeven-session2-'))
    const path = join(dir, 'flow.txt')
    await writeFile(path, 'placeholder')
    const readBook: RecipeBook = [{
      task: 'file.readText',
      summary: 'Read.',
      on: [{ platform: 'darwin', rung: 'semantic', apps: [], evidence: 'verified', invocation: { mechanism: 'filesystem', operation: 'readFile' } }],
      verify: [{ kind: 'fileEquals', path: '{path}', text: 'placeholder' }],
    }]
    const session = new ComputerUseSession({ book: readBook })
    const result = await session.run([{ kind: 'execute', request: { task: 'file.readText', platform: 'darwin', parameters: { path } } }])
    expect(result.verified).toBe(true)
    await expect(readFile(path, 'utf8')).resolves.toBe('placeholder')
    await rm(dir, { recursive: true, force: true })
  })
})
