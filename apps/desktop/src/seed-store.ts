/** Deterministic archive transport for the desktop seed's pnpm store. */

import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { create, extract, list } from 'tar'
import { renameRetryingWindowsLocks } from './rename-retry.ts'

/** Directory containing the seed's uncompressed pnpm store archives. */
export const SEED_STORE_ARCHIVE_DIR = 'store-archives'

/** Manifest describing the deterministic pnpm store archive set. */
export const SEED_STORE_ARCHIVE_MANIFEST = 'store-archives.json'

const DEFAULT_SHARD_COUNT = 16
const ARCHIVE_NAME_PATTERN = /^store-[0-9a-f]{2}\.tar$/u
const STORE_VERSION_PATTERN = /^v\d+$/u

interface SeedStoreArchiveRecord {
  readonly file: string
  readonly entries: number
}

interface SeedStoreArchiveManifest {
  readonly schemaVersion: 1
  readonly shardCount: number
  readonly archives: readonly SeedStoreArchiveRecord[]
}

function storeFiles(storeRoot: string): readonly string[] {
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error(`desktop seed: pnpm store contains a symbolic link: ${relative(storeRoot, path)}`)
      }
      if (entry.isDirectory()) {
        visit(path)
        continue
      }
      if (!entry.isFile()) {
        throw new Error(`desktop seed: pnpm store contains an unsupported file: ${relative(storeRoot, path)}`)
      }
      files.push(relative(storeRoot, path).split(sep).join('/'))
    }
  }
  visit(storeRoot)
  return files.sort((left, right) => left.localeCompare(right))
}

function shardFor(path: string, shardCount: number): number {
  return createHash('sha256').update(path).digest().readUInt32BE(0) % shardCount
}

function readArchiveManifest(seedRoot: string): SeedStoreArchiveManifest {
  const path = join(seedRoot, SEED_STORE_ARCHIVE_MANIFEST)
  const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (typeof value !== 'object' || value === null) {
    throw new Error(`desktop seed: invalid pnpm store archive manifest ${path}`)
  }
  const candidate = value as Record<string, unknown>
  if (candidate.schemaVersion !== 1 || !Number.isSafeInteger(candidate.shardCount)
    || (candidate.shardCount as number) < 1 || (candidate.shardCount as number) > 256
    || !Array.isArray(candidate.archives) || candidate.archives.length === 0) {
    throw new Error(`desktop seed: invalid pnpm store archive manifest ${path}`)
  }
  const names = new Set<string>()
  const archives = candidate.archives.map((entry): SeedStoreArchiveRecord => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`desktop seed: invalid pnpm store archive record in ${path}`)
    }
    const record = entry as Record<string, unknown>
    if (typeof record.file !== 'string' || !ARCHIVE_NAME_PATTERN.test(record.file)
      || names.has(record.file) || !Number.isSafeInteger(record.entries) || (record.entries as number) < 1) {
      throw new Error(`desktop seed: invalid pnpm store archive record in ${path}`)
    }
    const shard = Number.parseInt(record.file.slice('store-'.length, -'.tar'.length), 16)
    if (shard >= (candidate.shardCount as number)) {
      throw new Error(`desktop seed: pnpm store archive shard is outside the manifest range in ${path}`)
    }
    names.add(record.file)
    return { file: record.file, entries: record.entries as number }
  })
  return {
    schemaVersion: 1,
    shardCount: candidate.shardCount as number,
    archives,
  }
}

function assertArchivePath(path: string): void {
  if (path === '' || path.startsWith('/') || path.includes('\\') || path.includes('\0')
    || path.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(`desktop seed: unsafe pnpm store archive path ${JSON.stringify(path)}`)
  }
}

/**
 * Remove pnpm's registrations for projects that populated the seed store.
 * @param storeRoot - pnpm store directory included in the desktop seed.
 */
export function removePnpmProjectRegistrations(storeRoot: string): void {
  for (const entry of readdirSync(storeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^v\d+$/u.test(entry.name)) continue
    rmSync(join(storeRoot, entry.name, 'projects'), { recursive: true, force: true })
  }
}

