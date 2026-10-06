/**
 * One-time split of the shared MemOS database into one database per account.
 *
 * Builds before per-account memory kept every account's memory in one database under the provider's
 * shared `home`, separated only by MemOS profile. Each account found there gets a copy holding only its
 * own rows, written where its core opens it; the shared file is then renamed so the split runs once.
 * TODO: delete at the first tagged release, with the pre-release stance that no released build wrote the
 * shared database.
 * @module @aeven/memory-memos/migrate
 */
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'

/** Where the shared database lives and where each account's database goes. */
export interface SharedMemorySplit {
  /** The shared database file of earlier builds. */
  readonly sharedDbFile: string
  /**
   * @param owner - account id recovered from a MemOS profile id.
   * @returns the database file that account's core opens.
   */
  readonly accountDbFile: (owner: string) => string
  readonly info: (message: string) => void
  readonly warn: (message: string) => void
}

/** MemOS profile ids Aeven writes are `user-<account id>` (see `ownerProfile`). */
const OWNER_PROFILE_PREFIX = 'user-'

/** Tables whose rows carry their owning MemOS profile. */
function ownerTables(db: Database.Database): string[] {
  return (db.prepare(
    `SELECT m.name AS name FROM sqlite_master m JOIN pragma_table_info(m.name) c
     WHERE m.type = 'table' AND c.name = 'owner_profile_id' ORDER BY m.name`,
  ).all() as Array<{ name: string }>).map(row => row.name)
}

function quoted(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

/**
 * Keep only one profile's rows in a copied database, then drop link and queue rows whose targets left
 * with the other profiles. The FTS indexes follow through MemOS's delete triggers.
 */
function keepProfile(file: string, profile: string): void {
  const db = new Database(file)
  try {
    db.pragma('foreign_keys = ON')
    db.transaction(() => {
      for (const table of ownerTables(db)) {
        db.prepare(`DELETE FROM ${quoted(table)} WHERE owner_profile_id IS NOT ?`).run(profile)
      }
      db.prepare(`DELETE FROM trace_policy_links WHERE trace_id NOT IN (SELECT id FROM traces)
        OR policy_id NOT IN (SELECT id FROM policies)`).run()
      db.prepare(`DELETE FROM embedding_retry_queue WHERE target_id NOT IN (
        SELECT id FROM traces UNION SELECT id FROM policies UNION SELECT id FROM skills UNION SELECT id FROM world_model)`).run()
    })()
    // FTS5 keeps deleted rows in its segments until it merges them, which would leave every copy the
    // size of the shared index.
    for (const { name } of db.prepare('SELECT name FROM sqlite_master WHERE type = \'table\' AND sql LIKE \'CREATE VIRTUAL TABLE%fts5%\'').all() as Array<{ name: string }>) {
      db.prepare(`INSERT INTO ${quoted(name)}(${quoted(name)}) VALUES('optimize')`).run()
    }
    db.exec('VACUUM')
  } finally {
    db.close()
  }
}

/**
 * Split the shared database when one exists. An account that already has its own database keeps it;
 * a failed account leaves the shared file in place so the next start retries the accounts still missing.
 * @param options - shared and per-account locations, and the log sinks.
 */
export function splitSharedMemory(options: SharedMemorySplit): void {
  if (!existsSync(options.sharedDbFile)) return
  const shared = new Database(options.sharedDbFile)
  let complete = true
  try {
    const tables = ownerTables(shared)
    const profiles = new Set<string>()
    for (const table of tables) {
      for (const row of shared.prepare(`SELECT DISTINCT owner_profile_id AS profile FROM ${quoted(table)}
        WHERE owner_profile_id LIKE '${OWNER_PROFILE_PREFIX}%'`).all() as Array<{ profile: string }>) {
        profiles.add(row.profile)
      }
    }
    for (const profile of profiles) {
      const owner = profile.slice(OWNER_PROFILE_PREFIX.length)
      const target = options.accountDbFile(owner)
      if (existsSync(target)) continue
      const staging = `${target}.splitting`
      try {
        mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
        rmSync(staging, { force: true })
        shared.prepare('VACUUM INTO ?').run(staging)
        keepProfile(staging, profile)
        renameSync(staging, target)
        options.info(`moved the memory of profile ${profile} into its account database`)
      } catch (error) {
        complete = false
        rmSync(staging, { force: true })
        options.warn(`could not move the memory of profile ${profile}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (complete) shared.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    shared.close()
  }
  if (!complete) return
  // Rows of profiles that are no account (such as the Viewer's own default) stay in the renamed file.
  renameSync(options.sharedDbFile, `${options.sharedDbFile}.split`)
  for (const suffix of ['-wal', '-shm']) rmSync(`${options.sharedDbFile}${suffix}`, { force: true })
}
