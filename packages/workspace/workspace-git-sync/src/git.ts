/**
 * This device's Git: the executable found on `PATH` or in each platform's standard install locations, the platform's
 * own installer once the user accepts it, and bounded, non-interactive Git commands.
 * @module @aeven/workspace-git-sync/git
 */
import { existsSync, readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import { findGit } from '@aeven/git-executable'
import type {} from '@aeven/subprocess'

/** Bounds and installer behavior for Git commands. */
export interface GitOptions {
  /** Interval between checks for a finished install. */
  installPollMs: number
  /** Longest wait for an install the user may have to confirm. */
  installTimeoutMs: number
  /** Longest an ordinary command runs. */
  commandTimeoutMs: number
  /** Longest a clone or bundle runs. */
  transferTimeoutMs: number
  /** Grace a terminated command gets before it is killed. */
  graceMs: number
  /** Largest output kept from one command. */
  outputMaxBytes: number
  /**
   * Wrap a command so it runs confined to the given directories, for a Host whose work trees belong to accounts other
   * than its own user: the command then sees nothing else, so a repository's configuration or hooks reach no other
   * account. Absent, commands run as this device's user.
   * @param argv - the command to confine, environment already applied through `env`.
   * @param roots - the directories it may write: its working directory first, then any transfer folder it uses.
   * @returns the argv to spawn instead.
   */
  confine?: ((argv: readonly string[], roots: readonly string[]) => string[]) | undefined
}

/** One finished Git command. */
export interface GitResult {
  /** Exit code, or null when a signal or the time limit ended the command. */
  exitCode: number | null
  stdout: string
  stderr: string
}

/** Options for one Git command. */
export interface GitRun {
  /** Directory the command runs in. */
  cwd: string
  /** A clone, fetch, or bundle, which gets the transfer time limit. */
  transfer?: boolean
  /** Cancels the command. */
  signal?: AbortSignal
  /** Environment entries for this command. */
  env?: Record<string, string>
  /** Directories besides `cwd` the command reads or writes, such as a transfer folder; a confined command sees only these. */
  roots?: readonly string[]
}

/**
 * GNU `cp` arguments that copy a folder's contents into the working directory, keeping files already there and
 * symbolic links as links, for a confined copy into a work tree.
 */
export const COPY_MISSING: readonly string[] = ['cp', '-R', '--update=none', '--no-dereference', '--preserve=mode,timestamps']

/** No Git on this device, or the platform's installer could not install it. */
export class GitUnavailableError extends Error {}

/** Finds, installs, and runs this device's Git. */
export class Git {
  private executable: string | undefined
  private installing: Promise<string> | undefined
  /** Whether the user's configuration names its own SSH command, which an override would replace. */
  private sshConfigured: boolean | undefined

  /**
   * @param ctx - context providing `subprocess`.
   * @param options - installer behavior and command bounds.
   */
  constructor(private readonly ctx: Context, private readonly options: GitOptions) {}

  /**
   * The Git executable.
   * @returns the executable path.
   * @throws {GitUnavailableError} when this device has no Git.
   */
  async require(): Promise<string> {
    const found = await this.find()
    if (found === undefined) throw new GitUnavailableError('Git is not installed on this computer')
    return found
  }

  /**
   * Install Git through the platform's installer, which the user has accepted: Homebrew or Apple's Command Line Tools
   * dialog on macOS, winget on Windows, and the distribution's package manager behind the system password prompt on
   * Linux. Concurrent calls share one install.
   * @param signal - cancels the install wait.
   * @returns the executable path once Git is found.
   * @throws {GitUnavailableError} when the installer is missing, fails, or Git does not appear within the time limit.
   */
  install(signal?: AbortSignal): Promise<string> {
    this.installing ??= this.find()
      .then(found => found ?? this.runInstaller(signal))
      .finally(() => { this.installing = undefined })
    return this.installing
  }

  /**
   * Whether this device has Git now, without installing it.
   * @returns true when an executable is on `PATH` or in a standard location.
   */
  async available(): Promise<boolean> {
    return await this.find() !== undefined
  }

  /**
   * Run one Git command without prompts: a credential or host-key question fails the command instead of waiting.
   * @param args - arguments after `git`.
   * @param run - directory, time limit, and cancellation.
   * @returns the result; a non-zero exit is data, not an error.
   */
  async run(args: readonly string[], run: GitRun): Promise<GitResult> {
    const executable = await this.require()
    const env = { ...await this.environment(executable), ...run.env }
    // A confined command runs as another user, who owns neither the directories this Host created nor the work tree.
    return this.spawn(this.options.confine === undefined ? [executable, ...args] : [executable, '-c', 'safe.directory=*', ...args], env, run)
  }

  /**
   * Run another program the way Git commands run, confined to the same directories: for file copies into or out of a
   * work tree that this Host's own user must not make, since a path inside it may lead into another account's files.
   * @param argv - the program and its arguments.
   * @param run - directory, extra directories, time limit, and cancellation.
   * @returns the result; a non-zero exit is data, not an error.
   * @throws {Error} when commands are not confined, since the copy would then run as this Host's own user.
   */
  async tool(argv: readonly string[], run: GitRun): Promise<GitResult> {
    if (this.options.confine === undefined) throw new Error('a confined copy needs a Git runner that confines its commands')
    return this.spawn(argv, run.env ?? {}, run)
  }

  private async spawn(command: readonly string[], env: Record<string, string>, run: GitRun): Promise<GitResult> {
    const timeout = AbortSignal.timeout(run.transfer === true ? this.options.transferTimeoutMs : this.options.commandTimeoutMs)
    const signal = run.signal === undefined ? timeout : AbortSignal.any([run.signal, timeout])
    const confine = this.options.confine
    // A confined command starts with an empty environment, so its entries travel in its argv through `env`.
    const argv = confine === undefined
      ? [...command]
      : confine(['/usr/bin/env', ...Object.entries(env).map(([name, value]) => `${name}=${value}`), ...command], [run.cwd, ...run.roots ?? []])
    const child = this.ctx.subprocess.spawn({
      argv,
      cwd: run.cwd,
      signal,
      graceMs: this.options.graceMs,
      env,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: this.options.outputMaxBytes },
        stderr: { maxBytes: this.options.outputMaxBytes },
      },
    })
    const outcome = await child.done
    return {
      exitCode: outcome.signal === null ? outcome.exitCode : null,
      stdout: child.collected.stdout?.readFrom(0).text ?? '',
      stderr: child.collected.stderr?.readFrom(0).text ?? '',
    }
  }

  /**
   * Run one Git command that must succeed.
   * @param args - arguments after `git`.
   * @param run - directory, time limit, and cancellation.
   * @returns its standard output.
   * @throws {Error} naming the command and its error output when it fails.
   */
  async output(args: readonly string[], run: GitRun): Promise<string> {
    const result = await this.run(args, run)
    if (result.exitCode !== 0) {
      const status = result.exitCode === null ? 'was stopped' : `exited ${String(result.exitCode)}`
      throw new Error(`git ${args[0] ?? ''} ${status}: ${result.stderr.trim().slice(-600)}`)
    }
    return result.stdout
  }

  /** The first Git executable on `PATH` or in this platform's standard locations. */
  private async find(): Promise<string | undefined> {
    if (this.executable !== undefined && existsSync(this.executable)) return this.executable
    // No Git on `PATH` resolves to undefined; the standard locations cover a GUI app's short `PATH` and a fresh install.
    this.executable = await findGit(() => this.ctx.subprocess.resolveExecutable('git').catch(() => undefined))
    return this.executable
  }

  private async runInstaller(signal: AbortSignal | undefined): Promise<string> {
    const logger = this.ctx.logger('workspace-git-sync')
    const installer = await this.installer()
    logger.info(`workspace-git-sync: installing Git with ${installer.join(' ')}`)
    const child = this.ctx.subprocess.spawn({
      argv: installer,
      cwd: process.cwd(),
      ...signal === undefined ? {} : { signal },
      graceMs: this.options.graceMs,
      env: { NONINTERACTIVE: '1', HOMEBREW_NO_AUTO_UPDATE: '1' },
      stdio: { stdin: 'ignore', stdout: { maxBytes: this.options.outputMaxBytes }, stderr: { maxBytes: this.options.outputMaxBytes } },
    })
    const outcome = await child.done
    if (outcome.exitCode !== 0) {
      // The system password prompt was dismissed or the package manager failed; nothing will install Git.
      if (process.platform === 'linux') throw new GitUnavailableError(`${installer.join(' ')} exited ${String(outcome.exitCode)}`)
      logger.warn(`workspace-git-sync: ${installer.join(' ')} exited ${String(outcome.exitCode)}; waiting for Git anyway`)
    }
    // A running process does not see a `PATH` change, and Apple's dialog installs after its command returns.
    const deadline = Date.now() + this.options.installTimeoutMs
    for (;;) {
      const found = await this.find()
      if (found !== undefined) return found
      if (Date.now() >= deadline) throw new GitUnavailableError('Git did not finish installing')
      await delay(this.options.installPollMs, undefined, signal === undefined ? {} : { signal })
    }
  }

  /** This platform's Git installer command. */
  private async installer(): Promise<string[]> {
    if (process.platform === 'darwin') {
      const brew = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find(path => existsSync(path))
      return brew === undefined ? ['xcode-select', '--install'] : [brew, 'install', 'git']
    }
    if (process.platform === 'win32') {
      const winget = await this.ctx.subprocess.resolveExecutable('winget').catch(() => undefined)
      if (winget === undefined) throw new GitUnavailableError('Git is not installed and winget is unavailable')
      return [winget, 'install', '--id', 'Git.Git', '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements']
    }
    // Installing needs root; pkexec asks for the password through the desktop's own prompt.
    const pkexec = await this.ctx.subprocess.resolveExecutable('pkexec').catch(() => undefined)
    if (pkexec === undefined) throw new GitUnavailableError('Git is not installed and pkexec is unavailable')
    return [pkexec, ...linuxInstallCommand()]
  }

  /**
   * Environment that keeps Git from asking for credentials or host keys on a terminal nobody watches, and from taking
   * the optional index lock a read such as `git diff` refreshes, which would fail the agent's own Git commands in the
   * same work tree.
   */
  private async environment(executable: string): Promise<Record<string, string>> {
    const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_OPTIONAL_LOCKS: '0' }
    // A confined command reaches the network through HTTPS alone; this Host's own SSH settings do not apply to it.
    if (this.options.confine !== undefined) return env
    if (process.env.GIT_SSH_COMMAND !== undefined || process.env.GIT_SSH !== undefined) return env
    this.sshConfigured ??= await this.configured(executable, 'core.sshCommand')
    return this.sshConfigured ? env : { ...env, GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }
  }

  private async configured(executable: string, key: string): Promise<boolean> {
    const child = this.ctx.subprocess.spawn({
      argv: [executable, 'config', '--global', '--get', key],
      cwd: process.cwd(),
      graceMs: this.options.graceMs,
      signal: AbortSignal.timeout(this.options.commandTimeoutMs),
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
    })
    return (await child.done).exitCode === 0
  }
}

/** The distribution's non-interactive Git install command, which needs root. */
function linuxInstallCommand(): string[] {
  let release = ''
  try {
    release = readFileSync('/etc/os-release', 'utf8')
  } catch {
    // Without `/etc/os-release` the distribution is unknown; the Debian command below is the most common one.
  }
  const ids = (/^ID_LIKE=(.*)$/mu.exec(release)?.[1] ?? '') + ' ' + (/^ID=(.*)$/mu.exec(release)?.[1] ?? '')
  if (/fedora|rhel|centos/u.test(ids)) return ['dnf', 'install', '-y', 'git']
  if (/arch/u.test(ids)) return ['pacman', '-S', '--noconfirm', 'git']
  if (/suse/u.test(ids)) return ['zypper', '--non-interactive', 'install', 'git']
  if (/alpine/u.test(ids)) return ['apk', 'add', 'git']
  return ['apt-get', 'install', '-y', 'git']
}