function mergeStoreIndex(source: string, destination: string): void {
  if (!existsSync(destination)) {
    copyFileSync(source, destination)
    return
  }
  const database = new DatabaseSync(destination)
  let attached = false
  try {
    database.exec('PRAGMA busy_timeout=5000')
    database.prepare('ATTACH DATABASE ? AS seed').run(source)
    attached = true
    database.exec('BEGIN IMMEDIATE')
    let committed = false
    try {
      database.exec('INSERT OR REPLACE INTO package_index (key, data) SELECT key, data FROM seed.package_index')
      database.exec('COMMIT')
      committed = true
    } finally {
      if (!committed) database.exec('ROLLBACK')
    }
  } finally {
    if (attached) database.exec('DETACH DATABASE seed')
    database.close()
  }
}

function isStoreIndexPath(path: string): boolean {
  const parts = path.split('/')
  return parts.length === 2 && STORE_VERSION_PATTERN.test(parts[0] as string) && parts[1] === 'index.db'
}

/**
 * Move every entry of `source` except the index databases into `destination`. A directory the destination lacks
 * moves whole unless it holds an index; a file replaces the destination's file at the same path.
 */
async function moveStoreEntries(
  source: string,
  destination: string,
  prefix: string,
  indexPaths: readonly string[],
): Promise<void> {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (indexPaths.includes(path)) continue
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isDirectory() && (existsSync(to) || indexPaths.some(index => index.startsWith(`${path}/`)))) {
      mkdirSync(to, { recursive: true, mode: 0o700 })
      await moveStoreEntries(from, to, path, indexPaths)
      continue
    }
    await renameRetryingWindowsLocks(from, to)
  }
}

/**
 * Merge a completely extracted seed store into Desktop's persistent pnpm store. Files and directories move by rename
 * on the same volume, so no byte is written twice, and every file the store receives was complete before it moved.
 * @param source - Verified temporary store extraction on the destination's volume; the merge consumes its entries.
 * @param destination - Desktop-owned persistent pnpm store.
 */
export async function mergePnpmStore(source: string, destination: string): Promise<void> {
  mkdirSync(destination, { recursive: true, mode: 0o700 })
  const indexPaths = readdirSync(source, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && STORE_VERSION_PATTERN.test(entry.name)
      && existsSync(join(source, entry.name, 'index.db')))
    .map(entry => `${entry.name}/index.db`)
  await moveStoreEntries(source, destination, '', indexPaths)
  for (const path of indexPaths) {
    mergeStoreIndex(join(source, ...path.split('/')), join(destination, ...path.split('/')))
  }
}

/**
 * Replace a prepared loose pnpm store with deterministic uncompressed archive shards.
 * @param seedRoot - seed directory that owns the archive output.
 * @param storeRoot - populated pnpm store to archive and remove after success.
 * @param shardCount - stable shard count used to limit update churn.
 */
export function archivePnpmStore(
  seedRoot: string,
  storeRoot: string,
  shardCount = DEFAULT_SHARD_COUNT,
): void {
  if (!Number.isSafeInteger(shardCount) || shardCount < 1 || shardCount > 256) {
    throw new Error(`desktop seed: invalid pnpm store shard count ${shardCount}`)
  }
  const archiveRoot = join(seedRoot, SEED_STORE_ARCHIVE_DIR)
  const manifestPath = join(seedRoot, SEED_STORE_ARCHIVE_MANIFEST)
  rmSync(archiveRoot, { recursive: true, force: true })
  rmSync(manifestPath, { force: true })
  mkdirSync(archiveRoot, { recursive: true })
  const shards = Array.from({ length: shardCount }, (): string[] => [])
  for (const path of storeFiles(storeRoot)) (shards[shardFor(path, shardCount)] as string[]).push(path)
  const archives: SeedStoreArchiveRecord[] = []
  for (const [index, paths] of shards.entries()) {
    if (paths.length === 0) continue
    const file = `store-${index.toString(16).padStart(2, '0')}.tar`
    create({
      cwd: storeRoot,
      file: join(archiveRoot, file),
      noDirRecurse: true,
      noMtime: true,
      portable: true,
      sync: true,
    }, paths)
    chmodSync(join(archiveRoot, file), 0o644)
    archives.push({ file, entries: paths.length })
  }
  if (archives.length === 0) throw new Error('desktop seed: pnpm store is empty')
  writeFileSync(manifestPath, `${JSON.stringify({ schemaVersion: 1, shardCount, archives }, undefined, 2)}\n`)
  rmSync(storeRoot, { recursive: true })
}

