/**
 * This device's Git: the executable found on `PATH` or in each platform's standard install locations, the platform's
 * own installer once the user accepts it, and bounded, non-interactive Git commands.
 * @module @aeven/workspace-git-sync/git
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
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
}

/** No Git on this device, or the platform's installer could not install it. */
export class GitUnavailableError extends Error {}

/** The macOS command-line stub that opens Apple's install dialog when the developer tools are absent. */
const MACOS_GIT_STUB = '/usr/bin/git'

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
    const timeout = AbortSignal.timeout(run.transfer === true ? this.options.transferTimeoutMs : this.options.commandTimeoutMs)
    const signal = run.signal === undefined ? timeout : AbortSignal.any([run.signal, timeout])
    const child = this.ctx.subprocess.spawn({
      argv: [executable, ...args],
      cwd: run.cwd,
      signal,
      graceMs: this.options.graceMs,
      env: { ...await this.environment(executable), ...run.env },
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
    this.executable = undefined
    try {
      const onPath = await this.ctx.subprocess.resolveExecutable('git')
      // The stub on `PATH` opens an install dialog instead of running Git when the developer tools are absent.
      if (process.platform !== 'darwin' || onPath !== MACOS_GIT_STUB) this.executable = onPath
    } catch {
      // No Git on `PATH`; the standard locations below cover a GUI app's short `PATH` and a fresh install.
    }
    this.executable ??= standardLocations().find(path => existsSync(path))
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

  /** Environment that keeps Git from asking for credentials or host keys on a terminal nobody watches. */
  private async environment(executable: string): Promise<Record<string, string>> {
    const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
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

/** Where each platform's Git installers put the executable. */
function standardLocations(): string[] {
  if (process.platform === 'darwin') {
    return [
      '/opt/homebrew/bin/git',
      '/usr/local/bin/git',
      '/Library/Developer/CommandLineTools/usr/bin/git',
      '/Applications/Xcode.app/Contents/Developer/usr/bin/git',
    ]
  }
  if (process.platform === 'win32') {
    return [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
      .filter(base => base !== undefined)
      .map(base => join(base, 'Git', 'cmd', 'git.exe'))
      .concat(process.env.LOCALAPPDATA === undefined ? [] : [join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'cmd', 'git.exe')])
  }
  return ['/usr/bin/git', '/usr/local/bin/git']
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
