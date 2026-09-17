/**
 * Backend selection for the Electron shell: adopt a Host that already serves
 * this home, or start one of our own.
 *
 * Every durable share in an Aeven home is single-writer by construction
 * except the domain KV documents, whose JSON backend republishes a whole
 * document from one process's memory with no cross-process coordination. Two
 * Hosts on one home therefore do not merge: the last writer replaces the
 * other's state, and a Session that one Host attached to a Workspace silently
 * loses that membership.
 *
 * A live Host that answers on its advertised URL already owns the home, and
 * the shell renders the same Web application either way, so adopting it is
 * both the correct and the cheaper choice. Anything short of a proven live
 * Host falls back to today's behaviour: the shell starts its own.
 * @module @aeven/desktop/attached-host
 */

import { liveHostLease, probeHostUrl, resolveAvnHome } from '@aeven/home-paths'

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
  }

/** Injection points kept open so a test drives every branch without a network. */
export interface DesktopBackendOptions {
  /** Liveness probe for an advertised URL; defaults to a bounded HTTP request. */
  readonly probe?: (url: string) => Promise<boolean>
  /** Pid of the process asking, so its own lease never counts as a peer. */
  readonly ownPid?: number
  /** Home to inspect; defaults to the resolved Aeven home. */
  readonly home?: string
}

/**
 * Choose the backend for this shell.
 *
 * A lease is trusted only when its owning process is alive AND its URL answers:
 * a crashed Host leaves a stale record, and refusing to start over one would
 * strand the user with no window at all.
 * @param options - probe, self-pid, and home overrides.
 * @returns the plan to render.
 */
export async function planDesktopBackend(
  options: DesktopBackendOptions = {},
): Promise<DesktopBackendPlan> {
  const home = options.home ?? resolveAvnHome()
  const lease = await liveHostLease(home).catch(() => undefined)
  // An incumbent with no advertised URL has no HTTP surface to render.
  if (lease === undefined || lease.url === undefined) return { kind: 'spawn' }
  if (lease.pid === (options.ownPid ?? process.pid)) return { kind: 'spawn' }
  const probe = options.probe ?? ((url: string) => probeHostUrl(url))
  const reachable = await probe(lease.url).catch(() => false)
  return reachable ? { kind: 'attach', url: lease.url } : { kind: 'spawn' }
}
