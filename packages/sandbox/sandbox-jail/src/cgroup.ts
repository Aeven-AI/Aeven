/**
 * Per-account cgroups beneath a cgroup v2 directory the Host was delegated.
 * The tree is `<root>/jail/acct-<account>`: `jail` caps everything confined
 * commands use together, so the Host in its own sibling group keeps its share,
 * and each account's group caps and weights that account's commands. The
 * Python zygote and the egress proxy, when configured, run in `<root>/jail/zygote`
 * and `<root>/jail/egress` beside them.
 *
 * @module @aeven/sandbox-jail/cgroup
 */

import { chmodSync, chownSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** cgroup v2 interface values written verbatim to one group. */
export interface CgroupLimits {
  /** `memory.max`, e.g. `2G` or `max`. */
  memoryMax: string
  /**
   * `memory.high`, e.g. `1536M`: above it the kernel reclaims the group's memory and slows its allocations, so a
   * command nearing `memoryMax` loses speed before the kernel kills it; omitted, nothing slows it first.
   */
  memoryHigh?: string
  /** `pids.max`, e.g. `256`. */
  pidsMax: string
  /** `cpu.max` as `<quota> <period>` in microseconds, e.g. `200000 100000` for two cores. */
  cpuMax: string
  /** `cpu.weight`, 1–10000. */
  cpuWeight: string
  /**
   * `io.max` keys for the disk that holds the accounts root, e.g. `rbps=104857600 wbps=52428800 riops=2000 wiops=1000`;
   * omitted, the group's disk I/O is unlimited.
   */
  ioMax?: string
}

/**
 * The whole disk holding a path, as the `MAJ:MIN` that `io.max` accepts: a partition resolves to its disk.
 * @param path - an existing path on a block-device filesystem.
 * @returns the disk's device number.
 * @throws when the path's filesystem is not on a block device.
 */
export function diskOf(path: string): string {
  const dev = statSync(path, { bigint: true }).dev
  // glibc's major()/minor() split of a 64-bit dev_t.
  const major = ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & ~0xfffn)
  const minor = (dev & 0xffn) | ((dev >> 12n) & ~0xffn)
  const id = `${major}:${minor}`
  let sys: string
  try {
    sys = realpathSync(`/sys/dev/block/${id}`)
  } catch (error) {
    throw new Error(`sandbox-jail: "${path}" is not on a block device (${id}), so io.max cannot limit it`, { cause: error })
  }
  return existsSync(join(sys, 'partition')) ? readFileSync(join(dirname(sys), 'dev'), 'utf8').trim() : id
}

/** Controllers every group below the delegated root enables for its children; `+io` joins when a limit sets `ioMax`. */
const CONTROLLERS = '+cpu +memory +pids'

/** Write each limit to its interface file; `disk` is the `MAJ:MIN` that `ioMax` applies to. */
function writeLimits(dir: string, limits: CgroupLimits, disk: string | undefined): void {
  writeFileSync(join(dir, 'memory.max'), limits.memoryMax)
  if (limits.memoryHigh !== undefined) writeFileSync(join(dir, 'memory.high'), limits.memoryHigh)
  writeFileSync(join(dir, 'pids.max'), limits.pidsMax)
  writeFileSync(join(dir, 'cpu.max'), limits.cpuMax)
  writeFileSync(join(dir, 'cpu.weight'), limits.cpuWeight)
  // Swap would let an account exceed memory.max on a host that has swap.
  if (existsSync(join(dir, 'memory.swap.max'))) writeFileSync(join(dir, 'memory.swap.max'), '0')
  if (limits.ioMax !== undefined && disk !== undefined) writeFileSync(join(dir, 'io.max'), `${disk} ${limits.ioMax}`)
}

/** The account groups of one delegated cgroup directory. */
export class AccountCgroups {
  /** The directory whose `acct-<account>` children are the account groups. */
  readonly jail: string
  private readonly accounts = new Map<string, string>()
  private readonly total: CgroupLimits
  /** The disk `ioMax` limits apply to; undefined when no limit sets `ioMax`. */
  private readonly disk: string | undefined

  /**
   * Prepare `<root>/jail` with the combined limits.
   * @param root - a cgroup v2 directory delegated to this process that holds no processes itself.
   * @param total - limits for all confined commands together.
   * @param account - limits for one account's commands.
   * @param procsGroup - a group the Host's user belongs to whose members may move processes into account groups,
   * such as the sandbox user the Python zygote runs as; omitted, only the Host's user may.
   * @param accountsRoot - the directory whose disk `ioMax` limits apply to.
   * @param unlimited - accounts whose group gets the combined `total` limits instead of `account`.
   * @throws when the directory is not delegated, holds processes, or lacks a controller, or when an `ioMax` is set and
   * the accounts root is not on a block device.
   */
  constructor(
    root: string,
    total: CgroupLimits,
    private readonly account: CgroupLimits,
    private readonly procsGroup: number | undefined,
    accountsRoot: string,
    private readonly unlimited: ReadonlySet<string> = new Set(),
  ) {
    this.total = total
    this.jail = join(root, 'jail')
    const limitsIo = total.ioMax !== undefined || account.ioMax !== undefined
    this.disk = limitsIo ? diskOf(accountsRoot) : undefined
    const controllers = limitsIo ? `${CONTROLLERS} +io` : CONTROLLERS
    try {
      writeFileSync(join(root, 'cgroup.subtree_control'), controllers)
      mkdirSync(this.jail, { recursive: true })
      writeLimits(this.jail, total, this.disk)
      writeFileSync(join(this.jail, 'cgroup.subtree_control'), controllers)
      this.shareProcs(this.jail)
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
      writeLimits(dir, this.unlimited.has(account) ? this.total : this.account, this.disk)
      // Out of memory, an account's commands end together: a half-killed pipeline keeps its memory and its job slot.
      writeFileSync(join(dir, 'memory.oom.group'), '1')
      this.shareProcs(dir)
      this.accounts.set(account, dir)
    }
    return dir
  }

  /**
   * The group of a helper process that serves every account, created with its limits beside the account groups.
   * @param name - the group's directory name, e.g. `zygote` or `egress`.
   * @param limits - the helper's own limits.
   * @returns the group directory.
   */
  helperGroup(name: string, limits: CgroupLimits): string {
    // Inside `jail`, so `jail` is the common ancestor a zygote run's move into its account group needs write access to.
    const dir = join(this.jail, name)
    mkdirSync(dir, { recursive: true })
    writeLimits(dir, limits, this.disk)
    return dir
  }

  /**
   * Let {@link procsGroup} write a group's `cgroup.procs`. `jail` itself can hold no process, because it enables
   * controllers for its children, so its file only serves as the common ancestor of a move between its children.
   */
  private shareProcs(dir: string): void {
    if (this.procsGroup === undefined) return
    const procs = join(dir, 'cgroup.procs')
    chownSync(procs, -1, this.procsGroup)
    chmodSync(procs, 0o664)
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
