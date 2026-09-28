/** Read and rewrite the SQLite package index of a pnpm v11 content-addressable store. */

import { existsSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { Packr } from 'msgpackr'

/** Relative CAS path of one content file: two-hex-digit directory, remaining SHA-512 hex, optional `-exec`. */
const PNPM_CAS_PATH_PATTERN = /^([0-9a-f]{2})\/([0-9a-f]{126})(-exec)?$/u

const packr = new Packr({ moreTypes: true, useRecords: true })

/** One file of a package as pnpm records it in the index. */
export interface PnpmStoreFileRecord {
  checkedAt: number
  digest: string
  mode: number
  size: number
}

interface PnpmSideEffectsRecord {
  readonly added?: Map<string, PnpmStoreFileRecord>
}

/** Decoded index value for one package; fields this module does not read pass through unchanged. */
export interface PnpmPackageIndexRecord {
  readonly algo?: string
  readonly files?: Map<string, PnpmStoreFileRecord>
  readonly sideEffects?: Map<string, PnpmSideEffectsRecord>
}

/** One index row with a flag marking it for rewrite. */
export interface DecodedIndexRow {
  readonly key: string
  readonly value: PnpmPackageIndexRecord
  changed: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStoreFileRecord(value: unknown): value is PnpmStoreFileRecord {
  if (!isRecord(value)) return false
  return typeof value.checkedAt === 'number'
    && typeof value.digest === 'string'
    && /^[0-9a-f]{128}$/u.test(value.digest)
    && Number.isSafeInteger(value.mode)
    && Number.isSafeInteger(value.size)
}

/**
 * Return the version directories (`v11`, ...) of a store that hold content files.
 * @param storeRoot - Loose pnpm store.
 * @returns Absolute version directories in name order.
 */
export function pnpmStoreVersionRoots(storeRoot: string): readonly string[] {
  return readdirSync(storeRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^v\d+$/u.test(entry.name))
    .map(entry => join(storeRoot, entry.name))
    .filter(root => existsSync(join(root, 'files')))
    .sort((left, right) => left.localeCompare(right))
}

/**
 * Return every file map of one package record: its package files and each build side effect's added files.
 * @param value - Decoded index value.
 * @param key - Index key used in diagnostics.
 * @returns The validated file maps, package files first.
 */
export function pnpmPackageFileMaps(value: unknown, key: string): readonly Map<string, PnpmStoreFileRecord>[] {
  if (!isRecord(value)) throw new Error(`desktop seed store: invalid pnpm index record ${key}`)
  const record = value as PnpmPackageIndexRecord
  if (record.algo !== undefined && record.algo !== 'sha512') {
    throw new Error(`desktop seed store: unsupported pnpm index algorithm in ${key}`)
  }
  const maps: Map<string, PnpmStoreFileRecord>[] = []
  if (record.files !== undefined) {
    if (!(record.files instanceof Map)) throw new Error(`desktop seed store: invalid pnpm file map in ${key}`)
    maps.push(record.files)
  }
  if (record.sideEffects !== undefined) {
    if (!(record.sideEffects instanceof Map)) {
      throw new Error(`desktop seed store: invalid pnpm side-effects map in ${key}`)
    }
    for (const effect of record.sideEffects.values()) {
      if (!isRecord(effect)) throw new Error(`desktop seed store: invalid pnpm side effect in ${key}`)
      if (effect.added === undefined) continue
      if (!(effect.added instanceof Map)) {
        throw new Error(`desktop seed store: invalid pnpm side-effect file map in ${key}`)
      }
      maps.push(effect.added)
    }
  }
  for (const files of maps) {
    for (const file of files.values()) {
      if (!isStoreFileRecord(file)) throw new Error(`desktop seed store: invalid pnpm file record in ${key}`)
    }
  }
  return maps
}

/**
 * Decode every row of a store's `package_index` table.
 * @param database - Open `index.db`.
 * @returns Rows in table order, none marked changed.
 */
export function readPnpmIndexRows(database: DatabaseSync): DecodedIndexRow[] {
  const rows: DecodedIndexRow[] = []
  for (const row of database.prepare('SELECT key, data FROM package_index').iterate() as Iterable<{
    key: string
    data: Uint8Array
  }>) {
    rows.push({ key: row.key, value: packr.unpack(row.data) as PnpmPackageIndexRecord, changed: false })
  }
  return rows
}

/**
 * Re-encode every changed row in one transaction; a failure rolls back all of them.
 * @param database - Open `index.db`.
 * @param rows - Decoded rows; only those marked changed are written.
 * @returns Number of rows written.
 */
export function writeChangedPnpmIndexRows(database: DatabaseSync, rows: readonly DecodedIndexRow[]): number {
  const changedRows = rows.filter(row => row.changed)
  database.exec('BEGIN IMMEDIATE')
  let committed = false
  try {
    const statement = database.prepare('INSERT OR REPLACE INTO package_index (key, data) VALUES (?, ?)')
    for (const row of changedRows) statement.run(row.key, packr.pack(row.value))
    database.exec('COMMIT')
    committed = true
  } finally {
    if (!committed) database.exec('ROLLBACK')
  }
  return changedRows.length
}

/**
 * Whether a recorded file mode makes pnpm store the content as an `-exec` CAS object.
 * @param mode - Recorded POSIX mode.
 * @returns True when any execute bit is set.
 */
export function isExecutableMode(mode: number): boolean {
  return (mode & 0o111) !== 0
}

/**
 * Key identifying one CAS object: the same digest is stored separately with and without execute permission.
 * @param digest - SHA-512 hex digest.
 * @param executable - Whether the object is the `-exec` variant.
 * @returns The digest and variant joined.
 */
export function pnpmCasReferenceKey(digest: string, executable: boolean): string {
  return `${digest}:${executable ? 'exec' : 'nonexec'}`
}

/** One content object on disk. */
export interface PnpmCasObject {
  readonly path: string
  readonly digest: string
  readonly executable: boolean
}

/**
 * List every content object under a version directory's `files/`.
 * @param versionRoot - Store version directory.
 * @returns Objects in path order.
 * @throws When `files/` holds a symbolic link, a non-regular entry, or a path outside the CAS layout.
 */
export function listPnpmCasObjects(versionRoot: string): readonly PnpmCasObject[] {
  const filesRoot = join(versionRoot, 'files')
  const objects: PnpmCasObject[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const normalized = relative(filesRoot, path).split(sep).join('/')
      if (entry.isSymbolicLink()) throw new Error(`desktop seed store: pnpm store contains a symbolic link: ${normalized}`)
      if (entry.isDirectory()) {
        visit(path)
        continue
      }
      if (!entry.isFile()) throw new Error(`desktop seed store: unsupported pnpm store entry: ${normalized}`)
      const match = PNPM_CAS_PATH_PATTERN.exec(normalized)
      if (match === null) throw new Error(`desktop seed store: unsupported pnpm CAS path: ${normalized}`)
      objects.push({ path, digest: `${match[1]}${match[2]}`, executable: match[3] !== undefined })
    }
  }
  visit(filesRoot)
  return objects.sort((left, right) => left.path.localeCompare(right.path))
}

/**
 * Absolute path of one CAS object in a version directory.
 * @param versionRoot - Store version directory.
 * @param digest - SHA-512 hex digest.
 * @param executable - Whether the object is the `-exec` variant.
 * @returns The object's path under `files/`.
 */
export function pnpmCasPath(versionRoot: string, digest: string, executable: boolean): string {
  return join(versionRoot, 'files', digest.slice(0, 2), `${digest.slice(2)}${executable ? '-exec' : ''}`)
}
