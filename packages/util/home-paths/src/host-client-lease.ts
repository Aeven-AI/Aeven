/**
 * Client leases on a home's `leased` GUI Host. A process that renders another
 * process's Host holds one so that Host keeps serving after its launching
 * shell quits. Each lease is a kernel file lock under `runtime/host-clients/`,
 * so process death releases it without cooperation from the holder.
 * @module @aeven/home-paths/host-client-lease
 */

import { randomUUID } from 'node:crypto'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tryAcquireFileLock } from './file-lock.ts'
import { isHostProcessAlive } from './host-lease.ts'

/** Home-relative directory holding one lock file per client lease. */
export const HOST_CLIENT_LEASE_DIR = 'runtime/host-clients'

const LEASE_FILE = /^(\d+)-[0-9a-f-]+\.lock$/u

/**
 * Hold a client lease until the returned release runs or this process exits.
 * @param home - absolute Aeven home.
 * @returns idempotent release that unlocks and removes the lease file.
 */
export async function acquireHostClientLease(home: string): Promise<() => Promise<void>> {
  const path = join(home, HOST_CLIENT_LEASE_DIR, `${String(process.pid)}-${randomUUID()}.lock`)
  const unlock = await tryAcquireFileLock(path)
  if (unlock === undefined) throw new Error(`host client lease "${path}" is held by another process`)
  let released = false
  return async () => {
    if (released) return
    released = true
    unlock()
    // Windows refuses to remove a file the Host holds open while counting; the
    // Host reaps the file itself once this process has exited.
    await rm(path, { force: true }).catch(() => undefined)
  }
}

/**
 * Count the client leases currently held on this home and remove the files
 * of holders that exited. A file whose lock is free but whose holder process
 * is alive counts as held: the holder creates the file before it locks it.
 * @param home - absolute Aeven home.
 * @returns number of held client leases.
 */
export async function countHostClientLeases(home: string): Promise<number> {
  const directory = join(home, HOST_CLIENT_LEASE_DIR)
  let names: string[]
  try {
    names = await readdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
  let held = 0
  for (const name of names) {
    const match = LEASE_FILE.exec(name)
    if (match === null) continue
    const path = join(directory, name)
    const unlock = await tryAcquireFileLock(path)
    if (unlock === undefined) {
      held++
      continue
    }
    unlock()
    if (isHostProcessAlive(Number(match[1]))) held++
    else await rm(path, { force: true })
  }
  return held
}
