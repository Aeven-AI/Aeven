/**
 * Attach Electron to this home's serving Host, or plan a fenced child startup.
 * The child claims the kernel lock before boot; a missing advertisement does
 * not give the shell authority to start a competing backend. A live incumbent
 * that misses the readiness deadline blocks launch rather than losing ownership.
 * @module @aeven/desktop/attached-host
 */

import { setTimeout as delay } from 'node:timers/promises'
import { isHostProcessAlive, liveHostLease, probeHostUrl, resolveAvnHome } from '@aeven/home-paths'

/** The backend this shell should render. */
export type DesktopBackendPlan =
  | {
    /** A live Host already serves this home; render its origin. */
    readonly kind: 'attach'
    /** Advertised attach URL, exactly as the serving Host published it. */
    readonly url: string
  }
  | {
    /** Nothing live owns this home; start a desktop Host as usual. */
    readonly kind: 'spawn'
    /** Why no Host was adopted, for the shell's startup log. */
    readonly reason: string
  }

/** Injection points kept open so a test drives every branch without a network. */
export interface DesktopBackendOptions {
  /** Liveness probe for an advertised URL; defaults to a bounded HTTP request. */
  readonly probe?: (url: string) => Promise<boolean>
  /** Pid of the process asking, so its own lease never counts as a peer. */
  readonly ownPid?: number
  /** Home to inspect; defaults to the resolved Aeven home. */
  readonly home?: string
  /**
   * How long to wait for a live leased Host to advertise its URL and answer
   * before rejecting startup; defaults to 30 seconds, about three
   * times a cold web Host boot.
   */
  readonly waitMs?: number
  /** Interval between lease reads and probes while waiting; defaults to 250 ms. */
  readonly pollMs?: number
}

/**
 * Choose the backend for this shell.
 *
 * A lease is trusted only while its owning process is alive, and adopted only
 * once its URL answers. A booting Host holds a lease without a URL, and a busy
 * one can miss a single probe, so both are retried until `waitMs` runs out. A
 * crashed Host leaves a stale record, and refusing to start over one would
 * strand the user with no window at all.
 * @param options - probe, self-pid, home, and wait overrides.
 * @returns the plan to render.
 */
export async function planDesktopBackend(
  options: DesktopBackendOptions = {},
): Promise<DesktopBackendPlan> {
  const home = options.home ?? resolveAvnHome()
  const ownPid = options.ownPid ?? process.pid
  const probe = options.probe ?? ((url: string) => probeHostUrl(url))
  const deadline = Date.now() + (options.waitMs ?? 30_000)
  const pollMs = options.pollMs ?? 250
  for (;;) {
    const lease = await liveHostLease(home).catch(() => undefined)
    if (lease === undefined) return { kind: 'spawn', reason: 'the home advertises no Host' }
    if (lease.pid === ownPid) return { kind: 'spawn', reason: 'the lease belongs to this shell' }
    if (lease.url !== undefined && await probe(lease.url).catch(() => false)) {
      return { kind: 'attach', url: lease.url }
    }
    if (!isHostProcessAlive(lease.pid)) return { kind: 'spawn', reason: `leased Host pid ${String(lease.pid)} exited` }
    if (Date.now() >= deadline) {
      throw new Error(`the existing Aeven Host (pid ${String(lease.pid)}) did not become ready; stop that Host before starting another`)
    }
    await delay(pollMs)
  }
}
