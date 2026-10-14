/** Bundled `telegram-mcp` daemon processes: entry resolution, launch, sign-in control, and teardown. */

import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { AccountDaemon, type AccountDaemonOptions } from './account-daemon.ts'

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
export interface TelegramDaemonOptions extends AccountDaemonOptions {}

/**
 * One Telegram daemon process bound to a loopback port chosen by the operating system.
 * The parent holds the child's stdin open; the daemon exits when it closes, so a crashed Host leaves no process holding a session.
 */
export class TelegramDaemon extends AccountDaemon {
  /**
   * @param entry - built daemon entry, run by this Host's own runtime.
   * @param directory - Aeven-owned data directory holding the session string and downloads.
   * @param credentials - deployment-owned Telegram application credentials.
   * @param options - process and request budgets.
   */
  constructor(private readonly entry: string, directory: string, private readonly credentials: TelegramCredentials,
    options: TelegramDaemonOptions) {
    super('Telegram', directory, options)
  }

  /** Spawn the daemon and wait for its bound loopback address. */
  async start(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await this.launch(process.execPath, [this.entry], {
      TELEGRAM_MCP_TOKEN: this.token, TELEGRAM_MCP_HOME: this.directory,
      TELEGRAM_API_ID: this.credentials.apiId, TELEGRAM_API_HASH: this.credentials.apiHash,
    })
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
   * @returns the daemon status after Telegram accepted the number.
   */
  async loginStart(phone: string): Promise<TelegramDaemonStatus> {
    return statusSchema.parse(await this.request('POST', '/login/start', { phone }))
  }

  /**
   * Request a login QR code for the Telegram app to scan and wait for its first token.
   * @returns the daemon status carrying the token the QR code renders.
   */
  async loginQr(): Promise<TelegramDaemonStatus> {
    return statusSchema.parse(await this.request('POST', '/login/qr'))
  }

  /**
   * Submit the code Telegram sent.
   * @param code - digits from the Telegram message.
   * @returns the daemon status after Telegram checked the code.
   */
  async loginCode(code: string): Promise<TelegramDaemonStatus> {
    return statusSchema.parse(await this.request('POST', '/login/code', { code }))
  }

  /**
   * Submit the account's 2FA password.
   * @param password - the account password, never logged or shown.
   * @returns the daemon status after Telegram checked the password.
   */
  async loginPassword(password: string): Promise<TelegramDaemonStatus> {
    return statusSchema.parse(await this.request('POST', '/login/password', { password }))
  }

  /** Terminate this account's Telegram session and clear its stored session string. */
  async logout(): Promise<void> {
    await this.request('POST', '/logout')
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

}
