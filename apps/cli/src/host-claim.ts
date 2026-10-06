/**
 * Boot-time claim of the home's Host lease, loaded by the CLI entry before the
 * boot graph so the claim lands as early as the process can make it.
 * @module @aeven/cli/host-claim
 */

import { HOST_LEASE_VERSION, liveHostLease, resolveAvnHome, writeHostLease } from '@aeven/home-paths'

/**
 * Claim the home's lease for this process before boot, without a URL.
 *
 * A web Host boots for seconds before it can advertise its URL, and a desktop
 * shell that finds no lease in that window starts a second Host on the same
 * home. A URL-less claim from a live process tells the shell to wait for the
 * URL instead. A live lease held by another process is left alone, so a
 * running Host keeps its advertisement.
 * @returns whether this process holds the lease.
 */
export async function claimBootingHost(): Promise<boolean> {
  try {
    const home = resolveAvnHome()
    const existing = await liveHostLease(home)
    if (existing !== undefined && existing.pid !== process.pid) return false
    await writeHostLease(home, { version: HOST_LEASE_VERSION, pid: process.pid, startedAt: new Date().toISOString() })
    return true
  } catch (error) {
    // The claim only shortens a peer's wait; it is never a reason for this Host to fail to boot.
    console.error(`avn: could not claim the Host lease: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}
