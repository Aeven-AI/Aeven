/**
 * Attach Electron to this home's serving Host, or plan a fenced child startup.
 * The child claims the kernel lock before boot; a missing advertisement does
 * not give the shell authority to start a competing backend. A live incumbent
 * that misses the readiness deadline blocks launch rather than losing ownership.
 * @module @aeven/desktop/attached-host
 */

import { setTimeout as delay } from 'node:timers/promises'
import { countHostClientLeases, isHostProcessAlive, liveHostLease, probeHostUrl, resolveAvnHome } from '@aeven/home-paths'

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
  /**
   * avn version this shell ships. When set, a Host that is not `foreground`,
   * serves another version, and has no client lease is stopped and replaced
   * instead of adopted. Omitted, every answering Host is adopted.
   */
  readonly avnVersion?: string
  /** Stop request sent to an outdated Host; defaults to SIGTERM. */
  readonly terminate?: (pid: number) => void
  /** Client lease count for the home; defaults to counting the home's lease files. */
  readonly clientLeases?: (home: string) => Promise<number>
}

/**
 * Choose the backend for this shell.
 *
 * A lease is trusted only while its owning process is alive, and adopted only
 * once its URL answers. A booting or stopping Host holds a lease without a
 * URL, and a busy one can miss a single probe, so both are retried until
 * `waitMs` runs out. A crashed Host leaves a stale record, and refusing to
 * start over one would strand the user with no window at all. A Host
 * launched by an earlier desktop release would serve the wrong backend after
 * an update, so with `avnVersion` set it is asked to stop and this shell
 * starts its own once that process has exited. A Host that a shell or other
 * client still leases is in use and is adopted instead. On Windows the stop
 * request terminates the process without teardown.
 * @param options - probe, self-pid, home, wait, version, and stop overrides.
 * @returns the plan to render.
 */
export async function planDesktopBackend(
  options: DesktopBackendOptions = {},
): Promise<DesktopBackendPlan> {
  const home = options.home ?? resolveAvnHome()
  const ownPid = options.ownPid ?? process.pid
  const probe = options.probe ?? ((url: string) => probeHostUrl(url))
  const terminate = options.terminate ?? ((pid: number) => { process.kill(pid, 'SIGTERM') })
  const clientLeases = options.clientLeases ?? countHostClientLeases
  const deadline = Date.now() + (options.waitMs ?? 30_000)
  const pollMs = options.pollMs ?? 250
  let replaced: { readonly pid: number; readonly reason: string } | undefined
  for (;;) {
    const lease = await liveHostLease(home).catch(() => undefined)
    if (lease === undefined) return { kind: 'spawn', reason: replaced?.reason ?? 'the home advertises no Host' }
    if (lease.pid === ownPid) return { kind: 'spawn', reason: 'the lease belongs to this shell' }
    const stopping = lease.pid === replaced?.pid
    if (!stopping && lease.url !== undefined && await probe(lease.url).catch(() => false)) {
      if (options.avnVersion === undefined || lease.lifetime === 'foreground' || lease.avnVersion === options.avnVersion
        || await clientLeases(home) > 0) {
        return { kind: 'attach', url: lease.url }
      }
      terminate(lease.pid)
      replaced = {
        pid: lease.pid,
        reason: `the Host serving avn ${lease.avnVersion ?? 'of an unrecorded version'} (pid ${String(lease.pid)}) was stopped for avn ${options.avnVersion}`,
      }
    }
    if (!isHostProcessAlive(lease.pid)) {
      return { kind: 'spawn', reason: lease.pid === replaced?.pid ? replaced.reason : `leased Host pid ${String(lease.pid)} exited` }
    }
    if (Date.now() >= deadline) {
      throw new Error(lease.pid === replaced?.pid
        ? `the outdated Aeven Host (pid ${String(lease.pid)}) did not stop; stop that Host before starting another`
        : `the existing Aeven Host (pid ${String(lease.pid)}) did not become ready; stop that Host before starting another`)
    }
    await delay(pollMs)
  }
}
