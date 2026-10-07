/** Bundled `telegram-mcp` daemon processes: entry resolution, launch, sign-in control, and teardown. */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { z } from 'zod'

/**
 * Resolve the daemon entry of the vendored package installed for this host.
 * @param override - explicit entry path from deployment configuration.
 * @returns absolute entry path, or undefined when this host has no vendored package.
 */
export function resolveTelegramEntry(override: string | undefined): string | undefined {
  if (override !== undefined) return override
  try {
    const manifest = createRequire(import.meta.url).resolve('@aeven/telegram-mcp/package.json')
    return join(dirname(manifest), 'dist', 'aeven', 'main.js')
  } catch {
    // An absent package means Telegram is unsupported on this host; Settings reports it as not configured.
    return undefined
  }
}

/** Host variables the daemon needs: PATH for its optional tooling, plus home and temporary directories. Provider keys and other secrets stay in the Host. */
const INHERITED_VARIABLES = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'SYSTEMROOT', 'windir', 'LANG']

function inheritedEnvironment(): Record<string, string> {
  return Object.fromEntries(INHERITED_VARIABLES.flatMap(name => process.env[name] === undefined ? [] : [[name, process.env[name]!]]))
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

/** Daemon `/status` response; `identity` is present once an account is signed in, `qr` while a login code awaits a scan. */
const statusSchema = z.object({
  state: z.enum(['login', 'code', 'qr', 'password', 'authorized', 'unlinked', 'failed']),
  phone: z.string().optional(),
  reason: z.enum(['code-invalid', 'password-invalid', 'phone-invalid', 'too-many-attempts', 'unreachable', 'other']).optional(),
  identity: z.object({
    id: z.string(), name: z.string().optional(), username: z.string().optional(), phone: z.string().optional(),
  }).optional(),
  // Rendered into an <img> in Settings, so only the daemon's own SVG data URL is accepted.
  qr: z.string().regex(/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/).optional(),
})

/** Sign-in progress of one daemon. */
export type TelegramDaemonStatus = z.infer<typeof statusSchema>

/** Telegram application identifiers the daemon signs in with, read from the Aeven API by the Host. */
export interface TelegramCredentials {
  /** Application id from the deployment's registered Telegram application. */
  apiId: string
  /** Application hash; supplied only to the child environment. */
  apiHash: string
}

/** Process and network budgets for one daemon; all fields come from validated deployment configuration. */
export interface TelegramDaemonOptions {
  /** Time allowed between spawn and the bound-address line. */
  startupTimeoutMs: number
  /** Time allowed for control requests. */
  requestTimeoutMs: number
  /** Time between closing stdin and SIGKILL during shutdown. */
  stopGraceMs: number
}

/**
 * One Telegram daemon process bound to a loopback port chosen by the operating system.
 * The parent holds the child's stdin open; the daemon exits when it closes, so a crashed Host leaves no process holding a session.
 */
export class TelegramDaemon {
  /** Bearer token the daemon requires on every request. */
  readonly token = randomBytes(32).toString('hex')
  private child: ChildProcess | undefined
  private address: string | undefined
  private stopping = false
  /** Settles when the process has exited. */
  readonly exited: Promise<number | null>
  private markExited!: (code: number | null) => void

  /**
   * @param entry - built daemon entry, run by this Host's own runtime.
   * @param directory - Aeven-owned data directory holding the session string and downloads.
   * @param credentials - deployment-owned Telegram application credentials.
   * @param options - process and request budgets.
   */
  constructor(private readonly entry: string, readonly directory: string, private readonly credentials: TelegramCredentials,
    private readonly options: TelegramDaemonOptions) {
    this.exited = new Promise((resolve) => { this.markExited = resolve })
  }

  /** MCP endpoint of the running daemon. */
  get endpoint(): string {
    if (this.address === undefined) throw new Error('Telegram daemon is not running')
    return `http://${this.address}/mcp`
  }

  /** Whether the process was started and has not exited. */
  get running(): boolean {
    return this.child !== undefined && this.child.exitCode === null && this.child.signalCode === null
  }

  /** Spawn the daemon and wait for its bound loopback address. */
  async start(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const child = spawn(process.execPath, [this.entry], {
      stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
      env: {
        ...inheritedEnvironment(), TELEGRAM_MCP_TOKEN: this.token, TELEGRAM_MCP_HOME: this.directory,
        TELEGRAM_API_ID: this.credentials.apiId, TELEGRAM_API_HASH: this.credentials.apiHash,
      },
    })
    this.child = child
    child.once('exit', (code) => { this.markExited(code) })
    // A spawn failure also emits exit-less 'error'; settle the exit promise so waiters do not hang.
    child.once('error', () => { this.markExited(null) })
    const lines = createInterface({ input: child.stdout! })
    try {
      this.address = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('Telegram daemon did not start in time')) }, this.options.startupTimeoutMs)
        void this.exited.then(() => { clearTimeout(timer); reject(new Error('Telegram daemon exited during startup')) })
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
      child.stdout!.resume()
    }
  }

  /**
   * Read the daemon's sign-in state.
   * @param verify - also confirm with Telegram that the stored session still works.
   * @returns current state, the account it belongs to, and any rejected-step reason.
   */
  async status(verify = false): Promise<TelegramDaemonStatus> {
    return statusSchema.parse(await this.request('GET', `/status${verify ? '?verify=1' : ''}`))
  }

  /**
   * Send a login code to a number and wait for Telegram to deliver it.
   * @param phone - international number, with or without a leading `+`.
   */
  async loginStart(phone: string): Promise<TelegramDaemonStatus> {
    return statusSchema.parse(await this.request('POST', '/login/start', { phone }))
  }

  /** Request a login QR code for the Telegram app to scan and wait for its first token. */
  async loginQr(): Promise<TelegramDaemonStatus> {
    return statusSchema.parse(await this.request('POST', '/login/qr'))
  }

  /**
   * Submit the code Telegram sent.
   * @param code - digits from the Telegram message.
   */
  async loginCode(code: string): Promise<TelegramDaemonStatus> {
    return statusSchema.parse(await this.request('POST', '/login/code', { code }))
  }

  /**
   * Submit the account's 2FA password.
   * @param password - the account password, never logged or shown.
   */
  async loginPassword(password: string): Promise<TelegramDaemonStatus> {
    return statusSchema.parse(await this.request('POST', '/login/password', { password }))
  }

  /** Terminate this account's Telegram session and clear its stored session string. */
  async logout(): Promise<void> {
    await this.request('POST', '/logout')
  }

  /** Whether `stop()` was called; an exit after it is expected. */
  get stopped(): boolean {
    return this.stopping
  }

  /** Close stdin so the daemon shuts down cleanly, then kill it if it outlives the grace period. */
  async stop(): Promise<void> {
    this.stopping = true
    const child = this.child
    if (child === undefined || !this.running) return
    child.stdin?.end()
    const timer = setTimeout(() => { child.kill('SIGKILL') }, this.options.stopGraceMs)
    await this.exited
    clearTimeout(timer)
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`http://${this.requireAddress()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, ...body === undefined ? {} : { 'Content-Type': 'application/json' } },
      ...body === undefined ? {} : { body: JSON.stringify(body) },
      signal: AbortSignal.timeout(this.options.requestTimeoutMs),
    })
    if (!response.ok) throw new Error(`Telegram daemon ${method} ${path} failed with HTTP ${String(response.status)}`)
    return await response.json()
  }

  private requireAddress(): string {
    if (this.address === undefined || !this.running) throw new Error('Telegram daemon is not running')
    return this.address
  }
}
