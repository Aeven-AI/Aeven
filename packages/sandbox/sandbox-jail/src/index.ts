/**
 * Per-account process jail for a Linux Host that runs the commands of many
 * accounts. Each confined command runs under bubblewrap in fresh user, mount,
 * PID, IPC, UTS, cgroup, and network namespaces that see only the configured
 * read-only system paths, the calling account's workspace, and a private
 * `/tmp` and `/dev/shm`, and reach the network only through the egress proxy
 * when one is configured; the Landlock launcher re-confines that view, and the command joins
 * its account's cgroup. A workspace root outside the accounts root, or one
 * spanning two accounts, fails closed with `SANDBOX_UNAVAILABLE`.
 * @module @aeven/sandbox-jail
 */

import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { LAUNCHER_BIN, LAUNCHER_FAILURE_EXIT, launcherPath, probe } from '@deepseek-ai/node-addon-landlock-run'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SandboxProvider, SandboxUnavailableError, canonicalPath } from '@aeven/sandbox'
import type { ConfinedArgv, RunnerFailureRule, SandboxPolicy } from '@aeven/sandbox'
import type {} from '@aeven/system-prompt'
import { referencedAttachmentPaths } from '@aeven/attachment'
import type { Session, SessionId } from '@aeven/session'
import { SessionId as toSessionId, SessionLogOffset } from '@aeven/session'
import { AccountCgroups, type CgroupLimits } from './cgroup.ts'
import type {} from '@aeven/agent'
import type {} from '@aeven/user-approval'
import { EgressProxy, relayArgs, type EgressAnswer, type EgressLimits, type EgressQuestion } from './egress.ts'
import { GitCredentials } from './git-credentials.ts'
import { jailArgs, type JailProfile } from './profile.ts'
import { PythonZygote } from './zygote.ts'

/** cgroup placement for confined commands. */
export interface CgroupConfig {
  /** Delegated cgroup v2 directory without processes of its own, e.g. `/sys/fs/cgroup/system.slice/aeven-hosted.service`. */
  root: string
  /** Limits for all confined commands together. */
  total: CgroupLimits
  /** Limits for one account's commands. */
  account: CgroupLimits
}

/** The user confined commands run as, apart from the Host's own. */
export interface CommandUserConfig {
  /**
   * Host path of the helper `host/sandbox-exec.c` builds, which only the Host's user may execute and which switches
   * to the sandbox user before bubblewrap starts, e.g. `/usr/local/libexec/aeven-sandbox-exec`.
   */
  exec: string
  /** The sandbox user's group, which the Host's user belongs to; it may move runs into account cgroups. */
  group: string
  /**
   * A second mount of `accountsRoot` the sandbox user can traverse but not list, e.g. `/srv/aeven-accounts`, from
   * which bubblewrap mounts each command's folder at its usual path; the usual path lies inside the Host's data
   * directory, which the sandbox user cannot enter.
   */
  accountsPath: string
}

/** The Python zygote's deployment. */
export interface PythonZygoteConfig {
  /** The image's interpreter, the one the shim runs when the zygote does not serve a call, e.g. `/opt/aeven-sandbox/bin/python3`. */
  python: string
  /**
   * Host path of the zygote script `host/install-python-zygote.sh` installs, e.g.
   * `/opt/aeven-sandbox/shim/python-zygote.py`; a missing file fails startup.
   */
  script: string
  /** Modules imported once before any run, e.g. `numpy`, `pandas`, `matplotlib.pyplot`. */
  preload: string[]
  /** Host directory for the zygote's socket, created with mode 0700 and mounted read-only into every jail. */
  socketDir: string
  /** Limits of the zygote's own cgroup; each run is charged to its caller's account group. */
  limits: CgroupLimits
}

export type { GitCredentialSource } from './git-credentials.ts'
export { GitCredentials } from './git-credentials.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Sources of the Git credentials the jail's egress proxy sends for an account; present while `egress` is configured. */
    sandboxGitCredentials: GitCredentials
  }
}