/**
 * Validate and extract a packaged pnpm store archive set into an empty directory. Reading and writing stream through
 * the event loop, so the Electron main process stays responsive for the whole extraction.
 * @param seedRoot - verified packaged seed directory.
 * @param destination - empty Desktop-owned temporary extraction directory.
 * @param existingStore - pnpm store whose files are left out of the extraction where it already holds a file of the
 *   same path and size. A pnpm content-addressed path names its bytes' digest, so such a file holds the same bytes;
 *   the size comparison catches a file an interrupted write truncated. Index databases are always extracted.
 */
export async function extractPnpmStoreArchives(seedRoot: string, destination: string, existingStore?: string): Promise<void> {
  const manifest = readArchiveManifest(seedRoot)
  const archiveRoot = join(seedRoot, SEED_STORE_ARCHIVE_DIR)
  const actualFiles = readdirSync(archiveRoot, { withFileTypes: true }).map((entry) => {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`desktop seed: invalid pnpm store archive entry ${entry.name}`)
    }
    return entry.name
  }).sort()
  const expectedFiles = manifest.archives.map(archive => archive.file).sort()
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error('desktop seed: pnpm store archive set does not match its manifest')
  }
  if (existsSync(destination) && readdirSync(destination).length !== 0) {
    throw new Error(`desktop seed: pnpm store extraction directory is not empty: ${destination}`)
  }
  mkdirSync(destination, { recursive: true, mode: 0o700 })
  const paths = new Set<string>()
  for (const archive of manifest.archives) {
    const archivePath = join(archiveRoot, archive.file)
    const archiveShard = Number.parseInt(archive.file.slice('store-'.length, -'.tar'.length), 16)
    let entries = 0
    // An asynchronous listing calls this from a stream event, where a throw would escape the returned promise, so
    // the first invalid entry is kept and thrown once the listing settles.
    let invalid: Error | undefined
    await list({
      file: archivePath,
      onReadEntry: (entry) => {
        if (invalid !== undefined) return
        if (entry.type !== 'File' && entry.type !== 'OldFile') {
          invalid = new Error(`desktop seed: unsupported pnpm store archive entry type ${entry.type}`)
          return
        }
        try {
          assertArchivePath(entry.path)
        } catch (error) {
          invalid = error as Error
          return
        }
        if (shardFor(entry.path, manifest.shardCount) !== archiveShard) {
          invalid = new Error(`desktop seed: pnpm store path is assigned to the wrong archive shard: ${entry.path}`)
          return
        }
        if (paths.has(entry.path)) {
          invalid = new Error(`desktop seed: duplicate pnpm store archive path ${entry.path}`)
          return
        }
        paths.add(entry.path)
        entries += 1
      },
      strict: true,
    })
    if (invalid !== undefined) throw invalid
    if (entries !== archive.entries) {
      throw new Error(`desktop seed: pnpm store archive ${archive.file} has an unexpected entry count`)
    }
  }
  const absent = existingStore === undefined
    ? undefined
    : (path: string, entry: { readonly size: number }): boolean => {
      if (isStoreIndexPath(path)) return true
      const stored = statSync(join(existingStore, ...path.split('/')), { throwIfNoEntry: false })
      return stored?.isFile() !== true || stored.size !== entry.size
    }
  for (const archive of manifest.archives) {
    await extract({
      chmod: true,
      cwd: destination,
      file: join(archiveRoot, archive.file),
      ...(absent === undefined ? {} : { filter: absent }),
      noMtime: true,
      preservePaths: false,
      processUmask: 0,
      strict: true,
    })
  }
}
