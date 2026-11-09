/**
 * Supervision shared by the long-lived helper processes the jail provider runs outside every jail: start one,
 * record what it writes to stderr, and start it again when it ends, with a cooldown once it keeps ending.
 *
 * @module @aeven/sandbox-jail/supervised
 */

import type { ChildProcess } from 'node:child_process'

/** Restarts allowed within {@link RESTART_WINDOW_MS} one second apart; beyond them the next waits {@link RESTART_COOLDOWN_MS}. */
const MAX_RESTARTS = 5
const RESTART_WINDOW_MS = 60_000
/** Wait before restarting a helper that kept ending. */
const RESTART_COOLDOWN_MS = 300_000

/** What one supervised helper is started from. */
export interface SupervisedOptions {
  /** The prefix of the helper's own stderr lines and of the lines reported about it, e.g. `python-zygote`. */
  name: string
  /**
   * Start the helper with stderr piped.
   * @returns the started process.
   */
  spawn: () => ChildProcess
  /** What confined commands experience while the helper is down, completing "…; <whileDown> until the restart". */
  whileDown: string
  /** Reports a helper that ended or wrote to stderr; its `<name>: ready` line is the only `info`. */
  log: (level: 'info' | 'warn', message: string) => void
}

/** One helper process, restarted when it ends until {@link SupervisedProcess.dispose}. */
export class SupervisedProcess {
  private child: ChildProcess | undefined
  private readonly restarts: number[] = []
  private disposed = false
  private restartTimer: NodeJS.Timeout | undefined

  constructor(private readonly options: SupervisedOptions) {
    this.start()
  }

  /** Stop the helper and every later restart. */
  dispose(): void {
    this.disposed = true
    clearTimeout(this.restartTimer)
    this.child?.kill('SIGTERM')
    this.child = undefined
  }

  private start(): void {
    const { name, log, whileDown } = this.options
    const child = this.options.spawn()
    this.child = child
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) if (line.trim() !== '') log(line.startsWith(`${name}: ready`) ? 'info' : 'warn', line)
    })
    child.on('error', (error) => { log('warn', `${name}: cannot start: ${error.message}`) })
    child.on('exit', (code, signal) => {
      if (this.child !== child || this.disposed) return
      this.child = undefined
      const now = Date.now()
      while (this.restarts.length > 0 && now - (this.restarts[0] ?? now) > RESTART_WINDOW_MS) this.restarts.shift()
      const cooling = this.restarts.length >= MAX_RESTARTS
      if (cooling) {
        log('warn', `${name}: ended (${String(code ?? signal)}) ${String(MAX_RESTARTS)} times within a minute; ${whileDown} until the restart in ${String(RESTART_COOLDOWN_MS / 60_000)} minutes`)
        this.restarts.length = 0
      } else {
        log('warn', `${name}: ended (${String(code ?? signal)}); restarting`)
      }
      this.restarts.push(now)
      this.restartTimer = setTimeout(() => { if (!this.disposed) this.start() }, cooling ? RESTART_COOLDOWN_MS : 1_000)
    })
  }
}
