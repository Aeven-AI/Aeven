/**
 * Remove packages from the desktop pnpm store that no installed profile references.
 *
 * Every release merges its seed's packages into one persistent store, so without collection the store keeps every
 * past release's first-party tarballs and dependencies. pnpm's own `store prune` cannot be used: it deletes every
 * content object with a single hard link, and on APFS pnpm installs profiles by cloning, so every object has one link
 * and a prune would empty the store, including the plugin packages the next release adds offline.
 *
 * A package stays when a profile's `pnpm-lock.yaml` names its integrity. Index rows go first, in one transaction;
 * content objects that no remaining row references are deleted after the commit, so an interruption leaves only
 * unreferenced objects behind, never a row whose files are gone. The caller holds the package transaction lock.
 */

import { existsSync, readFileSync } from 'node:fs'
import { stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  isExecutableMode,
  listPnpmCasObjects,
  pnpmCasReferenceKey,
  pnpmPackageFileMaps,
  pnpmStoreVersionRoots,
  readPnpmIndexRows,
} from './pnpm-store-index.ts'

/** A lockfile integrity, inline (`resolution: {integrity: …}`) or on its own line. */
const LOCKFILE_INTEGRITY_PATTERN = /\bintegrity: (sha\d+-[A-Za-z0-9+/=]+)/gu

/** Content objects deleted concurrently. */
const UNLINK_BATCH = 64

/** What one collection removed. */
export interface DesktopStoreCollection {
  readonly removedPackages: number
  readonly deletedObjects: number
  readonly freedBytes: number
}

/**
 * Package integrities the existing profiles reference.
 * @param profiles - Profile directories; a missing directory references nothing.
 * @returns The integrities, or undefined when an existing profile has no lockfile, so its references are unknown.
 */
function referencedIntegrities(profiles: readonly string[]): ReadonlySet<string> | undefined {
  const integrities = new Set<string>()
  for (const profile of profiles) {
    if (!existsSync(profile)) continue
    const lockfile = join(profile, 'pnpm-lock.yaml')
    if (!existsSync(lockfile)) return undefined
    for (const match of readFileSync(lockfile, 'utf8').matchAll(LOCKFILE_INTEGRITY_PATTERN)) integrities.add(match[1] as string)
  }
  return integrities
}

/**
 * Delete the store's packages that no profile references, then the content objects only they used.
 * @param storeRoot - The desktop pnpm store directory.
 * @param profiles - Every profile that may install from or fall back to the store: active, rollback, and prepared.
 * @returns What was removed, or undefined when an existing profile has no lockfile and nothing was touched.
 * @throws When the store holds an entry outside pnpm's layout, before any row or object changes.
 */
export async function collectDesktopStore(storeRoot: string, profiles: readonly string[]): Promise<DesktopStoreCollection | undefined> {
  const keep = referencedIntegrities(profiles)
  if (keep === undefined) return undefined
  let removedPackages = 0
  let deletedObjects = 0
  let freedBytes = 0
  for (const root of existsSync(storeRoot) ? pnpmStoreVersionRoots(storeRoot) : []) {
    const database = new DatabaseSync(join(root, 'index.db'))
    try {
      const rows = readPnpmIndexRows(database)
      // Keys are `<integrity>\t<package id>`; a row in any other shape is kept.
      const doomed = rows.filter((row) => {
        const tab = row.key.indexOf('\t')
        return tab > 0 && !keep.has(row.key.slice(0, tab))
      })
      if (doomed.length === 0) continue
      const doomedKeys = new Set(doomed.map(row => row.key))
      const referenced = new Set<string>()
      for (const row of rows) {
        if (doomedKeys.has(row.key)) continue
        for (const files of pnpmPackageFileMaps(row.value, row.key)) {
          for (const record of files.values()) referenced.add(pnpmCasReferenceKey(record.digest, isExecutableMode(record.mode)))
        }
      }
      const unreferenced = listPnpmCasObjects(root)
        .filter(object => !referenced.has(pnpmCasReferenceKey(object.digest, object.executable)))
      database.exec('BEGIN IMMEDIATE')
      let committed = false
      try {
        const remove = database.prepare('DELETE FROM package_index WHERE key = ?')
        for (const row of doomed) remove.run(row.key)
        database.exec('COMMIT')
        committed = true
      } finally {
        if (!committed) database.exec('ROLLBACK')
      }
      removedPackages += doomed.length
      for (let start = 0; start < unreferenced.length; start += UNLINK_BATCH) {
        const batch = await Promise.all(unreferenced.slice(start, start + UNLINK_BATCH).map(async (object) => {
          try {
            const { size } = await stat(object.path)
            await unlink(object.path)
            return size
          } catch (error) {
            // An object Windows holds open or that is already gone stays for the next collection; no row names it.
            console.warn(`desktop project: could not delete store object ${object.path}`, error)
            return undefined
          }
        }))
        for (const size of batch) {
          if (size === undefined) continue
          deletedObjects += 1
          freedBytes += size
        }
      }
      database.exec('VACUUM')
    } finally {
      database.close()
    }
  }
  return { removedPackages, deletedObjects, freedBytes }
}
