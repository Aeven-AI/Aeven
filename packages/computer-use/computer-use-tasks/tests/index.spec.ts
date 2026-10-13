/**
 * Reading a task set from disk.
 *
 * The properties under test are the ones that decide whether a catalog is worth
 * trusting: an entry the walk cannot stat is skipped rather than aborting the
 * walk, a file it cannot read is reported with the reason rather than dropped,
 * and JSON that carries no task is skipped rather than counted as one.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { listJsonFiles, readTaskFile, readTaskSet } from '../src/index.ts'

/** A MacAgentBench-shaped task, trimmed to the fields the reader reads. */
const TASK = {
  id: '1_1',
  instruction: 'In the Calendar App, create an event called Lab Meeting.',
  related_apps: ['calendar'],
}

/**
 * The failures the filesystem double injects, and the basenames that trigger them.
 *
 * Hoisted above the `vi.mock` factory, which runs before this module's own consts.
 */
const fsDouble = vi.hoisted(() => ({
  /** Basename whose `statSync` fails, standing in for an entry that vanished mid-walk. */
  lost: 'lost.json',
  /** Whether `statSync` currently fails for `lost`. */
  loseEntries: false,
}))

// `statSync` and `readFileSync` failures are the two ways an entry reaches the
// reader already lost — a dangling link, a permission the process lacks, or a
// file removed between the directory read and the walk — so the double injects
// them for one named entry instead of depending on a platform that allows them.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    statSync: ((path: string, ...rest: unknown[]) => {
      if (fsDouble.loseEntries && path.endsWith(fsDouble.lost)) {
        throw new Error('simulated: the entry is no longer there')
      }
      return (actual.statSync as unknown as (inner: string, ...more: unknown[]) => unknown)(path, ...rest)
    }) as typeof actual.statSync,
  }
})

describe('reading a task set from a directory', () => {
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'aeven-task-read-'))
    await mkdir(join(root, 'nested'), { recursive: true })
    await writeFile(join(root, 'task.json'), JSON.stringify(TASK))
    await writeFile(join(root, 'nested', 'nested.json'), JSON.stringify({ ...TASK, id: '2_1' }))
    await writeFile(join(root, fsDouble.lost), JSON.stringify({ ...TASK, id: '3_1' }))
    await writeFile(join(root, 'fourth.json'), JSON.stringify({ ...TASK, id: '4_1' }))
    // JSON that parses but carries no task, and a file that is not JSON at all.
    await writeFile(join(root, 'list.json'), '[]')
    await writeFile(join(root, 'number.json'), '42')
    await writeFile(join(root, 'empty.json'), 'null')
    await writeFile(join(root, 'notes.txt'), 'not a task file')
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  /** The walked files as paths relative to the root, so assertions read as names. */
  const relative = (files: readonly string[]): string[] => files.map(file => file.slice(root.length + 1))

  it('lists the json files it reaches at every depth, and nothing else', () => {
    const names = relative(listJsonFiles(root))
    expect(names).toContain('task.json')
    expect(names).toContain(join('nested', 'nested.json'))
    expect(names).not.toContain('notes.txt')
  })

  it('skips an entry it cannot stat and keeps walking the entries after it', () => {
    fsDouble.loseEntries = true
    try {
      const names = relative(listJsonFiles(root))
      expect(names).not.toContain(fsDouble.lost)
      expect(names).toContain('task.json')
    } finally {
      fsDouble.loseEntries = false
    }
  })

  it('reads every task it finds, and skips json that is not a task', () => {
    const result = readTaskSet(root, 'macagentbench')
    expect(result.intents.map(intent => intent.id).sort()).toEqual(['1_1', '2_1', '3_1', '4_1'])
    expect(result.failures).toEqual([])
    for (const name of ['list.json', 'number.json', 'empty.json']) {
      const skipped = readTaskFile(join(root, name), 'macagentbench')
      expect(skipped.skipped).toBe('not a JSON object')
      expect(skipped.failure).toBeUndefined()
    }
  })

  it('reports a file it cannot read, so a gap is never silent', () => {
    const result = readTaskFile(join(root, 'missing.json'), 'macagentbench')
    expect(result.intent).toBeUndefined()
    expect(result.failure).toContain('ENOENT')
  })

  it('reports a read failure with the reason the filesystem gave', () => {
    // A real ENOENT: a file the walk named but that is absent by the time it is read.
    const result = readTaskFile(join(root, 'absent.json'), 'macagentbench')
    expect(result.failure).toMatch(/ENOENT/)
  })

  it('reports a parse failure rather than dropping the file', async () => {
    // Its own directory: a malformed file inside the walked root is itself a
    // reported failure, which the task-set case above asserts stays empty.
    const dir = await mkdtemp(join(tmpdir(), 'aeven-task-broken-'))
    try {
      const path = join(dir, 'broken.json')
      await writeFile(path, '{ not json')
      const result = readTaskFile(path, 'macagentbench')
      expect(result.failure).toBeTruthy()
      expect(result.intent).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
