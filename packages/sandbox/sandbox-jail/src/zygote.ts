/**
 * The Python zygote's process on the Host: one preloaded interpreter, outside every jail, in its own cgroup,
 * restarted when it ends. Jailed `python3` commands reach it through the `python3` shim and the socket directory
 * each jail mounts at {@link JAIL_ZYGOTE_DIR}; the zygote joins each caller's own jail before running its program
 * (`python-zygote.py`, installed from `host/`, holds the protocol and the confinement). While it is down, the shim runs the image's
 * interpreter, so commands keep working at their ordinary start-up cost.
 *
 * @module @aeven/sandbox-jail/zygote
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { join } from 'node:path'

/** Where every jail mounts the zygote's socket directory, read-only; the shim connects to `python.sock` in it. */
export const JAIL_ZYGOTE_DIR = '/run/aeven/zygote'

/** Restarts allowed within {@link RESTART_WINDOW_MS} one second apart; beyond them the next waits {@link RESTART_COOLDOWN_MS}. */
const MAX_RESTARTS = 5
const RESTART_WINDOW_MS = 60_000
/** Wait before restarting a zygote that kept ending, while the shim runs the interpreter for every command. */
const RESTART_COOLDOWN_MS = 300_000

/** Everything one zygote process starts from. */
export interface ZygoteOptions {
  /** The helper that switches to the sandbox user, when commands run as one; the zygote must share their user. */
  exec?: string | undefined
  /** The image's interpreter, the same one the shim falls back to. */
  python: string
  /** Host path of `python-zygote.py`, as `host/install-python-zygote.sh` installs it. */
  script: string
  /** Modules imported before the first run. */
  preload: readonly string[]
  /** Host directory holding the socket, created by the caller and mounted into every jail. */
  socketDir: string
  /** The cgroup directory the zygote runs in. */
  group: string
  /** The directory whose `acct-*` children are the account groups a caller may belong to. */
  accountsCgroup: string
  /** Host path of the jail's system-call filter, loaded into every run. */
  seccompFilter: string
  /** The jail's environment; the zygote starts with it, and a request that changes an import-time variable runs the interpreter. */
  env: Readonly<Record<string, string>>
  /** Reports a zygote that ended or wrote to stderr. */
  log: (level: 'info' | 'warn', message: string) => void
}

/** One supervised zygote process. */
export class PythonZygote {
  private child: ChildProcess | undefined
  private readonly restarts: number[] = []
  private disposed = false
  private restartTimer: NodeJS.Timeout | undefined

  constructor(private readonly options: ZygoteOptions) {
    this.start()
  }

  /** Stop the zygote and every later restart; runs already started end with their commands. */
  dispose(): void {
    this.disposed = true
    clearTimeout(this.restartTimer)
    this.child?.kill('SIGTERM')
    this.child = undefined
  }

  private start(): void {
    const { options } = this
    const config = JSON.stringify({
      socket: join(options.socketDir, 'python.sock'),
      preload: options.preload,
      accountsCgroup: options.accountsCgroup,
      seccompFilter: options.seccompFilter,
      pinned: options.env,
    })
    // The shell step joins the zygote's group before the interpreter starts, so its imports are charged there.
    const child = spawn('/bin/sh', [
      '-c', 'echo 0 > "$1/cgroup.procs" || exit 125; shift; exec "$@"', 'python-zygote',
      options.group, ...options.exec === undefined ? [] : [options.exec], options.python, options.script, config,
    ], {
      env: { ...options.env, HOME: options.socketDir, MPLCONFIGDIR: join(options.socketDir, 'mpl') },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    this.child = child
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) if (line.trim() !== '') options.log(line.startsWith('python-zygote: ready') ? 'info' : 'warn', line)
    })
    child.on('error', (error) => { options.log('warn', `python-zygote: cannot start: ${error.message}`) })
    child.on('exit', (code, signal) => {
      if (this.child !== child || this.disposed) return
      this.child = undefined
      const now = Date.now()
      while (this.restarts.length > 0 && now - (this.restarts[0] ?? now) > RESTART_WINDOW_MS) this.restarts.shift()
      const cooling = this.restarts.length >= MAX_RESTARTS
      if (cooling) {
        options.log('warn', `python-zygote: ended (${String(code ?? signal)}) ${String(MAX_RESTARTS)} times within a minute; python3 starts the interpreter for every command until the restart in ${String(RESTART_COOLDOWN_MS / 60_000)} minutes`)
        this.restarts.length = 0
      } else {
        options.log('warn', `python-zygote: ended (${String(code ?? signal)}); restarting`)
      }
      this.restarts.push(now)
      this.restartTimer = setTimeout(() => { if (!this.disposed) this.start() }, cooling ? RESTART_COOLDOWN_MS : 1_000)
    })
  }
}
