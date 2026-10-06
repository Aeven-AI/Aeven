/** Bundled `whatsapp-mcp` daemon processes: binary resolution, launch, pairing status, and teardown. */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { z } from 'zod'

/**
 * Resolve the daemon from the platform package installed for this host.
 * @param override - explicit binary path from deployment configuration.
 * @returns absolute executable path, or undefined when this host has no platform package.
 */
export function resolveWhatsAppBinary(override: string | undefined): string | undefined {
  if (override !== undefined) return override
  try {
    const manifest = createRequire(import.meta.url).resolve(`@aeven/whatsapp-mcp-${process.platform}-${process.arch}/package.json`)
    return join(dirname(manifest), 'bin', process.platform === 'win32' ? 'whatsapp-mcp.exe' : 'whatsapp-mcp')
  } catch {
    // An absent optional platform package means WhatsApp is unsupported on this host; Settings reports it as not configured.
    return undefined
  }
}

/** Host variables the daemon needs: PATH for its optional ffmpeg, home and temporary directories, and Windows system paths. Provider keys and other secrets stay in the Host. */
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

/** Daemon `/status` response; `qr_png` is a base64 PNG present only in the `qr` state. */
const statusSchema = z.object({
  state: z.enum(['starting', 'qr', 'paired', 'expired', 'failed']),
  qr_png: z.string().optional(), phone: z.string().optional(), name: z.string().optional(),
})

/** Pairing state of one daemon. */
export type WhatsAppDaemonStatus = z.infer<typeof statusSchema>

/** Process and network budgets for one daemon; all fields come from validated deployment configuration. */
export interface WhatsAppDaemonOptions {
  /** Time allowed between spawn and the bound-address line. */
  startupTimeoutMs: number
  /** Time allowed for `/status` and `/logout` requests. */
  requestTimeoutMs: number
  /** Time between closing stdin and SIGKILL during shutdown. */
  stopGraceMs: number
}

/**
 * One `whatsapp-mcp serve` process bound to a loopback port chosen by the operating system.
 * The parent holds the child's stdin open; the daemon exits when it closes, so a crashed Host leaves no process holding the store lock.
 */
export class WhatsAppDaemon {
  /** Bearer token the daemon requires on `/mcp`, `/status`, and `/logout`. */
  readonly token = randomBytes(32).toString('hex')
  private child: ChildProcess | undefined
  private address: string | undefined
  private stopping = false
  /** Settles when the process has exited. */
  readonly exited: Promise<number | null>
  private markExited!: (code: number | null) => void

  /**
   * @param binary - daemon executable.
   * @param directory - Aeven-owned data directory holding `store/` and `media/`.
   * @param options - process and request budgets.
   */
  constructor(private readonly binary: string, readonly directory: string, private readonly options: WhatsAppDaemonOptions) {
    this.exited = new Promise((resolve) => { this.markExited = resolve })
  }

  /** MCP endpoint of the running daemon. */
  get endpoint(): string {
    if (this.address === undefined) throw new Error('WhatsApp daemon is not running')
    return `http://${this.address}/mcp`
  }

  /** Whether the process was started and has not exited. */
  get running(): boolean {
    return this.child !== undefined && this.child.exitCode === null && this.child.signalCode === null
  }

  /** Spawn the daemon and wait for its bound loopback address. */
  async start(): Promise<void> {
    const store = join(this.directory, 'store')
    const media = join(this.directory, 'media')
    await mkdir(store, { recursive: true, mode: 0o700 })
    await mkdir(media, { recursive: true, mode: 0o700 })
    const child = spawn(this.binary, ['-store', store, 'serve', '-addr', '127.0.0.1:0', '-exit-on-stdin-eof'], {
      stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
      env: { ...inheritedEnvironment(), WHATSAPP_MCP_TOKEN: this.token, WHATSAPP_MCP_MEDIA_ROOT: media },
    })
    this.child = child
    child.once('exit', (code) => { this.markExited(code) })
    // A spawn failure also emits exit-less 'error'; settle the exit promise so waiters do not hang.
    child.once('error', () => { this.markExited(null) })
    const lines = createInterface({ input: child.stdout! })
    try {
      this.address = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('WhatsApp daemon did not start in time')) }, this.options.startupTimeoutMs)
        void this.exited.then(() => { clearTimeout(timer); reject(new Error('WhatsApp daemon exited during startup')) })
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
   * Read the daemon's pairing state.
   * @returns current state, QR image, and paired account.
   */
  async status(): Promise<WhatsAppDaemonStatus> {
    const response = await fetch(`http://${this.requireAddress()}/status`, {
      headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(this.options.requestTimeoutMs),
    })
    if (!response.ok) throw new Error(`WhatsApp daemon status failed with HTTP ${String(response.status)}`)
    return statusSchema.parse(await response.json())
  }

  /** Remove this linked device from the WhatsApp account and clear its local session. */
  async logout(): Promise<void> {
    const response = await fetch(`http://${this.requireAddress()}/logout`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(this.options.requestTimeoutMs),
    })
    if (!response.ok) throw new Error(`WhatsApp logout failed with HTTP ${String(response.status)}`)
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

  private requireAddress(): string {
    if (this.address === undefined || !this.running) throw new Error('WhatsApp daemon is not running')
    return this.address
  }
}
