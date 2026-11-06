/**
 * Per-account cgroups beneath a cgroup v2 directory the Host was delegated.
 * The tree is `<root>/jail/acct-<account>`: `jail` caps everything confined
 * commands use together, so the Host in its own sibling group keeps its share,
 * and each account's group caps and weights that account's commands. The
 * Python zygote, when configured, runs in the sibling `<root>/zygote`.
 *
 * @module @aeven/sandbox-jail/cgroup
 */

import { existsSync, mkdirSync, readdirSync, rmdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** cgroup v2 interface values written verbatim to one group. */
export interface CgroupLimits {
  /** `memory.max`, e.g. `2G` or `max`. */
  memoryMax: string
  /** `pids.max`, e.g. `256`. */
  pidsMax: string
  /** `cpu.max` as `<quota> <period>` in microseconds, e.g. `200000 100000` for two cores. */
  cpuMax: string
  /** `cpu.weight`, 1–10000. */
  cpuWeight: string
}

/** Controllers every group below the delegated root enables for its children. */
const CONTROLLERS = '+cpu +memory +pids'

/** Write each limit to its interface file. */
function writeLimits(dir: string, limits: CgroupLimits): void {
  writeFileSync(join(dir, 'memory.max'), limits.memoryMax)
  writeFileSync(join(dir, 'pids.max'), limits.pidsMax)
  writeFileSync(join(dir, 'cpu.max'), limits.cpuMax)
  writeFileSync(join(dir, 'cpu.weight'), limits.cpuWeight)
  // Swap would let an account exceed memory.max on a host that has swap.
  if (existsSync(join(dir, 'memory.swap.max'))) writeFileSync(join(dir, 'memory.swap.max'), '0')
}

/** The account groups of one delegated cgroup directory. */
export class AccountCgroups {
  /** The directory whose `acct-<account>` children are the account groups. */
  readonly jail: string
  private readonly root: string
  private readonly accounts = new Map<string, string>()

  /**
   * Prepare `<root>/jail` with the combined limits.
   * @param root - a cgroup v2 directory delegated to this process that holds no processes itself.
   * @param total - limits for all confined commands together.
   * @param account - limits for one account's commands.
   * @throws when the directory is not delegated, holds processes, or lacks a controller.
   */
  constructor(root: string, total: CgroupLimits, private readonly account: CgroupLimits) {
    this.root = root
    this.jail = join(root, 'jail')
    try {
      writeFileSync(join(root, 'cgroup.subtree_control'), CONTROLLERS)
      mkdirSync(this.jail, { recursive: true })
      writeLimits(this.jail, total)
      writeFileSync(join(this.jail, 'cgroup.subtree_control'), CONTROLLERS)
    } catch (error) {
      throw new Error(
        `sandbox-jail: cannot manage cgroups under "${root}": ${String(error)}. `
        + 'Run the Host in a systemd unit with Delegate=yes and DelegateSubgroup=host, and name the unit\'s cgroup here.',
        { cause: error },
      )
    }
  }

  /**
   * The group one account's commands join, created with its limits on first use.
   * @param account - an account path segment.
   * @returns the group directory.
   */
  groupOf(account: string): string {
    let dir = this.accounts.get(account)
    if (dir === undefined) {
      dir = join(this.jail, `acct-${account}`)
      mkdirSync(dir, { recursive: true })
      writeLimits(dir, this.account)
      this.accounts.set(account, dir)
    }
    return dir
  }

  /**
   * The Python zygote's group beside `jail`, created with its limits.
   * @param limits - the zygote's own limits; each run moves into its caller's account group.
   * @returns the group directory.
   */
  zygoteGroup(limits: CgroupLimits): string {
    const dir = join(this.root, 'zygote')
    mkdirSync(dir, { recursive: true })
    writeLimits(dir, limits)
    return dir
  }

  /** Remove every account group that no process still occupies. */
  removeIdle(): void {
    for (const name of readdirSync(this.jail)) {
      if (!name.startsWith('acct-')) continue
      try {
        rmdirSync(join(this.jail, name))
      } catch {
        // EBUSY: a command from a previous Host lifetime still runs there; the next start retries.
      }
    }
    this.accounts.clear()
  }
}
