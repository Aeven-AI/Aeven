import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { extract } from 'tar'
import { expect, it, vi } from 'vitest'
import { archivePnpmStore, extractPnpmStoreArchives } from '../src/seed-store.ts'

vi.mock('tar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('tar')>()
  return { ...actual, extract: vi.fn(actual.extract) }
})

// POSIX tar already parallelizes individual files; concurrent shard writers address its Windows-only serialization.
it.skipIf(process.platform !== 'win32')('starts independent shards together and awaits every writer after a failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'avn-store-concurrency-'))
  const writers: { resolve(): void; reject(error: Error): void }[] = []
  let extraction: Promise<ReadonlySet<string>> | undefined
  const failure = new Error('shard write failed')
  try {
    const seed = join(root, 'seed')
    const store = join(seed, 'store')
    mkdirSync(store, { recursive: true })
    for (let index = 0; index < 64; index += 1) writeFileSync(join(store, `file-${index}`), 'package')
    archivePnpmStore(seed, store, 3)
    vi.mocked(extract).mockImplementation(() => new Promise<void>((resolve, reject) => {
      writers.push({ resolve, reject })
    }))
    extraction = extractPnpmStoreArchives(seed, join(root, 'destination'))
    let settled = false
    const outcome = extraction.then(() => { settled = true }, () => { settled = true })
    await vi.waitFor(() => { expect(writers).toHaveLength(3) })
    writers[0]!.reject(failure)
    await setImmediate()
    expect(settled).toBe(false)
    for (const writer of writers.slice(1)) writer.resolve()
    await expect(extraction).rejects.toBe(failure)
    await outcome
  } finally {
    for (const writer of writers) writer.resolve()
    await extraction?.catch(() => undefined)
    vi.mocked(extract).mockRestore()
    rmSync(root, { recursive: true, force: true })
  }
})
