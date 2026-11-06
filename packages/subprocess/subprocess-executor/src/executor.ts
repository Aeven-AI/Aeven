/**
 * The Host side of the executor: receives ready launchers from the helper and
 * turns one into a command without forking the Host. `spawnProcess` has the
 * `child_process.spawn` signature the local subprocess runtime injects; it
 * returns a ChildProcess-shaped proxy whose pid is the launcher's, whose
 * stdio are the launcher's pipes, and whose exit status the helper reports.
 * A call it cannot serve this way — no ready launcher, an inherited stream, a
 * program or directory that does not exist — falls back to the given spawner,
 * so spawn failures keep their usual errors.
 *
 * @module @aeven/subprocess-executor/executor
 */

import { EventEmitter } from 'node:events'
import { accessSync, constants, statSync } from 'node:fs'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import type { Socket } from 'node:net'
import { delimiter, isAbsolute, resolve } from 'node:path'

/** The `child_process.spawn` shape the local runtime injects. */
export type SpawnProcess = (program: string, args: readonly string[], options: SpawnOptions) => ChildProcess

/** One launcher the helper has handed over. */
interface Launcher {
  id: number
  pid: number
  stdin: Socket
  stdout: Socket
  stderr: Socket
  control: Socket
}

/** Helper-to-Host messages. */
type HelperMessage =
  | { t: 'handle'; id: number; which: 'stdin' | 'stdout' | 'stderr' | 'control' }
  | { t: 'ready'; id: number; pid: number }
  | { t: 'exit'; id: number; code: number | null; signal: NodeJS.Signals | null }
  | { t: 'gone'; id: number; code: number | null; signal: NodeJS.Signals | null; message: string }

/**
 * Quote one word for bash.
 * @param value - the word.
 * @returns its single-quoted form.
 */
function quote(value: string): string {
  return '\'' + value.replaceAll('\'', '\'\\\'\'') + '\''
}

/**
 * Resolve a program the way `execvp` would with the given environment.
 * @param program - the program as the caller named it.
 * @param cwd - the directory a relative path resolves against.
 * @param env - the command's environment, whose `PATH` names the search path.
 * @returns the executable's absolute path, or undefined when none is executable.
 */
function executable(program: string, cwd: string, env: NodeJS.ProcessEnv): string | undefined {
  const candidates = program.includes('/')
    ? [isAbsolute(program) ? program : resolve(cwd, program)]
    : (env.PATH ?? '').split(delimiter).filter(dir => dir !== '').map(dir => resolve(cwd, dir, program))
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK)
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // ENOENT or EACCES: this candidate is not runnable; the next one may be.
    }
  }
  return undefined
}

/** A command started in a launcher, shaped like the ChildProcess members the local runtime reads. */
class LaunchedProcess extends EventEmitter {
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly stdin: Socket | null
  private exited = false
  private openStreams = 2

  constructor(readonly pid: number, stdin: Socket | null, readonly stdout: Socket, readonly stderr: Socket) {
    super()
    this.stdin = stdin
    for (const stream of [stdout, stderr]) {
      stream.once('close', () => {
        this.openStreams -= 1
        this.closeIfDone()
      })
    }
  }

  kill(signal: NodeJS.Signals | number = 'SIGTERM'): boolean {
    if (this.exited) return false
    try {
      process.kill(this.pid, signal)
      return true
    } catch {
      // ESRCH: the command ended before the signal arrived.
      return false
    }
  }

  /** Record the exit status the helper reported. */
  exit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exited) return
    this.exited = true
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
    this.closeIfDone()
  }

  private closeIfDone(): void {
    if (this.exited && this.openStreams === 0) this.emit('close', this.exitCode, this.signalCode)
  }
}

/** How the Host starts the helper and reports on it. */
export interface ExecutorHost {
  /** Start one helper process with an IPC channel. */
  startHelper: () => ChildProcess
  /** Spawner for calls a launcher cannot serve. */
  fallback: SpawnProcess
  /** Report a helper that ended or could not be kept running. */
  warn: (message: string) => void
}

/** Restarts allowed within {@link RESTART_WINDOW_MS} before the executor stays on the fallback. */
const MAX_RESTARTS = 5
const RESTART_WINDOW_MS = 60_000

/** The Host's end of the executor helper. */
export class Executor {
  private readonly pending = new Map<number, Partial<Launcher>>()
  private readonly ready: Launcher[] = []
  private readonly running = new Map<number, LaunchedProcess>()
  private readonly restarts: number[] = []
  private helper: ChildProcess
  /** Disposed, or the helper kept failing: every call takes the fallback. */
  private closed = false

  /**
   * @param host - how to start the helper, the fallback spawner, and where to report.
   */
  constructor(private readonly host: ExecutorHost) {
    this.helper = this.attach(host.startHelper())
  }

  /** The current helper process, for the Host's exit hook. */
  get process(): ChildProcess {
    return this.helper
  }

  private attach(helper: ChildProcess): ChildProcess {
    helper.on('message', (message: HelperMessage, handle?: Socket) => { this.receive(message, handle) })
    helper.once('exit', (code, signal) => { this.helperEnded(helper, code, signal) })
    return helper
  }

