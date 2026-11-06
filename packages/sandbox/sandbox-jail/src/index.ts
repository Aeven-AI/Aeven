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
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { LAUNCHER_BIN, LAUNCHER_FAILURE_EXIT, launcherPath, probe } from '@deepseek-ai/node-addon-landlock-run'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SandboxProvider, SandboxUnavailableError, canonicalPath } from '@aeven/sandbox'
import type { ConfinedArgv, RunnerFailureRule, SandboxPolicy } from '@aeven/sandbox'
import type {} from '@aeven/system-prompt'
import { referencedAttachmentPaths } from '@aeven/attachment'
import type { Session, SessionId } from '@aeven/session'
import { SessionLogOffset } from '@aeven/session'
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
  /**
   * Host path of a BPF system-call filter bubblewrap installs before the
   * command starts, such as one written by `host/seccomp-filter.c`; omitted,
   * no filter applies. A missing file refuses every command.
   */
  seccompFilter?: string
  /**
   * Mount the attachments the calling conversation's user messages and tool
   * results reference, read-only at their attachment-store paths, so a
   * command can open an uploaded file at the path the model is given
   * (default false). Attachments named only in model-written arguments are
   * never mounted.
   */
  sessionAttachments?: boolean
  /**
   * Argv that limits one account folder's disk use, such as a root-owned
   * helper through `sudo -n` that sets a filesystem project quota. It runs,
   * with the folder appended, inside a command's own launch step before the
   * jail starts, so it never blocks the Host; a failure refuses that command.
   * Omitted, account folders have no limit of their own.
   */
  quotaCommand?: string[]
  /**
   * File the quota helper lists each limited account in, as `<id> <account>`
   * lines; an account listed there skips the quota step. Omitted, every
   * command runs the step.
   */
  quotaRecord?: string
  /**
   * System-prompt text describing what confined commands can use, such as
   * having no network and which programs and libraries are installed; omitted,
   * the jail adds nothing to the prompt.
   */
  modelNote?: string
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
    seccompFilter: z.string(),
    sessionAttachments: z.boolean().default(false),
    quotaCommand: z.array(z.string()),
    quotaRecord: z.string(),
    modelNote: z.string(),
  })

  private readonly accountsRoot: string
  private readonly profile: JailProfile
  private readonly cgroups: AccountCgroups | undefined
  private readonly quotaCommand: readonly string[] | undefined
  private readonly probeTimeoutMs: number
  private readonly quotaRecord: string | undefined
  /** Accounts the quota record lists, with the record's modification time when read. */
  private limited: { mtimeMs: number; accounts: Set<string> } = { mtimeMs: -1, accounts: new Set() }
  private readonly sessionAttachments: boolean
  private readonly seccompFilter: string | undefined
  /** Attachment files each live session references, and the log position read so far. */
  private readonly attachmentFiles = new WeakMap<Session, { seq: number; files: Set<string> }>()

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
      seccomp: config.seccompFilter !== undefined,
    }
    this.seccompFilter = config.seccompFilter
    if (this.seccompFilter !== undefined && !existsSync(this.seccompFilter)) {
      throw new Error(`sandbox-jail: seccompFilter "${this.seccompFilter}" does not exist`)
    }
    this.probeTimeoutMs = config.probeTimeoutMs as number
    if (config.quotaCommand !== undefined && config.quotaCommand.length === 0) throw new Error('sandbox-jail: quotaCommand must name a program')
    this.quotaCommand = config.quotaCommand
    this.quotaRecord = config.quotaRecord
    this.sessionAttachments = config.sessionAttachments ?? false
    this.probe(this.probeTimeoutMs)
    if (config.cgroup !== undefined) {
      const cgroups = new AccountCgroups(config.cgroup.root, config.cgroup.total, config.cgroup.account)
      cgroups.removeIdle()
      this.cgroups = cgroups
      ctx.effect(() => () => {
        cgroups.removeIdle()
      }, 'sandbox-jail account cgroups')
    }
    const note = config.modelNote
    if (note !== undefined && note.trim() !== '') {
      ctx.inject(['systemPrompt'], (scope) => {
        scope.systemPrompt.section({ name: 'sandbox:environment', order: scope.systemPrompt.getSectionOrder('SANDBOX_ENVIRONMENT'), text: note })
      })
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
    if (account === undefined) {
      throw new SandboxUnavailableError(policy.mode, `workspace "${workspaceRoot}" is not inside one account directory of "${this.accountsRoot}"`)
    }
    // Extra roots come from files a command can write, such as a `.git` naming a shared git
    // directory; one outside the account is left out rather than refusing the folder for good.
    const additionalWritableRoots = (policy.additionalWritableRoots ?? [])
      .map(root => canonicalPath(root))
      .filter(root => this.accountOf(root) === account)
    const jailed = [
      ...jailArgs(this.profile, { ...policy, workspaceRoot, additionalWritableRoots }, this.attachmentsOf(policy.sessionId)),
      '--', ...argv,
    ]
    const group = this.cgroups?.groupOf(account)
    const quota = this.needsLimit(account) ? this.quotaCommand : undefined
    const fail = (what: string): string => `{ echo "${CGROUP_STEP}: ${what}" >&2; exit ${CGROUP_STEP_FAILURE_EXIT}; }`
    const steps = [
      ...group === undefined ? [] : [`echo 0 > "$1/cgroup.procs" || ${fail('cannot join $1')}`],
      ...quota === undefined ? [] : [`${quota.map(shellQuote).join(' ')} "$3" >/dev/null || ${fail("cannot limit the account folder's disk use")}`],
      ...this.seccompFilter === undefined ? [] : [`exec 3< "$2" || ${fail('cannot open the system-call filter $2')}`],
    ]
    return {
      argv: steps.length === 0 ? jailed : [
        '/bin/sh', '-c', `${steps.join('; ')}; shift 3; exec "$@"`,
        CGROUP_STEP, group ?? '', this.seccompFilter ?? '', join(this.accountsRoot, account), ...jailed,
      ],
      enforcement: 'full',
      denialSignatures: DENIAL_SIGNATURES,
      runnerFailureRules: RUNNER_FAILURE_RULES,
    }
  }

  /**
   * The attachment files a session's user messages and tool results reference, read incrementally from its log.
   * @param sessionId - the calling session, when the call has one.
   * @returns existing host paths to mount read-only.
   */
  private attachmentsOf(sessionId: SessionId | undefined): string[] {
    if (!this.sessionAttachments || sessionId === undefined) return []
    const session = this.ctx.get('sessions')?.get(sessionId)
    const store = this.ctx.get('attachments')
    if (session === undefined || store === undefined) return []
    const known = this.attachmentFiles.get(session) ?? { seq: 0, files: new Set<string>() }
    referencedAttachmentPaths(session.snapshotEvents(SessionLogOffset(known.seq)), store, known.files)
    known.seq = session.seq
    this.attachmentFiles.set(session, known)
    return [...known.files]
  }

  /**
   * Whether a command must run the quota step: a quota command is configured and the record does not list the account yet.
   * @param account - the account path segment.
   * @returns true until the quota helper has recorded the account.
   */
  private needsLimit(account: string): boolean {
    if (this.quotaCommand === undefined) return false
    if (this.quotaRecord === undefined) return true
    let mtimeMs: number
    try {
      mtimeMs = statSync(this.quotaRecord).mtimeMs
    } catch {
      // ENOENT: the helper has not limited any account yet, so every account still needs it.
      return true
    }
    if (mtimeMs !== this.limited.mtimeMs) {
      let text: string
      try {
        text = readFileSync(this.quotaRecord, 'utf8')
      } catch {
        // EACCES or a race with the helper's rewrite: without a readable record the step runs, which stays correct.
        return true
      }
      const accounts = new Set(text.split('\n').map(line => line.trim().split(/\s+/u)[1]).filter(name => name !== undefined))
      this.limited = { mtimeMs, accounts }
    }
    return !this.limited.accounts.has(account)
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

/**
 * Quote one argument for a POSIX shell.
 * @param value - the argument.
 * @returns the single-quoted form.
 */
function shellQuote(value: string): string {
  return '\'' + value.replaceAll('\'', '\'\\\'\'') + '\''
}

export default JailSandboxProvider
