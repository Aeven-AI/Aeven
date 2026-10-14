/**
 * GUI Host ownership and discovery for one Aeven home. The kernel lock guards
 * boot and the complete serving lifetime; runtime/host.json advertises the
 * authenticated endpoint after readiness. The advertisement is owner-only
 * because its URL carries a live browser launch credential.
 * @module @aeven/home-paths/host-lease
 */

import { mkdir, readFile, rm, writeFile, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { dirname, join } from 'node:path'
import { tryAcquireFileLock } from './file-lock.ts'

/** Home-relative path of the serving-Host lease. */
export const HOST_LEASE_FILE = 'runtime/host.json'

/** On-disk lease shape version; a record with any other value is ignored. */
export const HOST_LEASE_VERSION = 1

/**
 * What ends a serving Host. A `leased` Host belongs to the desktop shell that
 * launched it and stops once that shell and every client lease are gone; a
 * `foreground` Host belongs to the terminal that runs it and stops only on
 * that process's own shutdown.
 */
export type HostLifetime = 'leased' | 'foreground'

/** Facts a Host records about itself when it claims a home. */
export interface HostOwner {
  /** What ends this Host. */
  readonly lifetime: HostLifetime
  /** Installed avn version the Host serves. */
  readonly avnVersion: string
}

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
   * claims ownership without it while booting and adds it after the complete
   * application is ready for browser and Electron clients.
   */
  readonly url?: string
  /** What ends this Host; absent in records written by builds without lifetimes, which behave as `leased`. */
  readonly lifetime?: HostLifetime
  /** Installed avn version the Host serves; absent in records written by builds that did not record it. */
  readonly avnVersion?: string
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
    && (record.lifetime === undefined || record.lifetime === 'leased' || record.lifetime === 'foreground')
    && (record.avnVersion === undefined || typeof record.avnVersion === 'string')
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
  const temporary = `${path}.${randomUUID()}`
  try {
    await writeFile(temporary, `${JSON.stringify(lease, undefined, 2)}\n`, { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
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
 * advertisements are replaced only by the next kernel-lock owner.
 * @param home - absolute Aeven home.
 * @returns the live lease, or undefined when the home is unclaimed.
 */
export async function liveHostLease(home: string): Promise<HostLease | undefined> {
  const recorded = await readHostLease(home)
  if (recorded === undefined) return undefined
  if (isHostProcessAlive(recorded.pid)) return recorded
  return undefined
}

/**
 * Attach this Host's HTTP URL to a lease it already owns, so a peer reading
 * the advertisement learns the attachable origin once the server has bound.
 * A lease claimed by another process is left untouched.
 * @param home - absolute Aeven home.
 * @param pid - the claiming process id.
 * @param url - tokenized root URL clients attach with.
 * @returns resolution after publication; ownership or write failures reject.
 */
export async function advertiseHostUrl(home: string, pid: number, url: string): Promise<void> {
  const recorded = await readHostLease(home)
  if (recorded === undefined || recorded.pid !== pid) throw new Error('cannot advertise a Host without its startup ownership record')
  await writeHostLease(home, { ...recorded, url })
}

/**
 * Remove this Host's URL from its advertisement before teardown, so a
 * contender waits for the process to exit instead of attaching to a server
 * that is closing. The ownership record stays until release.
 * @param home - absolute Aeven home.
 * @param pid - the claiming process id.
 * @returns resolution after the attempt; failures stay silent, and a lease owned by another process is left untouched.
 */
export async function withdrawHostUrl(home: string, pid: number): Promise<void> {
  const recorded = await readHostLease(home)
  if (recorded === undefined || recorded.pid !== pid || recorded.url === undefined) return
  const { url: _withdrawn, ...withdrawn } = recorded
  // A failed write leaves the URL advertised; a contender's probe then fails
  // and it waits for this process to exit.
  await writeHostLease(home, withdrawn).catch(() => undefined)
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
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' })
    return response.ok || (response.status === 303 && response.headers.get('location') === '/' && response.headers.has('set-cookie'))
  } catch {
    return false
  }
}

/** One GUI Host startup owner, or the incumbent's authenticated endpoint. */
export type HostStartup =
  | { readonly kind: 'owner'; readonly release: () => Promise<void> }
  | { readonly kind: 'attach'; readonly url: string }

/**
 * Serialize GUI Host startup before any stateful plugin mounts.
 * A live incumbent that cannot serve within the deadline is an error; its
 * process is never displaced by a second Host. Legacy advertisements also
 * block startup until their owning process exits.
 * @param home - shared Aeven home.
 * @param owner - lifetime and version recorded in the advertisement when this process wins.
 * @param waitMs - maximum wait for the incumbent's endpoint.
 * @param pollMs - interval between ownership and readiness checks.
 * @returns exclusive startup ownership or the serving Host's endpoint.
 */
export async function claimOrAttachHost(home: string, owner: HostOwner, waitMs = 30_000, pollMs = 250): Promise<HostStartup> {
  const deadline = Date.now() + waitMs
  for (;;) {
    const releaseLock = await tryAcquireFileLock(join(home, 'runtime', 'host.lock'))
    if (releaseLock !== undefined) {
      try {
        const existing = await liveHostLease(home)
        if (existing === undefined || existing.pid === process.pid) {
          await writeHostLease(home, {
            version: HOST_LEASE_VERSION,
            pid: process.pid,
            startedAt: new Date().toISOString(),
            lifetime: owner.lifetime,
            avnVersion: owner.avnVersion,
          })
          let released = false
          return { kind: 'owner', release: async () => {
            if (released) return
            released = true
            try { await clearHostLease(home, process.pid) } finally { releaseLock() }
          } }
        }
      } catch (error: unknown) {
        releaseLock()
        throw error
      }
      releaseLock()
    }
    const incumbent = await liveHostLease(home)
    if (incumbent?.url !== undefined && await probeHostUrl(incumbent.url)) {
      const current = await liveHostLease(home)
      if (current?.pid === incumbent.pid && current.url === incumbent.url) return { kind: 'attach', url: incumbent.url }
    }
    if (Date.now() >= deadline) throw new Error('the existing Aeven Host did not become ready; stop that Host before starting another')
    await delay(pollMs)
  }
}