/** The egress proxy's deployment: what jailed commands may reach on the network, and how much. */
export interface EgressConfig extends EgressLimits {
  /** Host path of the Node.js that runs the proxy, readable by the user confined commands run as, e.g. `/usr/bin/node`. */
  node: string
  /** Host path of the proxy `host/install-egress.sh` installs, e.g. `<image>/shim/egress-proxy.mjs`; a missing file fails startup. */
  script: string
  /** Host path of the static relay the same script builds, e.g. `<image>/shim/aeven-egress-relay`; a missing file fails startup. */
  relay: string
  /** Host directory of the proxy's socket, mounted read-only into every jail; with `commandUser` it must exist, owned by that user. */
  socketDir: string
  /** Loopback port the relay listens on inside each jail, which the proxy variables of confined commands name. */
  port: number
  /** Limits of the proxy's own cgroup. */
  limits: CgroupLimits
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
   * A preloaded Python interpreter that runs jailed `python3` commands without their import cost. Needs `cgroup`
   * and `seccompFilter`, and the shim `host/install-python-zygote.sh` builds first on the jail's `PATH`; omitted,
   * every `python3` starts its own interpreter.
   */
  pythonZygote?: PythonZygoteConfig
  /**
   * Network access for confined commands through one proxy that allows listed hosts only and bounds every account's
   * connections and bytes. Needs `cgroup`; omitted, confined commands have no network.
   */
  egress?: EgressConfig
  /**
   * Run confined commands, and the Python zygote, as a separate sandbox user, so a command that escapes its jail
   * holds no access to the Host's data. The account folders need ACLs granting both users access and a second mount
   * the sandbox user can traverse, and attachments are copied into each jail; omitted, commands run as the Host's user.
   */
  commandUser?: CommandUserConfig
  /**
   * System-prompt text describing what confined commands can use, such as
   * having no network and which programs and libraries are installed; omitted,
   * the jail adds nothing to the prompt.
   */
  modelNote?: string
}

const limits: z<CgroupLimits> = z.object({
  memoryMax: z.string().required(),
  memoryHigh: z.string(),
  pidsMax: z.string().required(),
  cpuMax: z.string().required(),
  cpuWeight: z.string().required(),
  ioMax: z.string(),
})

/** The session part of a jail's identity when a call names no conversation. */
const NO_SESSION = '-'

