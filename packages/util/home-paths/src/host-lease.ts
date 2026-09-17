/**
 * Cross-host advertisement for one Aeven home.
 *
 * Every durable share in an Aeven home is single-writer by construction
 * except the domain KV documents under `storages/`, whose backend republishes
 * a whole document from one process's memory with no cross-process
 * coordination. Two Hosts sharing a home therefore do not merge: whichever
 * writes last replaces the other's view, which is how a Session that one Host
 * attached to a Workspace silently loses that membership.
 *
 * This module is the missing primitive that makes such a conflict visible
 * instead of silent. A serving Host advertises the identity a peer needs —
 * its pid, when it started, and the tokenized root URL a browser or shell can
 * attach with — at `runtime/host.json` inside the home. Because the lease
 * carries a live launch token, it is written owner-only and must never be
 * logged.
 * @module @aeven/home-paths/host-lease
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Home-relative path of the serving-Host lease. */
export const HOST_LEASE_FILE = 'runtime/host.json'

/** On-disk lease shape version; a record with any other value is ignored. */
export const HOST_LEASE_VERSION = 1

/** One serving Host's advertisement. */
export interface HostLease {
  /** Lease shape version. */
  readonly version: number
  /** Process id of the serving Host. */
  readonly pid: number
  /** ISO-8601 instant the Host claimed the lease. */
  readonly startedAt: string
  /**
   * Tokenized root URL of the Host's HTTP surface, when it serves one. A Host
   * reachable only through its own carrier (the Electron pipes, for example)
   * omits this and cannot be attached to from outside.
   */
  readonly url?: string
}

/**
 * Absolute path of the lease inside `home`.
 * @param home - harness home directory the lease belongs to.
 * @returns absolute path of that home's Host lease file.
 */
export function hostLeasePath(home: string): string {
  return join(home, HOST_LEASE_FILE)
}

/**
 * Whether a process id currently names a live process. Signal 0 performs the
 * permission and existence checks without delivering anything; `EPERM` still
 * proves the process exists, while any other failure means it does not.
 * @param pid - process id recorded in a lease.
 * @returns true when that process is still running.
 */
export function isHostProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function isHostLease(value: unknown): value is HostLease {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record.version === HOST_LEASE_VERSION
    && typeof record.pid === 'number'
    && Number.isInteger(record.pid)
    && record.pid > 0
    && typeof record.startedAt === 'string'
    && (record.url === undefined || typeof record.url === 'string')
}

/**
 * Read the home's lease without judging whether its owner is still alive.
 * A missing, unparsable, or future-versioned file reads as absent: a lease is
 * an advisory fact, so a corrupt one must never fail a Host's startup.
 * @param home - absolute Aeven home.
 * @returns the recorded lease, or undefined when there is none to trust.
 */
export async function readHostLease(home: string): Promise<HostLease | undefined> {
  let text: string
  try {
    text = await readFile(hostLeasePath(home), 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(text)
    return isHostLease(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Publish this Host's lease, replacing any existing record. The file is
 * owner-only because `url` carries a live launch token.
 * @param home - absolute Aeven home.
 * @param lease - advertisement to record; `pid` is normally `process.pid`.
 * @returns resolution after durability.
 */
export async function writeHostLease(home: string, lease: HostLease): Promise<void> {
  const path = hostLeasePath(home)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(lease, undefined, 2)}\n`, { mode: 0o600 })
}

/**
 * Remove the lease when it still belongs to `pid`. A peer that took the lease
 * over keeps it: the disposer of the Host that lost it must not delete the
 * winner's advertisement.
 * @param home - absolute Aeven home.
 * @param pid - the claiming process id.
 * @returns resolution after the attempt; failures stay silent.
 */
export async function clearHostLease(home: string, pid: number): Promise<void> {
  const recorded = await readHostLease(home)
  if (recorded === undefined || recorded.pid !== pid) return
  await rm(hostLeasePath(home), { force: true }).catch(() => undefined)
}

/**
 * Read the home's lease, discarding one whose owning process has exited. Stale
 * removal is best-effort: a Host that cannot write still gets a usable answer.
 * @param home - absolute Aeven home.
 * @returns the live lease, or undefined when the home is unclaimed.
 */
export async function liveHostLease(home: string): Promise<HostLease | undefined> {
  const recorded = await readHostLease(home)
  if (recorded === undefined) return undefined
  if (isHostProcessAlive(recorded.pid)) return recorded
  await rm(hostLeasePath(home), { force: true }).catch(() => undefined)
  return undefined
}

/**
 * Attach this Host's HTTP URL to a lease it already owns, so a peer reading
 * the advertisement learns the attachable origin once the server has bound.
 * A lease claimed by another process is left untouched.
 * @param home - absolute Aeven home.
 * @param pid - the claiming process id.
 * @param url - tokenized root URL clients attach with.
 * @returns resolution after the attempt; failures stay silent.
 */
export async function advertiseHostUrl(home: string, pid: number, url: string): Promise<void> {
  const recorded = await readHostLease(home)
  if (recorded === undefined || recorded.pid !== pid) return
  await writeHostLease(home, { ...recorded, url }).catch(() => undefined)
}

/**
 * Ask an advertised URL whether the Host behind it is still answering. A lease
 * whose process is alive but whose server is gone is stale for attach
 * purposes, and refusing to start over it would strand the user.
 * @param url - advertised tokenized root URL.
 * @param timeoutMs - how long to wait before treating the Host as gone.
 * @returns true when the Host answered.
 */
export async function probeHostUrl(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
    return response.status < 500
  } catch {
    return false
  }
}