  /**
   * Start a command in a ready launcher, or through the fallback spawner.
   * @param program - the program to run.
   * @param args - its arguments.
   * @param options - the local runtime's spawn options.
   * @returns the started process.
   */
  readonly spawnProcess: SpawnProcess = (program, args, options) => {
    const stdio = Array.isArray(options.stdio) ? options.stdio : []
    const cwd = typeof options.cwd === 'string' ? options.cwd : process.cwd()
    const env = options.env ?? {}
    const stdinMode = stdio[0]
    const served = !this.closed
      && options.detached === true
      && (stdinMode === 'ignore' || stdinMode === 'pipe')
      && stdio[1] === 'pipe' && stdio[2] === 'pipe'
    const file = served ? executable(program, cwd, env) : undefined
    const launcher = file !== undefined && !file.includes('=') && isDirectory(cwd) ? this.ready.shift() : undefined
    if (launcher === undefined || file === undefined) return this.host.fallback(program, args, options)
    this.helper.send({ t: 'taken', id: launcher.id })
    const assignments = Object.entries(env)
      .filter((entry): entry is [string, string] => entry[1] !== undefined && !entry[0].includes('='))
      .map(([key, value]) => quote(`${key}=${value}`))
    // No `--` before the program: BSD env treats it as the program. The program is an
    // absolute path without `=`, so env cannot mistake it for an option or an assignment.
    const script = `cd -- ${quote(cwd)} && exec /usr/bin/env -i ${assignments.join(' ')} ${[file, ...args].map(quote).join(' ')}`
    if (stdinMode === 'ignore') launcher.stdin.end()
    const started = new LaunchedProcess(launcher.pid, stdinMode === 'pipe' ? launcher.stdin : null, launcher.stdout, launcher.stderr)
    this.running.set(launcher.id, started)
    launcher.control.end(script)
    return started as unknown as ChildProcess
  }

  /** Stop the helper and the launchers nobody took. */
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const launcher of this.ready.splice(0)) {
      for (const stream of [launcher.stdin, launcher.stdout, launcher.stderr, launcher.control]) stream.destroy()
    }
    this.helper.disconnect()
  }

  private receive(message: HelperMessage, handle: Socket | undefined): void {
    switch (message.t) {
      case 'handle': {
        if (handle === undefined) return
        const launcher = this.pending.get(message.id) ?? { id: message.id }
        launcher[message.which] = handle
        this.pending.set(message.id, launcher)
        return
      }
      case 'ready': {
        const launcher = this.pending.get(message.id)
        this.pending.delete(message.id)
        const { stdin, stdout, stderr, control } = launcher ?? {}
        if (stdin === undefined || stdout === undefined || stderr === undefined || control === undefined) return
        if (this.closed) {
          for (const stream of [stdin, stdout, stderr, control]) stream.destroy()
          return
        }
        this.ready.push({ id: message.id, pid: message.pid, stdin, stdout, stderr, control })
        return
      }
      case 'exit':
        this.running.get(message.id)?.exit(message.code, message.signal)
        this.running.delete(message.id)
        return
      case 'gone': {
        const started = this.running.get(message.id)
        if (started !== undefined) {
          this.running.delete(message.id)
          started.exit(message.code, message.signal)
          return
        }
        const index = this.ready.findIndex(launcher => launcher.id === message.id)
        if (index >= 0) this.ready.splice(index, 1)
        this.pending.delete(message.id)
        return
      }
      /* v8 ignore next 2 -- HelperMessage is a closed union sent by this package's helper. */
      default:
        return
    }
  }

  /**
   * The helper ended: no exit status will arrive for the commands it started,
   * so each is reported as killed once its process group is gone, and a new
   * helper takes over unless the executor is closed or helpers keep failing.
   */
  private helperEnded(helper: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (helper !== this.helper) return
    for (const launcher of this.ready.splice(0)) {
      for (const stream of [launcher.stdin, launcher.stdout, launcher.stderr, launcher.control]) stream.destroy()
    }
    this.pending.clear()
    if (!this.closed) {
      const now = Date.now()
      while (this.restarts.length > 0 && now - (this.restarts[0] ?? now) > RESTART_WINDOW_MS) this.restarts.shift()
      if (this.restarts.length >= MAX_RESTARTS) {
        this.closed = true
        this.host.warn(`subprocess executor: helper exited (${String(code ?? signal)}) ${String(MAX_RESTARTS)} times within a minute; commands now start with ordinary spawns`)
      } else {
        this.restarts.push(now)
        this.host.warn(`subprocess executor: helper exited (${String(code ?? signal)}); starting a new one`)
        this.helper = this.attach(this.host.startHelper())
      }
    }
    for (const [id, started] of this.running) {
      this.running.delete(id)
      const settle = (): void => {
        try {
          process.kill(-started.pid, 0)
          setTimeout(settle, 100).unref()
        } catch {
          // ESRCH: the command's process group is gone.
          started.exit(null, 'SIGKILL')
        }
      }
      settle()
    }
  }
}

/**
 * Whether a path is an existing directory.
 * @param path - the path to test.
 * @returns true for a directory.
 */
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    // ENOENT or EACCES: the command could not start there.
    return false
  }
}
