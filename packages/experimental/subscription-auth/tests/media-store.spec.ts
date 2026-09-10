import { createHash } from 'node:crypto'
import type { Stats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import {
  appendFile,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createTrustedImagineAuthz,
  IMAGINE_MEDIA_ROUTE_PREFIX,
  imagineMediaPath,
  isSafeMediaArtifactId,
  isTrustedImaginePeer,
  MEDIA_STORE_MAX_BYTES,
  MEDIA_STORE_RETENTION_MS,
  MediaStore,
  MediaStoreError,
  migrateLegacyMediaStoreDir,
  openTrustedMediaDownload,
  parseImagineMediaPath,
  parseMediaArtifactId,
} from '../src/media-store.ts'

const temporaryDirectories: string[] = []
let clock = 1_700_000_000_000

afterEach(async () => {
  clock = 1_700_000_000_000
  faults = []
  faultHits.clear()
  vi.doUnmock('node:fs')
  vi.doUnmock('node:fs/promises')
  vi.resetModules()
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function tempDir(prefix = 'dsh-media-store-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(dir)
  return dir
}

async function tempStore(options: ConstructorParameters<typeof MediaStore>[1] = {}): Promise<MediaStore> {
  return new MediaStore(await tempDir(), { now: () => clock, ...options })
}

function sampleVideo(tag = 'clip'): Uint8Array {
  return new TextEncoder().encode(`ftypisom-test-video-${tag}-${'x'.repeat(32)}`)
}

function digestOf(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Path a stored object's bytes take under the content-addressed layout. */
function objectLeaf(root: string, data: Uint8Array): string {
  const digest = digestOf(data)
  return join(root, 'objects', digest.slice(0, 2), digest)
}

/** Path one artifact's index document takes under the bucket layout. */
function indexLeaf(root: string, artifactId: string): string {
  return join(root, 'index', artifactId.slice(0, 2), `${artifactId}.json`)
}

/** A well-formed index document whose fields a caller can override to make it malformed. */
function indexDocument(overrides: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    version: 1,
    artifactId: 'aa'.repeat(16),
    sha256: 'bb'.repeat(32),
    mediaType: 'video/mp4',
    bytes: 4,
    createdAt: clock - 1_000,
    expiresAt: clock + 60_000,
    ...overrides,
  })}\n`
}

async function plantIndexLeaf(root: string, artifactId: string, contents: string): Promise<string> {
  await mkdir(join(root, 'index', artifactId.slice(0, 2)), { recursive: true, mode: 0o700 })
  const leaf = indexLeaf(root, artifactId)
  await writeFile(leaf, contents, { mode: 0o600 })
  return leaf
}

async function exists(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => undefined)) !== undefined
}

/** Every index leaf filename currently on disk, whatever bucket holds it. */
async function indexLeaves(root: string): Promise<string[]> {
  const base = join(root, 'index')
  const leaves: string[] = []
  for (const bucket of await readdir(base).catch(() => [])) {
    for (const entry of await readdir(join(base, bucket)).catch(() => [])) {
      if (entry.endsWith('.json')) leaves.push(entry)
    }
  }
  return leaves
}

function fakeStats(kind: 'directory' | 'file' | 'symlink', size = 0): Stats {
  return {
    isDirectory: () => kind === 'directory',
    isFile: () => kind === 'file',
    isSymbolicLink: () => kind === 'symlink',
    size,
  } as unknown as Stats
}

/**
 * One injected filesystem failure. Every field describes something a real disk,
 * a racing process, or a hostile peer can do between two of the store's calls:
 * the leaf moves away, the bucket was already created, the write fails.
 */
interface Fault {
  /** The promise API to intercept. */
  readonly op: 'chmod' | 'link' | 'lstat' | 'mkdir' | 'open' | 'readdir' | 'rename' | 'unlink'
  /** Path the call must name; `link` and `rename` match their target. */
  readonly path: string | ((path: string) => boolean)
  /** 1-based index among the calls this fault matches; omit to intercept every one. */
  readonly occurrence?: number
  /** Run the real call first, so the fault looks like a competitor that won. */
  readonly after?: boolean
  /** Run before the call settles, to plant whatever a competitor would have left. */
  readonly effect?: (path: string, source: string) => void | Promise<void>
  /** Answer instead of the real call. */
  readonly result?: (path: string) => unknown
  /** Fail the call with this `code`. */
  readonly code?: string
  /** Replace a successful `open` handle with one that misbehaves. */
  readonly handle?: (handle: FileHandle) => unknown
}

let faults: readonly Fault[] = []
const faultHits = new Map<Fault, number>()

function takeFault(op: Fault['op'], path: string): Fault | undefined {
  for (const fault of faults) {
    if (fault.op !== op) continue
    const matches = typeof fault.path === 'function' ? fault.path(path) : fault.path === path
    if (!matches) continue
    const hits = (faultHits.get(fault) ?? 0) + 1
    faultHits.set(fault, hits)
    if (fault.occurrence !== undefined && fault.occurrence !== hits) continue
    return fault
  }
  return undefined
}

function faultError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`injected ${code}`), { code })
}

/**
 * Load a fresh copy of the module over a `node:fs/promises` whose calls can be
 * made to fail, so each TOCTOU and cleanup arm the store defends is exercised
 * deterministically on every host instead of only under a lucky race.
 */
async function importWithFaults(active: readonly Fault[]): Promise<typeof import('../src/media-store.ts')> {
  faults = active
  faultHits.clear()
  vi.resetModules()
  vi.doMock('node:fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs/promises')>()
    async function intercept<T>(
      op: Fault['op'],
      target: string,
      source: string,
      call: () => Promise<T>,
    ): Promise<T> {
      const fault = takeFault(op, target)
      if (fault === undefined) return call()
      if (fault.effect !== undefined) await fault.effect(target, source)
      if (fault.after === true) await call()
      if (fault.result !== undefined) return fault.result(target) as T
      if (fault.code !== undefined) throw faultError(fault.code)
      return call()
    }
    return {
      ...actual,
      chmod: (...args: Parameters<typeof actual.chmod>) =>
        intercept('chmod', String(args[0]), '', () => actual.chmod(...args)),
      link: (...args: Parameters<typeof actual.link>) =>
        intercept('link', String(args[1]), String(args[0]), () => actual.link(...args)),
      lstat: (...args: Parameters<typeof actual.lstat>) =>
        intercept('lstat', String(args[0]), '', () => actual.lstat(...args)),
      mkdir: (...args: Parameters<typeof actual.mkdir>) =>
        intercept('mkdir', String(args[0]), '', () => actual.mkdir(...args)),
      readdir: (...args: Parameters<typeof actual.readdir>) =>
        intercept('readdir', String(args[0]), '', () => actual.readdir(...args)),
      rename: (...args: Parameters<typeof actual.rename>) =>
        intercept('rename', String(args[1]), String(args[0]), () => actual.rename(...args)),
      unlink: (...args: Parameters<typeof actual.unlink>) =>
        intercept('unlink', String(args[0]), '', () => actual.unlink(...args)),
      async open(...args: Parameters<typeof actual.open>) {
        const fault = takeFault('open', String(args[0]))
        if (fault === undefined) return actual.open(...args)
        if (fault.effect !== undefined) await fault.effect(String(args[0]), '')
        if (fault.code !== undefined) throw faultError(fault.code)
        const handle = await actual.open(...args)
        return fault.handle === undefined ? handle : (fault.handle(handle) as FileHandle)
      },
    }
  })
  return import('../src/media-store.ts')
}

const trusted = () => createTrustedImagineAuthz({ authorized: true })

describe('MediaStore', () => {
  it('saves, looks up, and reads a content-addressed video under owner-only modes', async () => {
    const store = await tempStore()
    const data = sampleVideo()
    const digest = digestOf(data)
    const meta = await store.save({ data, mediaType: 'video/mp4', name: '/tmp/unsafe/name.mp4' })

    expect(isSafeMediaArtifactId(meta.artifactId)).toBe(true)
    expect(meta.artifactId).not.toBe(digest)
    expect(meta).not.toHaveProperty('sha256')
    expect(meta.bytes).toBe(data.byteLength)
    expect(meta.mediaType).toBe('video/mp4')
    expect(meta.name).toBe('name.mp4')
    expect(meta.expiresAt - meta.createdAt).toBe(MEDIA_STORE_RETENTION_MS)
    expect(JSON.stringify(meta)).not.toContain(store.root)
    expect(JSON.stringify(meta)).not.toContain(digest)
    expect(JSON.stringify(meta)).not.toContain('objects/')

    const looked = await store.lookup(meta.artifactId)
    expect(looked).toEqual(meta)
    const stored = await store.read(meta.artifactId)
    expect(stored.data).toEqual(data)
    expect(stored.meta).not.toHaveProperty('sha256')

    if (process.platform !== 'win32') {
      expect((await stat(store.root)).mode & 0o777).toBe(0o700)
      const object = join(store.root, 'objects', digest.slice(0, 2), digest)
      const index = join(store.root, 'index', meta.artifactId.slice(0, 2), `${meta.artifactId}.json`)
      expect((await stat(object)).mode & 0o777).toBe(0o600)
      expect((await stat(index)).mode & 0o777).toBe(0o600)
      expect((await stat(join(store.root, 'objects'))).mode & 0o777).toBe(0o700)
      expect((await stat(join(store.root, 'index'))).mode & 0o777).toBe(0o700)
    }
  })

  it('deduplicates bytes while issuing distinct opaque ids', async () => {
    const store = await tempStore()
    const data = sampleVideo('same')
    const first = await store.save({ data, mediaType: 'video/mp4' })
    const second = await store.save({ data, mediaType: 'video/webm' })
    expect(first.artifactId).not.toBe(second.artifactId)
    expect(await store.delete(first.artifactId)).toBe(true)
    expect((await store.read(second.artifactId)).data).toEqual(data)
  })

  it('rejects oversized, empty, and unsupported payloads', async () => {
    const store = await tempStore({ maxBytes: 16 })
    await expect(store.save({ data: new Uint8Array(), mediaType: 'video/mp4' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(store.save({ data: new Uint8Array(17), mediaType: 'video/mp4' })).rejects.toMatchObject({
      code: 'TOO_LARGE',
    })
    await expect(store.save({ data: sampleVideo(), mediaType: 'image/png' as 'video/mp4' })).rejects.toMatchObject({
      code: 'UNSUPPORTED_TYPE',
    })
    expect(store.maxBytes).toBe(16)
    expect(MEDIA_STORE_MAX_BYTES).toBe(256 * 1024 * 1024)
  })

  it('hard-clamps maxBytes and retention to the ship-safe ceilings', async () => {
    const store = await tempStore({
      maxBytes: MEDIA_STORE_MAX_BYTES * 4,
      maxTotalBytes: MEDIA_STORE_MAX_BYTES * 4,
      retentionMs: MEDIA_STORE_RETENTION_MS * 4,
    })
    expect(store.maxBytes).toBe(MEDIA_STORE_MAX_BYTES)
    expect(store.maxTotalBytes).toBe(MEDIA_STORE_MAX_BYTES)
    expect(store.retentionMs).toBe(MEDIA_STORE_RETENTION_MS)
  })

  it('caps aggregate unique object bytes while allowing deduplicated ids', async () => {
    const firstData = sampleVideo('quota-first')
    const secondData = sampleVideo('quota-second')
    const store = await tempStore({
      maxBytes: Math.max(firstData.byteLength, secondData.byteLength),
      maxTotalBytes: firstData.byteLength,
    })
    const first = await store.save({ data: firstData, mediaType: 'video/mp4' })
    const duplicate = await store.save({ data: firstData, mediaType: 'video/webm' })
    expect(duplicate.artifactId).not.toBe(first.artifactId)
    await expect(store.save({ data: secondData, mediaType: 'video/mp4' })).rejects.toMatchObject({
      code: 'TOO_LARGE',
    })
  })

  it('cleans expired objects before enforcing the aggregate quota', async () => {
    const firstData = sampleVideo('quota-expired')
    const secondData = sampleVideo('quota-fresh')
    const store = await tempStore({
      maxBytes: Math.max(firstData.byteLength, secondData.byteLength),
      maxTotalBytes: Math.max(firstData.byteLength, secondData.byteLength),
      retentionMs: 10,
    })
    await store.save({ data: firstData, mediaType: 'video/mp4' })
    clock += 11
    await expect(store.save({ data: secondData, mediaType: 'video/mp4' })).resolves.toMatchObject({
      bytes: secondData.byteLength,
    })
  })

  it('shortens existing retention live without resurrecting it, while raises affect only new artifacts', async () => {
    const store = await tempStore({ retentionMs: 100 })
    const first = await store.save({ data: sampleVideo('first'), mediaType: 'video/mp4' })
    clock += 10
    await expect(store.applyRetentionMs(20)).resolves.toEqual({ expiredArtifacts: 0, removedObjects: 0 })
    expect(await store.lookup(first.artifactId)).toMatchObject({ expiresAt: first.createdAt + 20 })

    await store.applyRetentionMs(200)
    expect(await store.lookup(first.artifactId)).toMatchObject({ expiresAt: first.createdAt + 20 })
    const second = await store.save({ data: sampleVideo('second'), mediaType: 'video/mp4' })
    expect(second.expiresAt - second.createdAt).toBe(200)

    clock += 11
    expect(await store.lookup(first.artifactId)).toBeUndefined()
    expect(await store.lookup(second.artifactId)).toMatchObject({ artifactId: second.artifactId })
    await store.applyRetentionMs(MEDIA_STORE_RETENTION_MS * 2)
    expect(store.retentionMs).toBe(MEDIA_STORE_RETENTION_MS)
    await expect(store.applyRetentionMs(0)).rejects.toThrow(/positive finite/iu)
  })

  it('immediately deletes artifacts made stale by a lower live retention ceiling', async () => {
    const store = await tempStore({ retentionMs: 100 })
    const meta = await store.save({ data: sampleVideo('retention-expired'), mediaType: 'video/webm' })
    clock += 50
    await expect(store.applyRetentionMs(20)).resolves.toEqual({ expiredArtifacts: 1, removedObjects: 1 })
    expect(await store.lookup(meta.artifactId)).toBeUndefined()
  })

  it('reconciles persisted expiries on the first equal retention update after startup', async () => {
    const original = await tempStore({ retentionMs: 100 })
    const meta = await original.save({ data: sampleVideo('retention-restart'), mediaType: 'video/mp4' })
    clock += 50
    const restarted = new MediaStore(original.root, { now: () => clock, retentionMs: 20 })
    await expect(restarted.applyRetentionMs(20)).resolves.toEqual({ expiredArtifacts: 1, removedObjects: 1 })
    expect(await restarted.lookup(meta.artifactId)).toBeUndefined()
  })

  it('treats expired and unknown ids as missing and refuses path-shaped lookups', async () => {
    const store = await tempStore({ retentionMs: 10 })
    const meta = await store.save({ data: sampleVideo('exp'), mediaType: 'video/webm' })
    clock += 11
    expect(await store.lookup(meta.artifactId)).toBeUndefined()
    await expect(store.read(meta.artifactId)).rejects.toMatchObject({ code: 'EXPIRED' })
    expect(await store.lookup('../objects/ab')).toBeUndefined()
    expect(await store.lookup('not-hex')).toBeUndefined()
    expect(await store.lookup(`${meta.artifactId}/../${meta.artifactId}`)).toBeUndefined()
    await expect(store.read('../secret')).rejects.toMatchObject({ code: 'INVALID_ID' })
    expect(await store.delete('../secret')).toBe(false)
  })

  it('cleans expired indexes before save and deletes a live artifact', async () => {
    const store = await tempStore({ retentionMs: 10 })
    const live = await store.save({ data: sampleVideo('live'), mediaType: 'video/mp4' })
    const stale = await store.save({ data: sampleVideo('stale'), mediaType: 'video/mp4' })
    clock += 11
    const refreshed = await store.save({ data: sampleVideo('fresh'), mediaType: 'video/mp4' })
    const report = await store.cleanup()
    expect(report.expiredArtifacts).toBe(0)
    expect(await store.lookup(live.artifactId)).toBeUndefined()
    expect(await store.lookup(stale.artifactId)).toBeUndefined()
    expect(await store.lookup(refreshed.artifactId)).toMatchObject({ artifactId: refreshed.artifactId })
    expect(await store.delete(refreshed.artifactId)).toBe(true)
    expect(await store.lookup(refreshed.artifactId)).toBeUndefined()
  })

  it('detects a corrupt object after the index is rewritten', async () => {
    const store = await tempStore()
    const data = sampleVideo('corrupt')
    const meta = await store.save({ data, mediaType: 'video/mp4' })
    const digest = digestOf(data)
    const object = join(store.root, 'objects', digest.slice(0, 2), digest)
    await writeFile(object, 'tampered', { mode: 0o600 })
    await expect(store.read(meta.artifactId)).rejects.toMatchObject({ code: 'CORRUPT' })
  })

  it('exposes trusted same-origin download primitives without hashes or upstream URLs', async () => {
    const store = await tempStore()
    const meta = await store.save({ data: sampleVideo('dl'), mediaType: 'video/webm' })
    const path = imagineMediaPath(meta.artifactId)
    expect(path).toBe(`${IMAGINE_MEDIA_ROUTE_PREFIX}${meta.artifactId}`)
    expect(parseImagineMediaPath(path)).toBe(meta.artifactId)
    expect(parseImagineMediaPath(`${IMAGINE_MEDIA_ROUTE_PREFIX}../${meta.artifactId}`)).toBeUndefined()
    expect(parseMediaArtifactId(meta.artifactId)).toBe(meta.artifactId)

    await expect(openTrustedMediaDownload(store, meta.artifactId, {} as never)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(() => createTrustedImagineAuthz({ remoteAddress: '10.0.0.2' })).toThrow(MediaStoreError)

    const view = await openTrustedMediaDownload(store, meta.artifactId, trusted())
    expect(view.body).toEqual(sampleVideo('dl'))
    expect(view.headers['Content-Type']).toBe('video/webm')
    expect(view.headers['Content-Disposition']).toContain(`imagine-${meta.artifactId}.webm`)
    expect(view.headers['Cache-Control']).toContain('no-store')
    expect(view.meta).not.toHaveProperty('sha256')
    expect(JSON.stringify(view.headers)).not.toMatch(/https?:\/\//)
    expect(JSON.stringify(view.meta)).not.toMatch(/https?:\/\//)
    expect(JSON.stringify(view.meta)).not.toMatch(/[a-f0-9]{64}/)
    expect(JSON.stringify(view.meta)).not.toContain('objects/')
    await expect(openTrustedMediaDownload(store, '../x', trusted())).rejects.toMatchObject({ code: 'INVALID_ID' })
  })

  it('classifies only loopback peers as trusted download clients', () => {
    expect(isTrustedImaginePeer('127.0.0.1')).toBe(true)
    expect(isTrustedImaginePeer('::1')).toBe(true)
    expect(isTrustedImaginePeer('::ffff:127.0.0.1')).toBe(true)
    expect(isTrustedImaginePeer('10.0.0.2')).toBe(false)
    expect(isTrustedImaginePeer(undefined)).toBe(false)
  })

  it('rejects a store rooted at an empty path', () => {
    expect(() => new MediaStore('')).toThrow(MediaStoreError)
  })

  it('still reads after an existing directory is widened then rewritten owner-only', async () => {
    const store = await tempStore()
    await mkdir(join(store.root, 'objects'), { recursive: true, mode: 0o755 })
    const meta = await store.save({ data: sampleVideo('chmod'), mediaType: 'video/mp4' })
    if (process.platform !== 'win32') {
      expect((await stat(store.root)).mode & 0o777).toBe(0o700)
      await chmod(join(store.root, 'index', meta.artifactId.slice(0, 2), `${meta.artifactId}.json`), 0o600)
    }
    expect((await store.read(meta.artifactId)).meta.artifactId).toBe(meta.artifactId)
    const indexText = await readFile(
      join(store.root, 'index', meta.artifactId.slice(0, 2), `${meta.artifactId}.json`),
      'utf8',
    )
    const document = JSON.parse(indexText) as { version: number; sha256: string }
    expect(document.version).toBe(1)
    expect(JSON.stringify(await store.lookup(meta.artifactId))).not.toContain(document.sha256)
  })

  it('serializes concurrent saves that force the same id and never overwrites the winner', async () => {
    const forced = 'aa'.repeat(16)
    const store = await tempStore({ randomId: () => forced })
    const firstData = sampleVideo('force-a')
    const secondData = sampleVideo('force-b')
    const results = await Promise.allSettled([
      store.save({ data: firstData, mediaType: 'video/mp4' }),
      store.save({ data: secondData, mediaType: 'video/mp4' }),
    ])
    type Saved = Awaited<ReturnType<MediaStore['save']>>
    const fulfilled = results.filter((result): result is PromiseFulfilledResult<Saved> => {
      return result.status === 'fulfilled'
    })
    const rejected = results.filter(result => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'INVALID_ID' })
    const winner = fulfilled[0]!.value
    expect(winner.artifactId).toBe(forced)
    const stored = await store.read(forced)
    const matchesFirst = Buffer.from(stored.data).equals(Buffer.from(firstData))
    const matchesSecond = Buffer.from(stored.data).equals(Buffer.from(secondData))
    expect(matchesFirst || matchesSecond).toBe(true)
    expect(matchesFirst && matchesSecond).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('rejects a symlink store root and does not follow symlink dirs', async () => {
    const base = await mkdtemp(join(tmpdir(), 'dsh-media-symlink-'))
    temporaryDirectories.push(base)
    const real = join(base, 'real')
    const linked = join(base, 'linked')
    await mkdir(real)
    await symlink(real, linked)
    const linkedStore = new MediaStore(linked, { now: () => clock })
    await expect(linkedStore.save({ data: sampleVideo('root'), mediaType: 'video/mp4' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })

    const store = new MediaStore(join(base, 'store'), { now: () => clock })
    const outside = join(base, 'outside')
    await mkdir(outside)
    const secret = join(outside, 'secret')
    await writeFile(secret, 'do-not-delete')
    const first = await store.save({ data: sampleVideo('inside'), mediaType: 'video/mp4' })
    await rm(join(store.root, 'objects'), { recursive: true, force: true })
    await symlink(outside, join(store.root, 'objects'))
    await expect(store.save({ data: sampleVideo('escape'), mediaType: 'video/mp4' })).rejects.toMatchObject({
      code: 'CORRUPT',
    })
    await expect(store.cleanup()).rejects.toMatchObject({ code: 'CORRUPT' })
    expect(await readFile(secret, 'utf8')).toBe('do-not-delete')
    expect(await store.lookup(first.artifactId)).toMatchObject({ artifactId: first.artifactId })
  })

  it.skipIf(process.platform === 'win32')('refuses to follow a symlink index leaf', async () => {
    const store = await tempStore()
    const meta = await store.save({ data: sampleVideo('leaf'), mediaType: 'video/mp4' })
    const index = join(store.root, 'index', meta.artifactId.slice(0, 2), `${meta.artifactId}.json`)
    await rm(index)
    const outside = join(store.root, '..', `escape-${meta.artifactId}`)
    await writeFile(outside, '{"version":1}')
    await symlink(outside, index)
    expect(await store.lookup(meta.artifactId)).toBeUndefined()
    await expect(store.read(meta.artifactId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await readFile(outside, 'utf8')).toBe('{"version":1}')
  })

  it('refuses an unsafe id and ignores a route that belongs to another plugin', () => {
    expect(() => imagineMediaPath('../objects/ab')).toThrow(MediaStoreError)
    expect(() => imagineMediaPath('')).toThrow(/safe opaque identifier/u)
    expect(parseImagineMediaPath('/plugins/elsewhere/media/' + 'aa'.repeat(16))).toBeUndefined()
    expect(parseImagineMediaPath(IMAGINE_MEDIA_ROUTE_PREFIX)).toBeUndefined()
  })

  it('drops a requested name that sanitizes to nothing', async () => {
    const store = await tempStore()
    const meta = await store.save({ data: sampleVideo('blank-name'), mediaType: 'video/mp4', name: '   ' })
    expect(meta).not.toHaveProperty('name')
    expect(await store.lookup(meta.artifactId)).toEqual(meta)
  })

  it('reports an empty cleanup for a store directory that holds no buckets yet', async () => {
    const store = new MediaStore(await tempDir())
    await expect(store.cleanup()).resolves.toEqual({ expiredArtifacts: 0, removedObjects: 0 })
    expect(store.retentionMs).toBe(MEDIA_STORE_RETENTION_MS)
  })

  it('reconciles and reports when a raised retention ceiling arrives before any cleanup', async () => {
    const store = await tempStore({ retentionMs: 100 })
    await expect(store.applyRetentionMs(500)).resolves.toEqual({ expiredArtifacts: 0, removedObjects: 0 })
    expect(store.retentionMs).toBe(500)
    const saved = await store.save({ data: sampleVideo('raise-first'), mediaType: 'video/mp4' })
    expect(saved.expiresAt - saved.createdAt).toBe(500)
  })

  it('reports a reconciling cleanup failure instead of pretending the store reconciled', async () => {
    const root = await tempDir()
    await writeFile(join(root, 'index'), 'not a directory', { mode: 0o600 })
    const store = new MediaStore(root, { now: () => clock, retentionMs: 100 })
    await expect(store.applyRetentionMs(50)).rejects.toMatchObject({
      code: 'CORRUPT',
      message: expect.stringContaining('index directory must not be a symlink') as string,
    })
  })

  it('refuses a store root that is a regular file', async () => {
    const root = join(await tempDir(), 'store-file')
    await writeFile(root, 'not a directory', { mode: 0o600 })
    const store = new MediaStore(root, { now: () => clock })
    await expect(store.save({ data: sampleVideo('file-root'), mediaType: 'video/mp4' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('must be a directory') as string,
    })
    if (process.platform !== 'win32') {
      // A path under a regular file fails with ENOTDIR, not ENOENT, so the read
      // surfaces the real failure instead of reporting a missing artifact.
      await expect(store.read('aa'.repeat(16))).rejects.toMatchObject({ code: 'ENOTDIR' })
    }
  })

  it('refuses a store whose objects path is a regular file', async () => {
    const root = await tempDir()
    await writeFile(join(root, 'objects'), 'not a directory', { mode: 0o600 })
    const store = new MediaStore(root, { now: () => clock })
    await expect(store.save({ data: sampleVideo('file-objects'), mediaType: 'video/mp4' })).rejects.toMatchObject({
      code: 'CORRUPT',
      message: expect.stringContaining('media parent path is not a directory') as string,
    })
  })

  it('refuses a bucket that is not a directory', async () => {
    const store = await tempStore()
    await mkdir(join(store.root, 'index'), { recursive: true, mode: 0o700 })
    await writeFile(join(store.root, 'index', 'ab'), 'not a bucket', { mode: 0o600 })
    await expect(store.cleanup()).rejects.toMatchObject({
      code: 'CORRUPT',
      message: expect.stringContaining('index bucket must not be a symlink') as string,
    })
  })

  it('reports an artifact whose object leaf disappeared as missing', async () => {
    const store = await tempStore()
    const data = sampleVideo('gone-object')
    const meta = await store.save({ data, mediaType: 'video/mp4' })
    await rm(objectLeaf(store.root, data))
    await expect(store.read(meta.artifactId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: expect.stringContaining('object is missing') as string,
    })
    expect(await store.lookup(meta.artifactId)).toEqual(meta)
  })

  it('refuses an object leaf that became a symlink or a directory', async () => {
    const symlinked = await tempStore()
    const symlinkData = sampleVideo('object-symlink')
    const symlinkMeta = await symlinked.save({ data: symlinkData, mediaType: 'video/mp4' })
    const symlinkPath = objectLeaf(symlinked.root, symlinkData)
    await rm(symlinkPath)
    await symlink(join(symlinked.root, 'elsewhere'), symlinkPath)
    await expect(symlinked.read(symlinkMeta.artifactId)).rejects.toMatchObject({
      code: 'CORRUPT',
      message: expect.stringContaining('must not be a symlink') as string,
    })

    const replaced = await tempStore()
    const replacedData = sampleVideo('object-directory')
    const replacedMeta = await replaced.save({ data: replacedData, mediaType: 'video/mp4' })
    const replacedPath = objectLeaf(replaced.root, replacedData)
    await rm(replacedPath)
    await mkdir(replacedPath)
    await expect(replaced.read(replacedMeta.artifactId)).rejects.toMatchObject({
      code: 'CORRUPT',
      message: expect.stringContaining('not a regular file') as string,
    })
  })

  it('refuses to reuse an object path that is not a regular file', async () => {
    const data = sampleVideo('object-shape')
    const store = await tempStore()
    await store.save({ data, mediaType: 'video/mp4' })
    const leaf = objectLeaf(store.root, data)
    await rm(leaf)
    await mkdir(leaf)
    await expect(store.save({ data, mediaType: 'video/mp4' })).rejects.toMatchObject({
      code: 'CORRUPT',
      message: expect.stringContaining('object path is not a regular file') as string,
    })
  })

  it('refuses to reuse an object whose bytes no longer match its digest', async () => {
    const data = sampleVideo('object-integrity')
    const store = await tempStore()
    await store.save({ data, mediaType: 'video/mp4' })
    await writeFile(objectLeaf(store.root, data), 'tampered-bytes', { mode: 0o600 })
    await expect(store.save({ data, mediaType: 'video/mp4' })).rejects.toMatchObject({
      code: 'CORRUPT',
      message: expect.stringContaining('stored object failed integrity verification') as string,
    })
  })

  it('refuses a stored object that grew past the read ceiling', async () => {
    const data = sampleVideo('grown-object')
    const store = await tempStore({ maxBytes: data.byteLength })
    const meta = await store.save({ data, mediaType: 'video/mp4' })
    await appendFile(objectLeaf(store.root, data), 'trailing-bytes')
    await expect(store.read(meta.artifactId)).rejects.toMatchObject({
      code: 'TOO_LARGE',
      message: expect.stringContaining('bounded read ceiling') as string,
    })
  })

  it('refuses to serve an index that outgrew the store ceiling', async () => {
    const data = sampleVideo('index-ceiling')
    const root = await tempDir()
    const meta = await new MediaStore(root, { now: () => clock }).save({ data, mediaType: 'video/mp4' })
    const strict = new MediaStore(root, { now: () => clock, maxBytes: data.byteLength - 1 })
    await expect(strict.read(meta.artifactId)).rejects.toMatchObject({
      code: 'CORRUPT',
      message: expect.stringContaining('store byte ceiling') as string,
    })
    expect(await strict.lookup(meta.artifactId)).toMatchObject({ bytes: data.byteLength })
  })

  it('refuses every malformed index document instead of trusting it', async () => {
    const store = await tempStore()
    const cases: Array<[string, string, RegExp]> = [
      ['a truncated document', '{oops', /not valid JSON/u],
      ['an array', '[]', /must contain an object/u],
      ['a JSON null', 'null', /must contain an object/u],
      ['a bare string', '"nope"', /must contain an object/u],
      ['another format version', indexDocument({ version: 2 }), /unsupported version/u],
      ['a non-hex artifact id', indexDocument({ artifactId: 'zz' }), /artifact id is invalid/u],
      ['a short digest', indexDocument({ sha256: 'abc' }), /digest is invalid/u],
      ['an unsupported media type', indexDocument({ mediaType: 'image/png' }), /type is unsupported/u],
      ['a zero byte length', indexDocument({ bytes: 0 }), /byte length is invalid/u],
      ['a fractional byte length', indexDocument({ bytes: 1.5 }), /byte length is invalid/u],
      ['a missing creation time', indexDocument({ createdAt: undefined }), /createdAt is invalid/u],
      ['an expiry at the creation time', indexDocument({ expiresAt: clock - 1_000 }), /expiresAt is invalid/u],
    ]
    for (const [index, [label, contents, message]] of cases.entries()) {
      const artifactId = `${index.toString(16).padStart(2, '0')}${'c'.repeat(30)}`
      await plantIndexLeaf(store.root, artifactId, contents)
      await expect(store.lookup(artifactId), label).rejects.toMatchObject({ code: 'CORRUPT', message })
    }
  })

  it('refuses an index leaf whose id does not match its filename', async () => {
    const store = await tempStore()
    const artifactId = 'ab'.repeat(16)
    await plantIndexLeaf(store.root, artifactId, indexDocument({ artifactId: 'cd'.repeat(16) }))
    await expect(store.lookup(artifactId)).rejects.toMatchObject({
      code: 'CORRUPT',
      message: expect.stringContaining('does not match its filename') as string,
    })
  })

  it('reclaims stale temporaries and strays while keeping live leaves', async () => {
    const store = await tempStore({ randomId: () => '0f'.repeat(16) })
    const meta = await store.save({ data: sampleVideo('tree'), mediaType: 'video/mp4' })
    const bucket = meta.artifactId.slice(0, 2)
    const objects = join(store.root, 'objects')
    const index = join(store.root, 'index')
    const dangling = join(store.root, 'missing-target')
    const temps = [
      join(objects, '.tmp-orphan'),
      join(objects, '.tmp-dangling'),
      join(index, '.tmp-orphan'),
      join(index, '.tmp-dangling'),
      join(index, bucket, '.tmp-orphan'),
      join(index, bucket, '.tmp-dangling'),
    ]

    await writeFile(join(objects, '.tmp-orphan'), 'x', { mode: 0o600 })
    await symlink(dangling, join(objects, '.tmp-dangling'))
    await mkdir(join(objects, '.tmp-closed'))
    await writeFile(join(objects, 'zz'), 'not a bucket', { mode: 0o600 })
    await mkdir(join(objects, 'ab'), { mode: 0o700 })
    await writeFile(join(objects, 'ab', 'not-a-digest'), 'x', { mode: 0o600 })
    await mkdir(join(objects, 'ab', '7f'.repeat(32)))
    await symlink(dangling, join(objects, 'ab', '8e'.repeat(32)))
    await writeFile(join(index, '.tmp-orphan'), 'x', { mode: 0o600 })
    await symlink(dangling, join(index, '.tmp-dangling'))
    await writeFile(join(index, 'zz'), 'not a bucket', { mode: 0o600 })
    await writeFile(join(index, bucket, '.tmp-orphan'), 'x', { mode: 0o600 })
    await symlink(dangling, join(index, bucket, '.tmp-dangling'))
    await mkdir(join(index, bucket, '.tmp-closed'))
    await writeFile(join(index, bucket, 'notes.txt'), 'x', { mode: 0o600 })

    await expect(store.cleanup()).resolves.toEqual({ expiredArtifacts: 0, removedObjects: 0 })
    for (const path of temps) expect(await exists(path), path).toBe(false)
    expect(await exists(join(objects, '.tmp-closed'))).toBe(true)
    expect(await exists(join(index, bucket, '.tmp-closed'))).toBe(true)
    expect(await exists(join(objects, 'ab', 'not-a-digest'))).toBe(true)
    expect(await exists(join(index, bucket, 'notes.txt'))).toBe(true)
    expect(await exists(indexLeaf(store.root, meta.artifactId))).toBe(true)
    expect((await store.read(meta.artifactId)).data).toEqual(sampleVideo('tree'))
  })

  it('reports an unknown artifact id as absent when deleting', async () => {
    const store = await tempStore()
    expect(await store.delete('aa'.repeat(16))).toBe(false)
  })

  it('keeps an object that a live sibling artifact still references', async () => {
    const store = await tempStore()
    const firstData = sampleVideo('delete-first')
    const secondData = sampleVideo('delete-second')
    const shared = sampleVideo('delete-shared')
    const first = await store.save({ data: firstData, mediaType: 'video/mp4' })
    const second = await store.save({ data: secondData, mediaType: 'video/mp4' })
    const kept = await store.save({ data: shared, mediaType: 'video/mp4' })
    const sharedAgain = await store.save({ data: shared, mediaType: 'video/webm' })

    expect(await store.delete(first.artifactId)).toBe(true)
    expect(await store.delete(second.artifactId)).toBe(true)
    expect(await exists(objectLeaf(store.root, firstData))).toBe(false)
    expect(await exists(objectLeaf(store.root, secondData))).toBe(false)

    expect(await store.delete(kept.artifactId)).toBe(true)
    expect(await exists(objectLeaf(store.root, shared))).toBe(true)
    expect((await store.read(sharedAgain.artifactId)).data).toEqual(shared)
  })

  it('tolerates a missing or non-file object when deleting an artifact', async () => {
    const missing = await tempStore()
    const missingData = sampleVideo('delete-missing-object')
    const missingMeta = await missing.save({ data: missingData, mediaType: 'video/mp4' })
    await rm(objectLeaf(missing.root, missingData))
    expect(await missing.delete(missingMeta.artifactId)).toBe(true)
    expect(await missing.lookup(missingMeta.artifactId)).toBeUndefined()

    const replaced = await tempStore()
    const replacedData = sampleVideo('delete-directory-object')
    const replacedMeta = await replaced.save({ data: replacedData, mediaType: 'video/mp4' })
    const replacedLeaf = objectLeaf(replaced.root, replacedData)
    await rm(replacedLeaf)
    await mkdir(replacedLeaf)
    expect(await replaced.delete(replacedMeta.artifactId)).toBe(true)
    expect(await exists(replacedLeaf)).toBe(true)
    expect(await replaced.lookup(replacedMeta.artifactId)).toBeUndefined()
  })

  it('refuses an artifact id generator that is not opaque hex', async () => {
    const store = await tempStore({ randomId: () => '../../etc/passwd' })
    await expect(store.save({ data: sampleVideo('bad-generator'), mediaType: 'video/mp4' })).rejects.toMatchObject({
      code: 'INVALID_ID',
      message: expect.stringContaining('opaque hex') as string,
    })
  })

  it('never publishes two artifacts under one id when two stores share a root', async () => {
    const root = await tempDir()
    const forced = 'bb'.repeat(16)
    const firstStore = new MediaStore(root, { now: () => clock, randomId: () => forced })
    const secondStore = new MediaStore(root, { now: () => clock, randomId: () => forced })
    const results = await Promise.allSettled([
      firstStore.save({ data: sampleVideo('shared-root-a'), mediaType: 'video/mp4' }),
      secondStore.save({ data: sampleVideo('shared-root-b'), mediaType: 'video/mp4' }),
    ])
    type Saved = Awaited<ReturnType<MediaStore['save']>>
    const fulfilled = results.filter((result): result is PromiseFulfilledResult<Saved> => {
      return result.status === 'fulfilled'
    })
    const rejected = results.filter(result => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'INVALID_ID' })
    const winner = fulfilled[0]!.value
    expect(winner.artifactId).toBe(forced)
    const stored = await firstStore.read(forced)
    const matchesFirst = Buffer.from(stored.data).equals(Buffer.from(sampleVideo('shared-root-a')))
    const matchesSecond = Buffer.from(stored.data).equals(Buffer.from(sampleVideo('shared-root-b')))
    expect(matchesFirst || matchesSecond).toBe(true)
    expect(matchesFirst && matchesSecond).toBe(false)
  })
})

describe('MediaStore filesystem-race tolerance', () => {
  it('reports a store root that vanished between the mode check and the assertion', async () => {
    const root = await tempDir()
    const racing = await importWithFaults([{ op: 'lstat', path: root, occurrence: 3, code: 'ENOENT' }])
    const store = new racing.MediaStore(root, { now: () => clock })
    await expect(store.save({ data: sampleVideo('root-vanished'), mediaType: 'video/mp4' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('media root directory is missing') as string,
    })
  })

  it('reports a store directory that vanished while its children were being prepared', async () => {
    const root = await tempDir()
    const objects = join(root, 'objects')
    const racing = await importWithFaults([{ op: 'lstat', path: objects, occurrence: 2, code: 'ENOENT' }])
    const store = new racing.MediaStore(root, { now: () => clock })
    await expect(store.save({ data: sampleVideo('bucket-vanished'), mediaType: 'video/mp4' })).rejects.toMatchObject({
      code: 'CORRUPT',
      message: expect.stringContaining('media parent directory is missing') as string,
    })
  })

  it('refuses a store root that a competing process replaced with a symlink', async () => {
    const root = await tempDir()
    const racing = await importWithFaults([
      { op: 'lstat', path: root, occurrence: 4, result: () => fakeStats('symlink') },
    ])
    const store = new racing.MediaStore(root, { now: () => clock })
    await expect(store.save({ data: sampleVideo('root-symlink'), mediaType: 'video/mp4' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('media root directory must not be a symlink') as string,
    })
  })

  it('refuses a store root that a competing process replaced with a regular file', async () => {
    const root = await tempDir()
    const racing = await importWithFaults([{ op: 'lstat', path: root, occurrence: 4, result: () => fakeStats('file') }])
    const store = new racing.MediaStore(root, { now: () => clock })
    await expect(store.save({ data: sampleVideo('root-file'), mediaType: 'video/mp4' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('media root path is not a directory') as string,
    })
  })

  it('tolerates a bucket a competing writer created first, and surfaces any other mkdir failure', async () => {
    const raced = await tempDir()
    const racing = await importWithFaults([
      { op: 'mkdir', path: join(raced, 'objects'), after: true, code: 'EEXIST' },
    ])
    const store = new racing.MediaStore(raced, { now: () => clock })
    const meta = await store.save({ data: sampleVideo('raced-bucket'), mediaType: 'video/mp4' })
    expect((await store.read(meta.artifactId)).data).toEqual(sampleVideo('raced-bucket'))

    const denied = await tempDir()
    const refusing = await importWithFaults([{ op: 'mkdir', path: join(denied, 'objects'), code: 'EACCES' }])
    await expect(
      new refusing.MediaStore(denied, { now: () => clock }).save({
        data: sampleVideo('denied-bucket'),
        mediaType: 'video/mp4',
      }),
    ).rejects.toMatchObject({ code: 'EACCES' })
    expect(await exists(join(denied, 'objects'))).toBe(false)
  })

  it('reports a legacy media directory that a competing process moved first', async () => {
    const parent = await tempDir('dsh-media-migrate-')
    const legacy = join(parent, '.dsh-coding-subscription-oauth-media')
    const current = join(parent, '.dsh-subscription-auth-media')
    await mkdir(legacy, { recursive: true, mode: 0o700 })
    const racing = await importWithFaults([{ op: 'rename', path: current, code: 'ENOENT' }])
    await expect(racing.migrateLegacyMediaStoreDir(current, legacy)).resolves.toBe(false)
    expect(await exists(current)).toBe(false)
    expect(await exists(legacy)).toBe(true)
  })

  it('reports a legacy media directory the filesystem refused to move', async () => {
    const parent = await tempDir('dsh-media-migrate-')
    const legacy = join(parent, '.dsh-coding-subscription-oauth-media')
    const current = join(parent, '.dsh-subscription-auth-media')
    await mkdir(legacy, { recursive: true, mode: 0o700 })
    const racing = await importWithFaults([{ op: 'rename', path: current, code: 'EACCES' }])
    await expect(racing.migrateLegacyMediaStoreDir(current, legacy)).rejects.toMatchObject({
      code: 'CORRUPT',
      message: expect.stringContaining('could not move the legacy media directory') as string,
    })
  })

  it('reports a leaf the kernel refuses to open without following it', async () => {
    const store = await tempStore()
    const data = sampleVideo('loop-leaf')
    const meta = await store.save({ data, mediaType: 'video/mp4' })
    const leaf = objectLeaf(store.root, data)

    const looped = await importWithFaults([{ op: 'open', path: leaf, code: 'ELOOP' }])
    await expect(new looped.MediaStore(store.root, { now: () => clock }).read(meta.artifactId)).rejects.toMatchObject({
      code: 'CORRUPT',
      message: expect.stringContaining('media path is a symlink') as string,
    })

    const denied = await importWithFaults([{ op: 'open', path: leaf, code: 'EACCES' }])
    await expect(new denied.MediaStore(store.root, { now: () => clock }).read(meta.artifactId)).rejects.toMatchObject({
      code: 'EACCES',
    })
  })

  it('refuses a leaf whose open descriptor disagrees with the leaf', async () => {
    const store = await tempStore()
    const data = sampleVideo('descriptor')
    const meta = await store.save({ data, mediaType: 'video/mp4' })
    const leaf = objectLeaf(store.root, data)

    const mismatched = await importWithFaults([
      {
        op: 'open',
        path: leaf,
        handle: (handle: FileHandle) => ({
          close: handle.close.bind(handle),
          read: async () => ({ bytesRead: 0 }),
          stat: async () => fakeStats('directory'),
        }),
      },
    ])
    await expect(
      new mismatched.MediaStore(store.root, { now: () => clock }).read(meta.artifactId),
    ).rejects.toMatchObject({
      code: 'CORRUPT',
      message: expect.stringContaining('media leaf failed a no-follow stat') as string,
    })

    const truncated = await importWithFaults([
      {
        op: 'open',
        path: leaf,
        handle: (handle: FileHandle) => ({
          close: handle.close.bind(handle),
          read: async () => ({ bytesRead: 0 }),
          stat: handle.stat.bind(handle),
        }),
      },
    ])
    await expect(
      new truncated.MediaStore(store.root, { now: () => clock }).read(meta.artifactId),
    ).rejects.toMatchObject({
      code: 'CORRUPT',
      message: expect.stringContaining('media leaf could not be read completely') as string,
    })
  })

  it('publishes nothing when a temporary leaf cannot be written', async () => {
    const root = await tempDir()
    const racing = await importWithFaults([
      {
        op: 'open',
        path: path => path.includes('.tmp-'),
        handle: (handle: FileHandle) => ({
          chmod: async () => undefined,
          writeFile: async () => {
            await handle.close().catch(() => undefined)
            throw faultError('ENOSPC')
          },
          close: async () => {
            throw faultError('EIO')
          },
        }),
      },
      { op: 'unlink', path: path => path.includes('.tmp-'), code: 'EACCES' },
    ])
    const store = new racing.MediaStore(root, { now: () => clock })
    await expect(store.save({ data: sampleVideo('write-failed'), mediaType: 'video/mp4' })).rejects.toMatchObject({
      code: 'ENOSPC',
    })
    expect(await indexLeaves(root)).toEqual([])
    expect(await exists(join(root, 'objects', 'aa'))).toBe(false)
  })

  it('keeps a published artifact when its temporary leaf cannot be removed', async () => {
    const root = await tempDir()
    const racing = await importWithFaults([
      { op: 'unlink', path: path => path.includes('.tmp-'), after: true, code: 'EACCES' },
    ])
    const store = new racing.MediaStore(root, { now: () => clock })
    const meta = await store.save({ data: sampleVideo('stuck-temp'), mediaType: 'video/mp4' })
    expect((await store.read(meta.artifactId)).data).toEqual(sampleVideo('stuck-temp'))
  })

  it('adopts an object a competing writer published first', async () => {
    const root = await tempDir()
    const data = sampleVideo('adopt-object')
    const racing = await importWithFaults([
      { op: 'link', path: path => path.includes('objects'), after: true, code: 'EEXIST' },
    ])
    const store = new racing.MediaStore(root, { now: () => clock })
    const meta = await store.save({ data, mediaType: 'video/mp4' })
    expect((await store.read(meta.artifactId)).data).toEqual(data)
  })

  it.skipIf(process.platform === 'win32')('refuses an index leaf that turned into a symlink as it was written', async () => {
    const root = await tempDir()
    const forced = 'de'.repeat(16)
    const data = sampleVideo('index-symlink-late')
    await new MediaStore(root, { now: () => clock, randomId: () => forced }).save({
      data,
      mediaType: 'video/mp4',
    })
    const leaf = indexLeaf(root, forced)
    await rm(leaf)
    const outside = join(root, 'outside-late-index.json')
    await writeFile(outside, '{"version":1}', { mode: 0o600 })
    const racing = await importWithFaults([
      { op: 'lstat', path: leaf, occurrence: 2, effect: () => symlink(outside, leaf) },
    ])
    const store = new racing.MediaStore(root, { now: () => clock, randomId: () => forced })
    await expect(store.save({ data, mediaType: 'video/mp4' })).rejects.toMatchObject({
      code: 'CORRUPT',
      message: expect.stringContaining('media leaf must not be a symlink') as string,
    })
    expect(await readFile(outside, 'utf8')).toBe('{"version":1}')
  })

  it('treats an index leaf that vanished between its check and its read as absent', async () => {
    const store = await tempStore()
    const meta = await store.save({ data: sampleVideo('index-vanished'), mediaType: 'video/mp4' })
    const racing = await importWithFaults([
      { op: 'lstat', path: indexLeaf(store.root, meta.artifactId), occurrence: 2, code: 'ENOENT' },
    ])
    const gone = new racing.MediaStore(store.root, { now: () => clock })
    expect(await gone.lookup(meta.artifactId)).toBeUndefined()
    // The leaf never actually moved: only the injected stat lied about it.
    expect(await gone.lookup(meta.artifactId)).toEqual(meta)
  })

  it('refuses an object a competing writer published with other bytes', async () => {
    const root = await tempDir()
    const racing = await importWithFaults([
      {
        op: 'link',
        path: path => path.includes('objects'),
        effect: target => writeFile(target, 'poisoned-bytes', { mode: 0o600 }),
        code: 'EEXIST',
      },
    ])
    const store = new racing.MediaStore(root, { now: () => clock })
    await expect(store.save({ data: sampleVideo('poisoned-object'), mediaType: 'video/mp4' })).rejects.toMatchObject({
      code: 'CORRUPT',
      message: expect.stringContaining('integrity verification') as string,
    })
    expect(await indexLeaves(root)).toEqual([])
  })

  it('reports an index leaf the store was not allowed to publish', async () => {
    const root = await tempDir()
    const racing = await importWithFaults([
      { op: 'link', path: path => path.includes('index'), code: 'EPERM' },
      { op: 'unlink', path: path => path.includes('.tmp-'), code: 'EACCES' },
    ])
    const store = new racing.MediaStore(root, { now: () => clock })
    await expect(store.save({ data: sampleVideo('index-denied'), mediaType: 'video/mp4' })).rejects.toMatchObject({
      code: 'EPERM',
    })
    expect(await indexLeaves(root)).toEqual([])
  })

  it('refuses an index leaf a competing writer published first', async () => {
    const root = await tempDir()
    const forced = 'cc'.repeat(16)
    const data = sampleVideo('index-taken')
    const leaf = indexLeaf(root, forced)
    const racing = await importWithFaults([
      {
        op: 'lstat',
        path: leaf,
        occurrence: 2,
        effect: () => writeFile(leaf, indexDocument({ artifactId: forced, sha256: digestOf(data) }), { mode: 0o600 }),
      },
    ])
    const store = new racing.MediaStore(root, { now: () => clock, randomId: () => forced })
    await expect(store.save({ data, mediaType: 'video/mp4' })).rejects.toMatchObject({
      code: 'INVALID_ID',
      message: expect.stringContaining('unable to allocate an unused artifact id') as string,
    })
    expect(await indexLeaves(root)).toEqual([`${forced}.json`])
  })

  it.skipIf(process.platform === 'win32')('refuses an index leaf that became a symlink before it was written', async () => {
    const root = await tempDir()
    const forced = 'dd'.repeat(16)
    const data = sampleVideo('index-symlink')
    const first = new MediaStore(root, { now: () => clock, randomId: () => forced })
    await first.save({ data, mediaType: 'video/mp4' })
    const leaf = indexLeaf(root, forced)
    await rm(leaf)
    const outside = join(root, 'outside-index.json')
    await writeFile(outside, '{"version":1}', { mode: 0o600 })
    const racing = await importWithFaults([
      { op: 'lstat', path: leaf, occurrence: 1, effect: () => symlink(outside, leaf) },
    ])
    const store = new racing.MediaStore(root, { now: () => clock, randomId: () => forced })
    await expect(store.save({ data, mediaType: 'video/mp4' })).rejects.toMatchObject({
      code: 'CORRUPT',
      message: expect.stringContaining('media index leaf must not be a symlink') as string,
    })
    expect(await readFile(outside, 'utf8')).toBe('{"version":1}')
  })

  it('treats an unlistable bucket as empty and surfaces any other listing failure', async () => {
    const store = await tempStore()
    const meta = await store.save({ data: sampleVideo('unlistable'), mediaType: 'video/mp4' })
    const orphan = join(store.root, 'objects', 'ab', 'ff'.repeat(32))
    await mkdir(join(store.root, 'objects', 'ab'), { recursive: true, mode: 0o700 })
    await writeFile(orphan, sampleVideo('orphan'), { mode: 0o600 })

    const vanished = await importWithFaults([
      { op: 'readdir', path: join(store.root, 'objects'), code: 'ENOENT' },
    ])
    const tolerant = new vanished.MediaStore(store.root, { now: () => clock })
    await expect(tolerant.cleanup()).resolves.toEqual({ expiredArtifacts: 0, removedObjects: 0 })
    expect(await exists(orphan)).toBe(true)
    expect((await tolerant.read(meta.artifactId)).data).toEqual(sampleVideo('unlistable'))

    const denied = await importWithFaults([{ op: 'readdir', path: join(store.root, 'objects'), code: 'EACCES' }])
    await expect(new denied.MediaStore(store.root, { now: () => clock }).cleanup()).rejects.toMatchObject({
      code: 'EACCES',
    })
  })

  it('treats an unlistable bucket directory as empty and surfaces any other bucket failure', async () => {
    const store = await tempStore()
    const orphan = join(store.root, 'objects', 'ab', 'ff'.repeat(32))
    await mkdir(join(store.root, 'objects', 'ab'), { recursive: true, mode: 0o700 })
    await writeFile(orphan, sampleVideo('orphan'), { mode: 0o600 })
    const bucket = join(store.root, 'objects', 'ab')

    const vanished = await importWithFaults([{ op: 'readdir', path: bucket, code: 'ENOENT' }])
    await expect(new vanished.MediaStore(store.root, { now: () => clock }).cleanup()).resolves.toEqual({
      expiredArtifacts: 0,
      removedObjects: 0,
    })
    expect(await exists(orphan)).toBe(true)

    const denied = await importWithFaults([{ op: 'readdir', path: bucket, code: 'EPERM' }])
    await expect(new denied.MediaStore(store.root, { now: () => clock }).cleanup()).rejects.toMatchObject({
      code: 'EPERM',
    })

    const vanishedBucket = await importWithFaults([{ op: 'lstat', path: bucket, code: 'ENOENT' }])
    await expect(new vanishedBucket.MediaStore(store.root, { now: () => clock }).cleanup()).resolves.toEqual({
      expiredArtifacts: 0,
      removedObjects: 0,
    })
    expect(await exists(orphan)).toBe(true)
  })

  it('treats a bucket entry that vanished before its stat as absent', async () => {
    const store = await tempStore()
    const objects = join(store.root, 'objects', 'ab')
    await mkdir(objects, { recursive: true, mode: 0o700 })
    const gone = join(objects, 'ff'.repeat(32))
    const other = join(objects, 'ee'.repeat(32))
    await writeFile(gone, sampleVideo('gone-entry'), { mode: 0o600 })
    await writeFile(other, sampleVideo('other-entry'), { mode: 0o600 })

    const racing = await importWithFaults([{ op: 'lstat', path: gone, code: 'ENOENT' }])
    await expect(new racing.MediaStore(store.root, { now: () => clock }).cleanup()).resolves.toEqual({
      expiredArtifacts: 0,
      removedObjects: 1,
    })
    expect(await exists(gone)).toBe(true)
    expect(await exists(other)).toBe(false)
  })

  it('leaves an unreadable object entry for the next pass', async () => {
    const store = await tempStore()
    const objects = join(store.root, 'objects', 'ab')
    await mkdir(objects, { recursive: true, mode: 0o700 })
    const missing = join(objects, 'ff'.repeat(32))
    const replaced = join(objects, 'ee'.repeat(32))
    const orphan = join(objects, 'dd'.repeat(32))
    for (const path of [missing, replaced, orphan]) await writeFile(path, sampleVideo(path), { mode: 0o600 })

    const racing = await importWithFaults([
      { op: 'lstat', path: missing, occurrence: 2, code: 'ENOENT' },
      { op: 'lstat', path: replaced, occurrence: 2, result: () => fakeStats('directory') },
    ])
    await expect(new racing.MediaStore(store.root, { now: () => clock }).cleanup()).resolves.toEqual({
      expiredArtifacts: 0,
      removedObjects: 1,
    })
    expect(await exists(missing)).toBe(true)
    expect(await exists(replaced)).toBe(true)
    expect(await exists(orphan)).toBe(false)
  })

  it('keeps the leftovers a locked-down store directory refuses to release', async () => {
    const store = await tempStore({ randomId: () => '0f'.repeat(16) })
    const meta = await store.save({ data: sampleVideo('locked-leftovers'), mediaType: 'video/mp4' })
    const objects = join(store.root, 'objects')
    const index = join(store.root, 'index')
    const bucket = meta.artifactId.slice(0, 2)
    const leftovers = [join(objects, '.tmp-orphan'), join(index, bucket, '.tmp-orphan')]
    const dead = join(index, bucket, '8e'.repeat(32))
    await writeFile(leftovers[0]!, 'x', { mode: 0o600 })
    await writeFile(leftovers[1]!, 'x', { mode: 0o600 })
    await symlink(join(store.root, 'missing-target'), dead)

    const racing = await importWithFaults([
      { op: 'unlink', path: path => path.includes('.tmp-') || path === dead, code: 'EACCES' },
    ])
    const locked = new racing.MediaStore(store.root, { now: () => clock })
    await expect(locked.cleanup()).resolves.toEqual({ expiredArtifacts: 0, removedObjects: 0 })
    for (const path of [...leftovers, dead]) expect(await exists(path), path).toBe(true)
    expect(await exists(indexLeaf(store.root, meta.artifactId))).toBe(true)
  })

  it('reports an expired leaf the filesystem refuses to delete', async () => {
    const store = await tempStore({ retentionMs: 10, randomId: () => '0f'.repeat(16) })
    const meta = await store.save({ data: sampleVideo('stuck-expiry'), mediaType: 'video/mp4' })
    const corrupt = await plantIndexLeaf(store.root, 'ee'.repeat(16), '{oops')
    const orphan = join(store.root, 'objects', 'ab', 'ff'.repeat(32))
    await mkdir(join(store.root, 'objects', 'ab'), { recursive: true, mode: 0o700 })
    await writeFile(orphan, sampleVideo('stuck-orphan'), { mode: 0o600 })
    clock += 11

    const racing = await importWithFaults([
      {
        op: 'unlink',
        path: path => path.startsWith(join(store.root, 'index')) || path.startsWith(join(store.root, 'objects')),
        code: 'EACCES',
      },
    ])
    const stuck = new racing.MediaStore(store.root, { now: () => clock, retentionMs: 10 })
    await expect(stuck.cleanup()).resolves.toEqual({ expiredArtifacts: 2, removedObjects: 2 })
    expect(await exists(corrupt)).toBe(true)
    expect(await exists(indexLeaf(store.root, meta.artifactId))).toBe(true)
    expect(await exists(orphan)).toBe(true)
    expect(await exists(objectLeaf(store.root, sampleVideo('stuck-expiry')))).toBe(true)
  })

  it('reports a delete whose index leaf the filesystem will not unlink', async () => {
    const store = await tempStore()
    const first = await store.save({ data: sampleVideo('unlink-vanished'), mediaType: 'video/mp4' })
    const second = await store.save({ data: sampleVideo('unlink-refused'), mediaType: 'video/mp4' })

    const vanished = await importWithFaults([
      { op: 'unlink', path: indexLeaf(store.root, first.artifactId), after: true, code: 'ENOENT' },
    ])
    const tolerant = new vanished.MediaStore(store.root, { now: () => clock })
    expect(await tolerant.delete(first.artifactId)).toBe(true)
    expect(await tolerant.lookup(first.artifactId)).toBeUndefined()
    expect(await exists(objectLeaf(store.root, sampleVideo('unlink-vanished')))).toBe(false)

    const refused = await importWithFaults([{ op: 'unlink', path: indexLeaf(store.root, second.artifactId), code: 'EPERM' }])
    await expect(new refused.MediaStore(store.root, { now: () => clock }).delete(second.artifactId)).rejects.toMatchObject({
      code: 'EPERM',
    })
    expect(await exists(indexLeaf(store.root, second.artifactId))).toBe(true)
  })

  it('reports an index leaf that turned into a symlink during the delete', async () => {
    const store = await tempStore()
    const data = sampleVideo('racing-symlink')
    const meta = await store.save({ data, mediaType: 'video/mp4' })
    const leaf = indexLeaf(store.root, meta.artifactId)
    const racing = await importWithFaults([
      { op: 'lstat', path: leaf, occurrence: 3, result: () => fakeStats('symlink') },
      { op: 'unlink', path: leaf, after: true, code: 'ENOENT' },
    ])
    expect(await new racing.MediaStore(store.root, { now: () => clock }).delete(meta.artifactId)).toBe(true)
    expect(await exists(leaf)).toBe(false)
    // The symlink arm returns before the reference scan, so the object survives.
    expect(await exists(objectLeaf(store.root, data))).toBe(true)
  })

  it('reports a deleted artifact whose object the filesystem will not release', async () => {
    const store = await tempStore()
    const data = sampleVideo('stuck-object')
    const meta = await store.save({ data, mediaType: 'video/mp4' })
    const object = objectLeaf(store.root, data)
    const racing = await importWithFaults([{ op: 'unlink', path: object, code: 'EACCES' }])
    const stuck = new racing.MediaStore(store.root, { now: () => clock })
    expect(await stuck.delete(meta.artifactId)).toBe(true)
    expect(await stuck.lookup(meta.artifactId)).toBeUndefined()
    expect(await exists(object)).toBe(true)
  })

  it('accounts only for the objects it can still see', async () => {
    const root = await tempDir()
    const firstData = sampleVideo('quota-one')
    const secondData = sampleVideo('quota-two')
    const first = new MediaStore(root, { now: () => clock })
    const firstMeta = await first.save({ data: firstData, mediaType: 'video/mp4' })

    const racing = await importWithFaults([
      { op: 'lstat', path: objectLeaf(root, firstData), occurrence: 3, result: () => fakeStats('symlink') },
    ])
    const store = new racing.MediaStore(root, {
      now: () => clock,
      maxBytes: secondData.byteLength,
      maxTotalBytes: secondData.byteLength * 2,
    })
    const second = await store.save({ data: secondData, mediaType: 'video/mp4' })
    expect((await store.read(second.artifactId)).data).toEqual(secondData)
    expect((await store.read(firstMeta.artifactId)).data).toEqual(firstData)
  })

  it('reports byte accounting that overflowed instead of trusting it', async () => {
    const root = await tempDir()
    const firstData = sampleVideo('overflow-first')
    const secondData = sampleVideo('overflow-second')
    const first = new MediaStore(root, { now: () => clock })
    await first.save({ data: firstData, mediaType: 'video/mp4' })
    await first.save({ data: secondData, mediaType: 'video/mp4' })

    const racing = await importWithFaults([
      { op: 'lstat', path: objectLeaf(root, firstData), result: () => fakeStats('file', Number.MAX_SAFE_INTEGER) },
      { op: 'lstat', path: objectLeaf(root, secondData), result: () => fakeStats('file', Number.MAX_SAFE_INTEGER) },
    ])
    const store = new racing.MediaStore(root, { now: () => clock })
    await expect(store.save({ data: sampleVideo('overflow-third'), mediaType: 'video/mp4' })).rejects.toMatchObject({
      code: 'CORRUPT',
      message: expect.stringContaining('byte accounting overflowed') as string,
    })
  })
})

describe('MediaStore open-flag derivation', () => {
  it('runs the Windows write and migration seams when the platform reports win32', async () => {
    const original = process.platform
    const parent = await tempDir('dsh-media-platform-')
    const legacy = join(parent, '.dsh-coding-subscription-oauth-media')
    await mkdir(join(legacy, 'objects'), { recursive: true, mode: 0o700 })
    const root = join(parent, 'store')
    vi.resetModules()
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      const windows = await import('../src/media-store.ts')
      expect(await windows.migrateLegacyMediaStoreDir(join(parent, 'current'), legacy)).toBe(true)
      const store = new windows.MediaStore(root, { now: () => clock })
      const data = sampleVideo('win32-seam')
      const meta = await store.save({ data, mediaType: 'video/mp4' })
      expect((await store.read(meta.artifactId)).data).toEqual(data)
      expect(await store.delete(meta.artifactId)).toBe(true)
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true })
      vi.resetModules()
    }
  })

  it('falls back to a plain open when the platform exposes no no-follow flag', async () => {
    const root = await tempDir()
    vi.resetModules()
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>()
      return { ...actual, constants: { ...actual.constants, O_NOFOLLOW: undefined } }
    })
    try {
      const portable = await import('../src/media-store.ts')
      const store = new portable.MediaStore(root, { now: () => clock })
      const meta = await store.save({ data: sampleVideo('no-nofollow'), mediaType: 'video/mp4' })
      expect((await store.read(meta.artifactId)).data).toEqual(sampleVideo('no-nofollow'))
    } finally {
      vi.doUnmock('node:fs')
      vi.resetModules()
    }
  })
})

describe('Content-Disposition filename sanitization', () => {
  it('emits a plain ASCII filename parameter for safe artifact ids', async () => {
    const store = await tempStore()
    const meta = await store.save({ data: sampleVideo('fname'), mediaType: 'video/mp4' })
    const { mediaDownloadHeaders } = await import('../src/media-store.ts')
    const headers = mediaDownloadHeaders(meta)
    expect(headers['Content-Disposition']).toBe(`attachment; filename="imagine-${meta.artifactId}.mp4"`)
    expect(headers['Content-Type']).toBe('video/mp4')
    expect(headers['Cache-Control']).toContain('no-store')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
  })

  it('uses an ASCII fallback plus RFC 5987 for a requested Unicode or header-shaped name', async () => {
    const store = await tempStore()
    const meta = await store.save({
      data: sampleVideo('unsafe-name'),
      mediaType: 'video/webm',
      name: '录屏";evil.webm',
    })
    const { mediaDownloadHeaders } = await import('../src/media-store.ts')
    const header = mediaDownloadHeaders(meta)['Content-Disposition']
    expect(header).toMatch(/^attachment; filename="evil\.webm"; filename\*=UTF-8''/u)
    expect(header).toContain('%22%3B')
    expect(header).not.toContain('录屏')
    expect(header).not.toContain('\r')
    expect(header).not.toContain('\n')

    const unicodeOnly = await store.save({
      data: sampleVideo('unicode-name'),
      mediaType: 'video/mp4',
      name: '视频',
    })
    const unicodeHeader = mediaDownloadHeaders(unicodeOnly)['Content-Disposition']
    expect(unicodeHeader).toContain(`filename="imagine-${unicodeOnly.artifactId}.mp4"`)
    expect(unicodeHeader).toContain("filename*=UTF-8''")
  })

  it('re-encodes the punctuation RFC 5987 reserves inside the encoded filename', async () => {
    const store = await tempStore()
    const { mediaDownloadHeaders } = await import('../src/media-store.ts')
    const meta = await store.save({
      data: sampleVideo('rfc5987'),
      mediaType: 'video/mp4',
      name: "a'b(c)d*e!f 录屏.mp4",
    })
    const header = mediaDownloadHeaders(meta)['Content-Disposition']
    const encoded = header.slice(header.indexOf("filename*=UTF-8''") + "filename*=UTF-8''".length)
    expect(encoded).toContain('%27')
    expect(encoded).toContain('%28')
    expect(encoded).toContain('%29')
    expect(encoded).toContain('%2A')
    expect(encoded).toContain('%21')
    expect(encoded).not.toContain("'")
    expect(header).toMatch(/filename="a'b\(c\)d\*e!f \.mp4"/u)
  })
})

describe('migrateLegacyMediaStoreDir', () => {
  async function tempParent(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-media-migrate-'))
    temporaryDirectories.push(dir)
    return dir
  }

  it('moves a pre-rename directory and keeps its artifacts and mode', async () => {
    const parent = await tempParent()
    const legacy = join(parent, '.dsh-coding-subscription-oauth-media')
    const current = join(parent, '.dsh-subscription-auth-media')
    await mkdir(join(legacy, 'objects'), { recursive: true, mode: 0o700 })
    await writeFile(join(legacy, 'objects', 'clip.mp4'), sampleVideo(), { mode: 0o600 })

    expect(await migrateLegacyMediaStoreDir(current, legacy)).toBe(true)
    expect(await readFile(join(current, 'objects', 'clip.mp4'))).toStrictEqual(Buffer.from(sampleVideo()))
    if (process.platform !== 'win32') expect((await stat(current)).mode & 0o777).toBe(0o700)
    await expect(stat(legacy)).rejects.toThrow()
  })

  it('never overwrites an existing current directory', async () => {
    const parent = await tempParent()
    const legacy = join(parent, '.dsh-coding-subscription-oauth-media')
    const current = join(parent, '.dsh-subscription-auth-media')
    await mkdir(legacy, { recursive: true, mode: 0o700 })
    await writeFile(join(legacy, 'stale'), 'old', { mode: 0o600 })
    await mkdir(current, { recursive: true, mode: 0o700 })
    await writeFile(join(current, 'kept'), 'new', { mode: 0o600 })

    expect(await migrateLegacyMediaStoreDir(current, legacy)).toBe(false)
    expect(await readFile(join(current, 'kept'), 'utf8')).toBe('new')
    expect(await readFile(join(legacy, 'stale'), 'utf8')).toBe('old')
  })

  it('does no work without a legacy directory, and refuses to follow a symlink', async () => {
    const parent = await tempParent()
    const current = join(parent, '.dsh-subscription-auth-media')
    const legacy = join(parent, '.dsh-coding-subscription-oauth-media')
    expect(await migrateLegacyMediaStoreDir(current, legacy)).toBe(false)
    expect(await migrateLegacyMediaStoreDir(current, current)).toBe(false)

    const elsewhere = join(parent, 'elsewhere')
    await mkdir(elsewhere, { recursive: true, mode: 0o700 })
    await symlink(elsewhere, legacy)
    expect(await migrateLegacyMediaStoreDir(current, legacy)).toBe(false)
    await expect(stat(current)).rejects.toThrow()
  })
})
