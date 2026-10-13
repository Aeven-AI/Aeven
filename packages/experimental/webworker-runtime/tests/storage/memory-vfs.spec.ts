/**
 * The identity, timestamp, link, mutation, and durability-sink guarantees
 * MemoryVfs owes its consumers, asserted directly rather than through the
 * `node:fs` bridge.
 *
 * `avn-fs-local` builds a version token from `dev:ino:size:mtimeNs:ctimeNs` and
 * refuses a write whose token moved since it read. Two properties carry that:
 * `ino` identifies the entry at a path, and `mtimeMs` moves on every write. The
 * timestamp cases freeze the clock, because these writes are in memory and two
 * revisions routinely land in the same millisecond — a real-clock test passes
 * whether or not the strict increment exists.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryVfs } from '../../src/storage/memory.ts'
import type { VfsBigIntStats, VfsMutation, VfsMutationSink, VfsStats } from '../../src/storage/types.ts'

const identity = (vfs: MemoryVfs, path: string): bigint =>
  (vfs.statSync(path, { bigint: true }) as VfsBigIntStats).ino

const linkCount = (vfs: MemoryVfs, path: string): bigint =>
  (vfs.statSync(path, { bigint: true }) as VfsBigIntStats).nlink

const modified = (vfs: MemoryVfs, path: string): number => (vfs.statSync(path) as VfsStats).mtimeMs

afterEach(() => { vi.restoreAllMocks() })

describe('entry identity', () => {
  it('distinguishes paths and holds each identity across repeated stats', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/avn/one.txt', 'one')
    vfs.seed('/avn/two.txt', 'two')
    const first = identity(vfs, '/avn/one.txt')
    expect(identity(vfs, '/avn/two.txt')).not.toBe(first)
    expect(identity(vfs, '/avn/one.txt')).toBe(first)
  })

  it('forgets the identities under a directory removed as a subtree', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/avn/skills/git/SKILL.md', '# git\n')
    const before = identity(vfs, '/avn/skills/git/SKILL.md')
    vfs.rmSync('/avn/skills', { recursive: true })
    vfs.seed('/avn/skills/git/SKILL.md', '# git rebuilt\n')
    expect(identity(vfs, '/avn/skills/git/SKILL.md')).not.toBe(before)
  })

  it('moves the source identity when a file replaces another path', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/avn/from.txt', 'moved')
    vfs.seed('/avn/to.txt', 'replaced')
    const [source, destination] = [identity(vfs, '/avn/from.txt'), identity(vfs, '/avn/to.txt')]
    vfs.renameSync('/avn/from.txt', '/avn/to.txt')
    const renamed = identity(vfs, '/avn/to.txt')
    expect(vfs.readFileSync('/avn/to.txt', 'utf8')).toBe('moved')
    expect([renamed === source, renamed === destination]).toEqual([true, false])
  })
})

describe('modification time', () => {
  it('hydrates explicit metadata without confusing timestamps with permission bits', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/avn/restored', 'value', { mode: 0o600, mtimeMs: 1_600_000_000_000 })
    vfs.seedDirectory('/avn/restored-directory', { mode: 0o700, mtimeMs: 1_600_000_000_001 })
    const stats = vfs.statSync('/avn/restored') as VfsStats
    const directory = vfs.statSync('/avn/restored-directory') as VfsStats
    expect([stats.mode & 0o777, stats.mtimeMs]).toEqual([0o600, 1_600_000_000_000])
    expect([directory.mode & 0o777, directory.mtimeMs]).toEqual([0o700, 1_600_000_000_001])
  })

  it('advances on every write even while the clock stands still', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const vfs = new MemoryVfs()
    vfs.seed('/avn/log.jsonl', 'first\n')
    const seeded = modified(vfs, '/avn/log.jsonl')
    vfs.writeFileSync('/avn/log.jsonl', 'second\n')
    const written = modified(vfs, '/avn/log.jsonl')
    vfs.appendFileSync('/avn/log.jsonl', 'third\n')
    const appended = modified(vfs, '/avn/log.jsonl')
    vfs.truncateSync('/avn/log.jsonl', 6)
    const truncated = modified(vfs, '/avn/log.jsonl')
    expect([written > seeded, appended > written, truncated > appended]).toEqual([true, true, true])
    // One millisecond per revision: the increment is the minimum that separates
    // two tokens, not a coarser bump that would skew a real timestamp.
    expect(truncated - seeded).toBe(3)
  })

  it('takes the clock once the clock has passed the entry', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const vfs = new MemoryVfs()
    vfs.seed('/avn/log.jsonl', 'first\n')
    clock.mockReturnValue(1_700_000_005_000)
    vfs.writeFileSync('/avn/log.jsonl', 'second\n')
    expect(modified(vfs, '/avn/log.jsonl')).toBe(1_700_000_005_000)
  })

  it('extends truncation with zero bytes', async () => {
    const vfs = new MemoryVfs()
    vfs.seed('/avn/file', new Uint8Array([1, 2]))
    vfs.truncateSync('/avn/file', 5)
    expect([...vfs.readFileSync('/avn/file') as Uint8Array]).toEqual([1, 2, 0, 0, 0])
    const handle = vfs.open('/avn/file', 'r+')
    await handle.truncate(7)
    expect([...vfs.readFileSync('/avn/file') as Uint8Array]).toEqual([1, 2, 0, 0, 0, 0, 0])
  })

  it('advances a directory only when its immediate entry set changes', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const vfs = new MemoryVfs()
    vfs.seedDirectory('/avn/workspace')
    const empty = modified(vfs, '/avn/workspace')
    vfs.writeFileSync('/avn/workspace/file.txt', 'one')
    const created = modified(vfs, '/avn/workspace')
    vfs.writeFileSync('/avn/workspace/file.txt', 'two')
    const rewritten = modified(vfs, '/avn/workspace')
    vfs.rmSync('/avn/workspace/file.txt')
    const removed = modified(vfs, '/avn/workspace')
    expect([created > empty, rewritten === created, removed > rewritten]).toEqual([true, true, true])
  })
})

describe('mutation publication', () => {
  it('publishes only committed runtime changes and keeps image seeding silent', () => {
    const vfs = new MemoryVfs()
    const mutations: VfsMutation[] = []
    vfs.subscribe((mutation) => { mutations.push(mutation) })
    vfs.seed('/avn/seeded.txt', 'seeded')
    expect(mutations).toEqual([])
    vfs.writeFileSync('/avn/seeded.txt', 'changed')
    vfs.mkdirSync('/avn/created')
    vfs.chmodSync('/avn/created', 0o700)
    vfs.renameSync('/avn/seeded.txt', '/avn/renamed.txt')
    vfs.rmSync('/avn/created', { recursive: true })
    expect(mutations.map(mutation => ({
      kind: mutation.kind,
      path: mutation.path,
      ...mutation.kind === 'write' ? { entryChanged: mutation.entryChanged } : {},
      ...mutation.kind === 'chmod' ? { mode: mutation.mode } : {},
    }))).toEqual([
      { kind: 'write', path: '/avn/seeded.txt', entryChanged: false },
      { kind: 'mkdir', path: '/avn/created' },
      { kind: 'chmod', path: '/avn/created', mode: 0o700 },
      { kind: 'remove', path: '/avn/seeded.txt' },
      { kind: 'write', path: '/avn/renamed.txt', entryChanged: true },
      { kind: 'remove', path: '/avn/created' },
    ])
    const renamed = mutations[4]
    expect(renamed?.kind === 'write' && new TextDecoder().decode(renamed.bytes)).toBe('changed')
    expect(() => { vfs.writeFileSync('/missing/file', 'no') }).toThrow(/ENOENT/)
    expect(mutations).toHaveLength(6)
  })

  it('contains a faulty observer and lets disposal stop later notifications', () => {
    const vfs = new MemoryVfs()
    vfs.seedDirectory('/avn')
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
    const first = vfs.subscribe(() => { throw new Error('observer failed') })
    const seen: string[] = []
    const second = vfs.subscribe((mutation) => { seen.push(mutation.path) })
    vfs.writeFileSync('/avn/one', '1')
    first()
    second()
    vfs.writeFileSync('/avn/two', '2')
    expect(seen).toEqual(['/avn/one'])
    expect(reported).toHaveBeenCalledOnce()
  })

  it('feeds the same complete mutations to a durable sink and live subscribers', async () => {
    const recorded: VfsMutation[] = []
    let flushes = 0
    const sink: VfsMutationSink = {
      record: (mutation) => { recorded.push(mutation) },
      flush: async () => { flushes += 1 },
    }
    const vfs = new MemoryVfs({ sink })
    vfs.seedDirectory('/avn')
    const observed: VfsMutation[] = []
    vfs.subscribe((mutation) => { observed.push(mutation) })
    vfs.writeFileSync('/avn/log', 'a')
    vfs.appendFileSync('/avn/log', 'bc')
    await vfs.flush()
    expect(observed).toEqual(recorded)
    expect(observed[0]).toBe(recorded[0])
    expect(recorded[0]).toMatchObject({ kind: 'write', path: '/avn/log', mode: 0o644, entryChanged: true })
    expect(recorded[1]).toMatchObject({ kind: 'write', path: '/avn/log', mode: 0o644, entryChanged: false, appendedFrom: 1 })
    expect(recorded[1]?.kind === 'write' && new TextDecoder().decode(recorded[1].bytes)).toBe('abc')
    expect(flushes).toBe(1)
  })

  it('publishes descriptor writes at the file identity current path', () => {
    const mutations: VfsMutation[] = []
    const vfs = new MemoryVfs()
    vfs.seed('/avn/source', 'old')
    const descriptor = vfs.openFileSync('/avn/source', 'r+')
    vfs.subscribe((mutation) => { mutations.push(mutation) })
    vfs.renameSync('/avn/source', '/avn/destination')
    mutations.length = 0
    descriptor.write(0, new TextEncoder().encode('new'))
    expect(mutations.map(mutation => mutation.path)).toEqual(['/avn/destination'])
    expect(vfs.readFileSync('/avn/destination', 'utf8')).toBe('new')
    vfs.unlinkSync('/avn/destination')
    mutations.length = 0
    descriptor.write(0, new TextEncoder().encode('detached'))
    expect(mutations).toEqual([])
    expect(new TextDecoder().decode(descriptor.read(0, descriptor.stat().size))).toBe('detached')
  })

  it('decomposes a directory rename into replayable destination state', () => {
    const recorded: VfsMutation[] = []
    const vfs = new MemoryVfs({
      sink: { record: (mutation) => { recorded.push(mutation) }, flush: () => Promise.resolve() },
    })
    vfs.seedDirectory('/avn/staging/nested', { mode: 0o700 })
    vfs.seed('/avn/staging/nested/file', 'value', { mode: 0o600 })
    vfs.renameSync('/avn/staging', '/avn/published')

    expect(recorded.map(mutation => [mutation.kind, mutation.path])).toEqual([
      ['remove', '/avn/staging'],
      ['mkdir', '/avn/published'],
      ['mkdir', '/avn/published/nested'],
      ['write', '/avn/published/nested/file'],
    ])
    expect(recorded[3]).toMatchObject({ kind: 'write', mode: 0o600, entryChanged: true })
    expect(recorded[3]?.kind === 'write' && new TextDecoder().decode(recorded[3].bytes)).toBe('value')
  })
})

describe('directory rename', () => {
  it('rejects file, non-empty directory, and missing-parent destinations before mutation', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/avn/source/nested/file', 'source')
    vfs.seed('/avn/file', 'destination')
    vfs.seed('/avn/non-empty/child', 'destination')
    const mutations: VfsMutation[] = []
    vfs.subscribe((mutation) => { mutations.push(mutation) })

    expect(() => { vfs.renameSync('/avn/source', '/avn/file') })
      .toThrow(expect.objectContaining({ code: 'ENOTDIR' }))
    expect(() => { vfs.renameSync('/avn/source', '/avn/non-empty') })
      .toThrow(expect.objectContaining({ code: 'ENOTEMPTY' }))
    expect(() => { vfs.renameSync('/avn/source', '/missing/destination') })
      .toThrow(expect.objectContaining({ code: 'ENOENT' }))

    expect(vfs.readFileSync('/avn/source/nested/file', 'utf8')).toBe('source')
    expect(vfs.readFileSync('/avn/file', 'utf8')).toBe('destination')
    expect(vfs.readFileSync('/avn/non-empty/child', 'utf8')).toBe('destination')
    expect(mutations).toEqual([])
  })

  it('replaces an empty directory with the source subtree', () => {
    const vfs = new MemoryVfs()
    vfs.seedDirectory('/avn/source/nested', { mode: 0o700 })
    vfs.seed('/avn/source/nested/file', 'source')
    vfs.seedDirectory('/avn/destination', { mode: 0o711 })

    vfs.renameSync('/avn/source', '/avn/destination')

    expect(vfs.existsSync('/avn/source')).toBe(false)
    expect(vfs.readFileSync('/avn/destination/nested/file', 'utf8')).toBe('source')
    expect((vfs.statSync('/avn/destination') as VfsStats).mode & 0o777).toBe(0o755)
    expect((vfs.statSync('/avn/destination/nested') as VfsStats).mode & 0o777).toBe(0o700)
  })
})

describe('hard links', () => {
  it('shares identity, bytes, and mode until one name is removed', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/avn/session.jsonl', 'committed\n')
    vfs.linkSync('/avn/session.jsonl', '/avn/session-latest.jsonl')
    vfs.linkSync('/avn/session-latest.jsonl', '/avn/session-archive.jsonl')
    expect(identity(vfs, '/avn/session-latest.jsonl')).toBe(identity(vfs, '/avn/session.jsonl'))
    expect(linkCount(vfs, '/avn/session.jsonl')).toBe(3n)
    expect(vfs.readFileSync('/avn/session-latest.jsonl', 'utf8')).toBe('committed\n')
    const changedPaths: string[] = []
    vfs.subscribe((mutation) => { changedPaths.push(mutation.path) })
    vfs.appendFileSync('/avn/session.jsonl', 'appended\n')
    expect(changedPaths).toEqual([
      '/avn/session.jsonl',
      '/avn/session-latest.jsonl',
      '/avn/session-archive.jsonl',
    ])
    expect(vfs.readFileSync('/avn/session.jsonl', 'utf8')).toBe('committed\nappended\n')
    expect(vfs.readFileSync('/avn/session-latest.jsonl', 'utf8')).toBe('committed\nappended\n')
    vfs.chmodSync('/avn/session-latest.jsonl', 0o600)
    expect((vfs.statSync('/avn/session.jsonl') as VfsStats).mode & 0o777).toBe(0o600)
    vfs.unlinkSync('/avn/session-latest.jsonl')
    expect(linkCount(vfs, '/avn/session.jsonl')).toBe(2n)
    vfs.unlinkSync('/avn/session-archive.jsonl')
    expect(linkCount(vfs, '/avn/session.jsonl')).toBe(1n)
    expect(vfs.readFileSync('/avn/session.jsonl', 'utf8')).toBe('committed\nappended\n')
  })

  it('treats rename between names of the same node as a no-op', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/avn/source', 'value')
    vfs.linkSync('/avn/source', '/avn/alias')
    const mutations: VfsMutation[] = []
    vfs.subscribe((mutation) => { mutations.push(mutation) })

    vfs.renameSync('/avn/source', '/avn/alias')

    expect(vfs.readFileSync('/avn/source', 'utf8')).toBe('value')
    expect(vfs.readFileSync('/avn/alias', 'utf8')).toBe('value')
    expect(linkCount(vfs, '/avn/source')).toBe(2n)
    expect(mutations).toEqual([])
  })

  it('retargets linked names through file replacement and directory moves', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/avn/replacement', 'replacement')
    vfs.seed('/avn/target', 'old')
    vfs.linkSync('/avn/target', '/avn/target-alias')
    const replaced = vfs.openFileSync('/avn/target', 'r+')
    vfs.renameSync('/avn/replacement', '/avn/target')
    const mutations: VfsMutation[] = []
    vfs.subscribe((mutation) => { mutations.push(mutation) })

    replaced.write(0, new TextEncoder().encode('changed'))
    expect(mutations.map(mutation => mutation.path)).toEqual(['/avn/target-alias'])
    expect(vfs.readFileSync('/avn/target', 'utf8')).toBe('replacement')
    expect(vfs.readFileSync('/avn/target-alias', 'utf8')).toBe('changed')
    expect(linkCount(vfs, '/avn/target-alias')).toBe(1n)

    vfs.seed('/avn/tree/file', 'tree')
    vfs.linkSync('/avn/tree/file', '/avn/outside')
    const moved = vfs.openFileSync('/avn/tree/file', 'r+')
    vfs.renameSync('/avn/tree', '/avn/moved')
    mutations.length = 0
    moved.write(0, new TextEncoder().encode('moved'))
    expect(mutations.map(mutation => mutation.path)).toEqual(['/avn/outside', '/avn/moved/file'])
    expect(linkCount(vfs, '/avn/moved/file')).toBe(2n)

    vfs.rmSync('/avn/moved', { recursive: true })
    mutations.length = 0
    moved.write(0, new TextEncoder().encode('kept!'))
    expect(mutations.map(mutation => mutation.path)).toEqual(['/avn/outside'])
    expect(vfs.readFileSync('/avn/outside', 'utf8')).toBe('kept!')
    expect(linkCount(vfs, '/avn/outside')).toBe(1n)
  })

  it('rejects renaming a file over an existing directory', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/avn/file', 'value')
    vfs.seedDirectory('/avn/directory')
    expect(() => { vfs.renameSync('/avn/file', '/avn/directory') }).toThrow(expect.objectContaining({ code: 'EISDIR' }))
    expect(vfs.readFileSync('/avn/file', 'utf8')).toBe('value')
    expect(vfs.statSync('/avn/directory').isDirectory()).toBe(true)
  })
})
