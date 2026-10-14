/** Bundled `whatsapp-mcp` daemon processes: binary resolution, launch, pairing status, and teardown. */

import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { AccountDaemon, type AccountDaemonOptions } from './account-daemon.ts'

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

/** Daemon `/status` response; `qr_png` is a base64 PNG present only in the `qr` state. */
const statusSchema = z.object({
  state: z.enum(['starting', 'qr', 'paired', 'expired', 'failed']),
  qr_png: z.string().optional(), phone: z.string().optional(), name: z.string().optional(),
})

/** Pairing state of one daemon. */
export type WhatsAppDaemonStatus = z.infer<typeof statusSchema>

/** Process and network budgets for one daemon; all fields come from validated deployment configuration. */
export interface WhatsAppDaemonOptions extends AccountDaemonOptions {}

/**
 * One `whatsapp-mcp serve` process bound to a loopback port chosen by the operating system.
 * The parent holds the child's stdin open; the daemon exits when it closes, so a crashed Host leaves no process holding the store lock.
 */
export class WhatsAppDaemon extends AccountDaemon {
  /**
   * @param binary - daemon executable.
   * @param directory - Aeven-owned data directory holding `store/` and `media/`.
   * @param options - process and request budgets.
   */
  constructor(private readonly binary: string, directory: string, options: WhatsAppDaemonOptions) {
    super('WhatsApp', directory, options)
  }

  /** Spawn the daemon and wait for its bound loopback address. */
  async start(): Promise<void> {
    const store = join(this.directory, 'store')
    const media = join(this.directory, 'media')
    await mkdir(store, { recursive: true, mode: 0o700 })
    await mkdir(media, { recursive: true, mode: 0o700 })
    await this.launch(this.binary, ['-store', store, 'serve', '-addr', '127.0.0.1:0', '-exit-on-stdin-eof'], {
      WHATSAPP_MCP_TOKEN: this.token, WHATSAPP_MCP_MEDIA_ROOT: media,
    })
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

}
