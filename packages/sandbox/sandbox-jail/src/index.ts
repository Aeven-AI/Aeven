/**
 * Per-account process jail for a Linux Host that runs the commands of many
 * accounts. Each confined command runs under bubblewrap in fresh user, mount,
 * PID, IPC, UTS, cgroup, and network namespaces that see only the configured
 * read-only system paths, the calling account's workspace, and a private
 * `/tmp` and `/dev/shm`; the Landlock launcher re-confines that view, and the command joins
 * its account's cgroup. A workspace root outside the accounts root, or one
 * spanning two accounts, fails closed with `SANDBOX_UNAVAILABLE`.
 * @module @aeven/sandbox-jail
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import { LAUNCHER_BIN, LAUNCHER_FAILURE_EXIT, launcherPath, probe } from '@deepseek-ai/node-addon-landlock-run'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SandboxProvider, SandboxUnavailableError, canonicalPath } from '@aeven/sandbox'
import type { ConfinedArgv, RunnerFailureRule, SandboxPolicy } from '@aeven/sandbox'
import { AccountCgroups, type CgroupLimits } from './cgroup.ts'
import { jailArgs, type JailProfile } from './profile.ts'

/** cgroup placement for confined commands. */
export interface CgroupConfig {
  /** Delegated cgroup v2 directory without processes of its own, e.g. `/sys/fs/cgroup/system.slice/aeven-hosted.service`. */
  root: string
  /** Limits for all confined commands together. */
  total: CgroupLimits
  /** Limits for one account's commands. */
  account: CgroupLimits
}

/** Plugin config. */
export interface Config {
  /** Absolute directory whose direct children are account directories; every workspace root must lie inside one of them. */
  accountsRoot: string
  /** Host path of bubblewrap. */
  bwrap?: string
  /** Host path of the Landlock launcher; defaults to the npm-distributed launcher. */
  launcher?: string
  /** Host paths mounted read-only at the same path; missing paths are skipped. */
  readOnlyPaths?: string[]
  /** Symlinks created in the jail root, keyed by link path, e.g. `/bin: usr/bin`. */
  symlinks?: Record<string, string>
  /** The complete environment of confined commands; `HOME` is set to the workspace root. */
  env?: Record<string, string>
  /** Size bound of each of the private `/tmp` and `/dev/shm`, in MiB; their pages count against the account's memory limit. */
  tmpSizeMb?: number
  /** Host name confined commands see. */
  hostname?: string
  /** Timeout of each startup probe, in milliseconds. */
  probeTimeoutMs?: number
  /** cgroup placement; omitted, confined commands stay in the Host's cgroup. */
  cgroup?: CgroupConfig
}

const limits: z<CgroupLimits> = z.object({
  memoryMax: z.string().required(),
  pidsMax: z.string().required(),
  cpuMax: z.string().required(),
  cpuWeight: z.string().required(),
})

/** An account directory name usable as one path segment. */
const ACCOUNT_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/u

/** The stderr prefix of the cgroup entry step. */
const CGROUP_STEP = 'sandbox-jail'

/** Exit status of the cgroup entry step when it cannot join the account group. */
const CGROUP_STEP_FAILURE_EXIT = 125

const RUNNER_FAILURE_RULES: readonly RunnerFailureRule[] = [
  { fatalSignatures: ['bwrap: '] },
  { allowedExitCodes: [LAUNCHER_FAILURE_EXIT], fatalSignatures: [`${LAUNCHER_BIN}: `] },
  { allowedExitCodes: [CGROUP_STEP_FAILURE_EXIT], fatalSignatures: [`${CGROUP_STEP}: `] },
]

/** Under bwrap a write outside the writable binds fails with EROFS; under Landlock with EACCES. */
const DENIAL_SIGNATURES = ['read-only file system', 'permission denied'] as const

/**
 * Per-account jail provider. Registers as `ctx.sandbox`. Startup probes
 * bubblewrap and the Landlock launcher once and fails loud when either cannot
 * confine on this host.
 */
export class JailSandboxProvider extends SandboxProvider {
  // Inline schema call: the config catalog walks `static Config` statically.
  static Config: z<Config> = z.object({
    accountsRoot: z.string().required(),
    bwrap: z.string().default('/usr/bin/bwrap'),
    launcher: z.string(),
    readOnlyPaths: z.array(z.string()).default([
      '/usr', '/etc/alternatives', '/etc/ld.so.cache', '/etc/ld.so.conf', '/etc/ld.so.conf.d', '/etc/localtime',
      '/etc/fonts', '/etc/ssl/certs', '/etc/mime.types', '/etc/passwd', '/etc/group', '/etc/nsswitch.conf',
    ]),
    symlinks: z.dict(z.string()).default({ '/bin': 'usr/bin', '/sbin': 'usr/sbin', '/lib': 'usr/lib', '/lib64': 'usr/lib64' }),
    env: z.dict(z.string()).default({
      PATH: '/usr/local/bin:/usr/bin:/bin',
      LANG: 'C.UTF-8',
      TMPDIR: '/tmp',
      OPENBLAS_NUM_THREADS: '1',
      OMP_NUM_THREADS: '1',
      MKL_NUM_THREADS: '1',
      NUMEXPR_NUM_THREADS: '1',
      MPLBACKEND: 'Agg',
      MPLCONFIGDIR: '/tmp',
      PYTHONDONTWRITEBYTECODE: '1',
    }),
    tmpSizeMb: z.natural().min(1).default(512),
    hostname: z.string().default('sandbox'),
    probeTimeoutMs: z.natural().min(1).default(5_000),
    cgroup: z.object({ root: z.string().required(), total: limits.required(), account: limits.required() }),
  })