/** The tool an approval for a gated push is recorded under: the tool whose command pushes. */
const PUSH_APPROVAL_TOOL = 'bash'

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
  { allowedExitCodes: [CGROUP_STEP_FAILURE_EXIT], fatalSignatures: ['aeven-sandbox-exec: '] },
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
    commandUser: z.object({ exec: z.string().required(), group: z.string().required(), accountsPath: z.string().required() }),
    pythonZygote: z.object({
      python: z.string().required(),
      script: z.string().required(),
      preload: z.array(z.string()).default([]),
      socketDir: z.string().required(),
      limits: limits.required(),
    }),
    egress: z.object({
      node: z.string().required(),
      script: z.string().required(),
      relay: z.string().required(),
      socketDir: z.string().required(),
      port: z.natural().min(1).max(65535).required(),
      limits: limits.required(),
      allow: z.array(z.string()).required(),
      ports: z.array(z.natural().min(1).max(65535)).required(),
      gitHosts: z.array(z.string()).required(),
      accountConnections: z.natural().min(1).required(),
      connections: z.natural().min(1).required(),
      accountBytesPerSecond: z.natural().min(1).required(),
      bytesPerSecond: z.natural().min(1).required(),
      accountBytesPerDay: z.natural().min(1).required(),
      connectTimeoutMs: z.natural().min(1).required(),
      idleTimeoutMs: z.natural().min(1).required(),
    }),
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
  /** The helper that switches a launch to the sandbox user, when commands run as one. */
  private readonly commandExec: string | undefined
  /** Folders whose ACL mask this provider already opened for the sandbox user. */
  private readonly sharedFolders = new Set<string>()
  /** The egress proxy and the relay port of its jails, when commands have network. */
  private egress: { readonly proxy: EgressProxy; readonly port: number } | undefined
  private readonly gitCredentials = new GitCredentials()
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
    const commandUser = config.commandUser
    if (commandUser !== undefined) {
      if (!existsSync(commandUser.accountsPath)) {
        throw new Error(`sandbox-jail: commandUser.accountsPath "${commandUser.accountsPath}" does not exist; mount accountsRoot there too`)
      }
      this.profile.sandboxUser = { accountsRoot: this.accountsRoot, accountsPath: commandUser.accountsPath }
    }
    if (commandUser !== undefined && !existsSync(commandUser.exec)) {
      throw new Error(`sandbox-jail: commandUser.exec "${commandUser.exec}" does not exist; build it from host/sandbox-exec.c`)
    }
    this.commandExec = commandUser?.exec
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
      const cgroups = new AccountCgroups(
        config.cgroup.root, config.cgroup.total, config.cgroup.account,
        commandUser === undefined ? undefined : groupId(commandUser.group),
        this.accountsRoot,
      )
      cgroups.removeIdle()
      this.cgroups = cgroups
      ctx.effect(() => () => {
        cgroups.removeIdle()
      }, 'sandbox-jail account cgroups')
    }
    const zygote = config.pythonZygote
    if (zygote !== undefined) {
      if (this.cgroups === undefined || this.seccompFilter === undefined) {
        throw new Error('sandbox-jail: pythonZygote needs cgroup and seccompFilter, which every run joins and loads')
      }
      if (!existsSync(zygote.script)) throw new Error(`sandbox-jail: pythonZygote.script "${zygote.script}" does not exist`)
      if (!isAbsolute(zygote.socketDir)) throw new Error(`sandbox-jail: pythonZygote.socketDir "${zygote.socketDir}" must be absolute`)
      if (this.commandExec === undefined) {
        mkdirSync(join(zygote.socketDir, 'mpl'), { recursive: true, mode: 0o700 })
        chmodSync(zygote.socketDir, 0o700)
      } else if (!existsSync(zygote.socketDir)) {
        throw new Error(`sandbox-jail: pythonZygote.socketDir "${zygote.socketDir}" must exist, owned by the sandbox user`)
      }
      this.profile.zygoteDir = canonicalPath(zygote.socketDir)
      const cgroups = this.cgroups
      const seccompFilter = this.seccompFilter
      ctx.effect(() => {
        const process = new PythonZygote({
          exec: this.commandExec,
          python: zygote.python,
          script: zygote.script,
          preload: zygote.preload,
          socketDir: zygote.socketDir,
          group: cgroups.helperGroup('zygote', zygote.limits),
          accountsCgroup: cgroups.jail,
          seccompFilter,
          env: this.profile.env,
          log: (level, message) => { ctx.logger('sandbox-jail')[level](message) },
        })
        return () => { process.dispose() }
      }, 'sandbox-jail python zygote')
    }
    const egress = config.egress
    if (egress !== undefined) {
      if (this.cgroups === undefined) throw new Error('sandbox-jail: egress needs cgroup, which bounds the proxy')
      for (const path of [egress.node, egress.script, egress.relay]) {
        if (!existsSync(path)) throw new Error(`sandbox-jail: egress file "${path}" does not exist; run host/install-egress.sh`)
      }
      if (!isAbsolute(egress.socketDir)) throw new Error(`sandbox-jail: egress.socketDir "${egress.socketDir}" must be absolute`)
      if (this.commandExec === undefined) {
        mkdirSync(egress.socketDir, { recursive: true, mode: 0o700 })
        chmodSync(egress.socketDir, 0o700)
      } else if (!existsSync(egress.socketDir)) {
        throw new Error(`sandbox-jail: egress.socketDir "${egress.socketDir}" must exist, owned by the sandbox user`)
      }
      const socketDir = canonicalPath(egress.socketDir)
      this.profile.egress = { socketDir, relay: canonicalPath(egress.relay), port: egress.port, gitHosts: egress.gitHosts }
      const cgroups = this.cgroups
      ctx.effect(() => ctx.provide('sandboxGitCredentials', this.gitCredentials), 'sandbox-jail git credentials')
      ctx.effect(() => {
        const proxy = new EgressProxy({
          exec: this.commandExec,
          node: egress.node,
          script: egress.script,
          socketDir,
          group: cgroups.helperGroup('egress', egress.limits),
          limits: {
            allow: egress.allow,
            ports: egress.ports,
            gitHosts: egress.gitHosts,
            accountConnections: egress.accountConnections,
            connections: egress.connections,
            accountBytesPerSecond: egress.accountBytesPerSecond,
            bytesPerSecond: egress.bytesPerSecond,
            accountBytesPerDay: egress.accountBytesPerDay,
            connectTimeoutMs: egress.connectTimeoutMs,
            idleTimeoutMs: egress.idleTimeoutMs,
          },
          answer: (question, signal) => this.answerEgress(question, signal),
          log: (level, message) => { ctx.logger('sandbox-jail')[level](message) },
        })
        this.egress = { proxy, port: egress.port }
        return () => {
          this.egress = undefined
          proxy.dispose()
        }
      }, 'sandbox-jail egress proxy')
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
    if (this.commandExec !== undefined) this.shareFolders(account, [workspaceRoot, ...additionalWritableRoots])
    const jail = jailArgs(this.profile, { ...policy, workspaceRoot, additionalWritableRoots }, this.attachmentsOf(policy.sessionId))
    const egress = this.egress
    const relay = egress === undefined ? [] : relayArgs(egress.port, egress.proxy.identity(account, policy.sessionId ?? NO_SESSION))
    const jailed = [...this.commandExec === undefined ? [] : [this.commandExec], ...jail.args, '--', ...relay, ...argv]
    const group = this.cgroups?.groupOf(account)
    const quota = this.needsLimit(account) ? this.quotaCommand : undefined
    const fail = (what: string): string => `{ echo "${CGROUP_STEP}: ${what}" >&2; exit ${CGROUP_STEP_FAILURE_EXIT}; }`
    const steps = [
      ...group === undefined ? [] : [`echo 0 > "$1/cgroup.procs" || ${fail('cannot join $1')}`],
      ...quota === undefined ? [] : [`${quota.map(shellQuote).join(' ')} "$3" >/dev/null || ${fail("cannot limit the account folder's disk use")}`],
      ...this.seccompFilter === undefined ? [] : [`exec 3< "$2" || ${fail('cannot open the system-call filter $2')}`],
      // The sandbox user cannot reach these by path, so bubblewrap copies them in from the Host user's descriptors.
      ...jail.opens.map(({ fd, path }) => `exec ${String(fd)}< ${shellQuote(path)} || ${fail(`cannot open ${shellQuote(path)}`)}`),
    ]
    return {
      argv: steps.length === 0 ? jailed : [
        jail.opens.length === 0 ? '/bin/sh' : '/bin/bash', '-c', `${steps.join('; ')}; shift 3; exec "$@"`,
        CGROUP_STEP, group ?? '', this.seccompFilter ?? '', join(this.accountsRoot, account), ...jailed,
      ],
      enforcement: 'full',
      denialSignatures: DENIAL_SIGNATURES,
      runnerFailureRules: RUNNER_FAILURE_RULES,
    }
  }

  /**
   * Answer one question of the egress proxy.
   * @param question - a credential or approval question about one account's Git request.
   * @param signal - aborts when the request that asked ended first.
   * @returns the credential any registered source holds, or whether the user approved the push.
   */
  private async answerEgress(question: EgressQuestion, signal: AbortSignal): Promise<EgressAnswer> {
    if (question.type === 'git-token') {
      const token = await this.gitCredentials.resolve(question.account, question.host, (error) => {
        this.ctx.logger('sandbox-jail').warn(`a Git credential source failed for ${question.host}: ${error instanceof Error ? error.message : String(error)}`)
      })
      return { token }
    }
    // The approval is asked in the conversation whose command pushes, and only when that conversation is the account's own.
    const agent = question.session === NO_SESSION ? undefined : this.ctx.get('agents')?.get(toSessionId(question.session))
    const approval = this.ctx.get('approval')
    if (agent === undefined || approval === undefined || agent.session.header.owner !== question.account) return { approved: false }
    const changes = question.updates.map(update => `${update.kind} ${update.ref}`).join(', ')
    const outcome = await approval.request({
      agent,
      toolName: PUSH_APPROVAL_TOOL,
      signal,
      reason: `Push to ${question.host}/${question.repository}: ${changes}`,
    })
    return { approved: outcome === 'allowed-once' }
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

  /**
   * Open the ACL mask of each folder from the account folder down to every root, so the sandbox user's inherited
   * grant applies. The Host creates these folders with mode 0700, and under a default ACL a folder's group bits are
   * its mask; folders the sandbox user created already carry it.
   * @param account - the account path segment.
   * @param roots - canonical roots inside that account.
   */
  private shareFolders(account: string, roots: readonly string[]): void {
    const top = join(this.accountsRoot, account)
    for (const root of roots) {
      for (let folder = root; folder.startsWith(top); folder = dirname(folder)) {
        if (this.sharedFolders.has(folder)) break
        try {
          if (statSync(folder).uid === process.getuid?.()) chmodSync(folder, 0o770)
        } catch {
          // ENOENT: the folder appears with the command that creates it, which then holds the grant itself.
        }
        this.sharedFolders.add(folder)
        if (folder === top) break
      }
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

/**
 * The numeric id of a group from `/etc/group`.
 * @param name - the group's name.
 * @returns its gid.
 * @throws when no such group exists.
 */
function groupId(name: string): number {
  for (const line of readFileSync('/etc/group', 'utf8').split('\n')) {
    const [group, , gid] = line.split(':')
    if (group === name && gid !== undefined) return Number(gid)
  }
  throw new Error(`sandbox-jail: commandUser.group "${name}" is not a group on this Host`)
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
