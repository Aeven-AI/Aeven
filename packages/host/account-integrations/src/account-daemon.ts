/** Shared loopback daemon startup, environment isolation, and shutdown. */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'
import { z } from 'zod'

/**
 * Host variables the daemon needs: PATH for its optional tooling, plus home and temporary directories.
 * Provider keys and other secrets stay in the Host.
 */
const INHERITED_VARIABLES = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'SYSTEMROOT', 'windir', 'LANG']

function inheritedEnvironment(): Record<string, string> {
  return Object.fromEntries(INHERITED_VARIABLES.flatMap(name => process.env[name] === undefined ? [] : [[name, process.env[name]]]))
}

const listeningSchema = z.object({ listening: z.string().regex(/^127\.0\.0\.1:\d+$/) })

/** The loopback address from the daemon's one JSON stdout announcement, or undefined for any other line. */
function listeningAddress(line: string): string | undefined {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    // Only the announcement is JSON; other stdout lines carry no address.
    return undefined
  }
  const parsed = listeningSchema.safeParse(value)
  return parsed.success ? parsed.data.listening : undefined
}

/** Process and control-request budgets shared by account daemons. */
export interface AccountDaemonOptions {
  /** Time allowed between spawn and the bound-address announcement. */
  startupTimeoutMs: number
  /** Time allowed for control requests. */
  requestTimeoutMs: number
  /** Time between closing stdin and SIGKILL. */
  stopGraceMs: number
}

/** A loopback daemon whose stdin lifetime is owned by the Host. */
export class AccountDaemon {
  /** Bearer token required by the daemon. */
  readonly token = randomBytes(32).toString('hex')
  private child: ChildProcess | undefined
  private address: string | undefined
  private stopping = false
  /** Settles when the process exits or fails to spawn. */
  readonly exited: Promise<number | null>
  private markExited!: (code: number | null) => void

  /**
   * @param label - daemon name used in startup and endpoint failures.
   * @param directory - account-owned data directory.
   * @param options - process and request budgets.
   */
  constructor(private readonly label: string, readonly directory: string, protected readonly options: AccountDaemonOptions) {
    this.exited = new Promise((resolve) => { this.markExited = resolve })
  }

  /** MCP endpoint of the running daemon. */
  get endpoint(): string {
    if (this.address === undefined) throw new Error(`${this.label} daemon is not running`)
    return `http://${this.address}/mcp`
  }

  /** Whether the process was started and has not exited. */
  get running(): boolean {
    return this.child !== undefined && this.child.exitCode === null && this.child.signalCode === null
  }

  /**
   * @param command - daemon executable.
   * @param args - daemon startup arguments.
   * @param env - account-specific daemon variables, added to the isolated environment.
   */
  protected async launch(command: string, args: string[], env: Record<string, string>): Promise<void> {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
      env: { ...inheritedEnvironment(), ...env },
    })
    this.child = child
    child.once('exit', (code) => { this.markExited(code) })
    // A spawn error has no exit event, so it must also settle exit waiters.
    child.once('error', () => { this.markExited(null) })
    const lines = createInterface({ input: child.stdout })
    try {
      this.address = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error(`${this.label} daemon did not start in time`)) }, this.options.startupTimeoutMs)
        void this.exited.then(() => { clearTimeout(timer); reject(new Error(`${this.label} daemon exited during startup`)) })
        lines.on('line', (line) => {
          const address = listeningAddress(line)
          if (address !== undefined) { clearTimeout(timer); resolve(address) }
        })
      })
    } catch (error) {
      await this.stop()
      throw error
    } finally {
      lines.close()
      child.stdout.resume()
    }
  }

  /** Whether stop was requested; an exit after it is expected. */
  get stopped(): boolean {
    return this.stopping
  }

  /** Close stdin and wait for exit, killing the process after the configured grace period. */
  async stop(): Promise<void> {
    this.stopping = true
    const child = this.child
    if (child === undefined || !this.running) return
    child.stdin?.end()
    const timer = setTimeout(() => { child.kill('SIGKILL') }, this.options.stopGraceMs)
    await this.exited
    clearTimeout(timer)
  }

  /** @returns the bound address of a live daemon. */
  protected requireAddress(): string {
    if (this.address === undefined || !this.running) throw new Error(`${this.label} daemon is not running`)
    return this.address
  }
}