  private readonly accountsRoot: string
  private readonly profile: JailProfile
  private readonly cgroups: AccountCgroups | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx)
    if (process.platform !== 'linux') throw new Error('sandbox-jail: requires Linux')
    if (!isAbsolute(config.accountsRoot)) throw new Error(`sandbox-jail: accountsRoot "${config.accountsRoot}" must be absolute`)
    mkdirSync(config.accountsRoot, { recursive: true, mode: 0o700 })
    this.accountsRoot = canonicalPath(config.accountsRoot)
    // The schema (static Config) defaults every optional field except
    // launcher and cgroup; the casts record those runtime facts.
    this.profile = {
      bwrap: config.bwrap as string,
      launcher: config.launcher ?? launcherPath(),
      readOnlyPaths: (config.readOnlyPaths as string[]).filter(path => existsSync(path)),
      symlinks: config.symlinks as Record<string, string>,
      env: config.env as Record<string, string>,
      tmpSizeBytes: (config.tmpSizeMb as number) * 1024 * 1024,
      hostname: config.hostname as string,
    }
    this.probe(config.probeTimeoutMs as number)
    if (config.cgroup !== undefined) {
      const cgroups = new AccountCgroups(config.cgroup.root, config.cgroup.total, config.cgroup.account)
      cgroups.removeIdle()
      this.cgroups = cgroups
      ctx.effect(() => () => cgroups.removeIdle(), 'sandbox-jail account cgroups')
    }
  }

  /**
   * Wrap `argv` in the calling account's jail.
   * @param argv - the exact argv the caller is about to spawn.
   * @param policy - the call's confined policy.
   * @returns the jailed argv with its enforcement, denial, and runner-failure facts.
   * @throws {SandboxUnavailableError} when a policy root is not inside exactly one account directory.
   */
  confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
    const workspaceRoot = canonicalPath(policy.workspaceRoot)
    const account = this.accountOf(workspaceRoot)
    const additionalWritableRoots = (policy.additionalWritableRoots ?? []).map(root => canonicalPath(root))
    if (account === undefined || additionalWritableRoots.some(root => this.accountOf(root) !== account)) {
      throw new SandboxUnavailableError(policy.mode, `workspace "${workspaceRoot}" is not inside one account directory of "${this.accountsRoot}"`)
    }
    const jailed = [...jailArgs(this.profile, { ...policy, workspaceRoot, additionalWritableRoots }), '--', ...argv]
    const group = this.cgroups?.groupOf(account)
    return {
      argv: group === undefined ? jailed : [
        '/bin/sh', '-c',
        `echo 0 > "$1/cgroup.procs" || { echo "${CGROUP_STEP}: cannot join $1" >&2; exit ${CGROUP_STEP_FAILURE_EXIT}; }; shift; exec "$@"`,
        CGROUP_STEP, group, ...jailed,
      ],
      enforcement: 'full',
      denialSignatures: DENIAL_SIGNATURES,
      runnerFailureRules: RUNNER_FAILURE_RULES,
    }
  }

  /** The account directory a canonical path lies inside, or undefined outside the accounts root. */
  private accountOf(path: string): string | undefined {
    const rest = relative(this.accountsRoot, path)
    const account = rest.split(sep)[0] ?? ''
    if (rest === '' || isAbsolute(rest) || !ACCOUNT_SEGMENT.test(account)) return undefined
    return account
  }

  /** Fail loud unless bubblewrap can create the jail's namespaces and the launcher enforces Landlock. */
  private probe(timeoutMs: number): void {
    const verdict = probe(this.profile.launcher, { timeoutMs })
    if (verdict === 'unusable') {
      throw new Error(`sandbox-jail: the Landlock launcher "${this.profile.launcher}" cannot enforce on this kernel`)
    }
    const result = spawnSync(this.profile.bwrap, [
      '--unshare-user', '--unshare-net', '--unshare-pid', '--disable-userns', '--die-with-parent',
      '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--', '/usr/bin/true',
    ], { encoding: 'utf8', timeout: timeoutMs })
    if (result.status !== 0) {
      throw new Error(
        `sandbox-jail: bubblewrap "${this.profile.bwrap}" cannot create the jail: ${result.error?.message ?? result.stderr.trim()}. `
        + 'On Ubuntu, an AppArmor profile must allow it user namespaces.',
      )
    }
  }
}

export default JailSandboxProvider
