/** Bundled `whatsapp-mcp` daemon processes: binary resolution, launch, pairing status, and teardown. */

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { delimiter, dirname, join } from 'node:path'
import { z } from 'zod'
import { AccountDaemon, type AccountDaemonOptions } from './account-daemon.ts'
import type { WhatsAppPhoneCodeView } from './types.ts'

/**
 * Resolve the daemon from the platform package installed for this host.
 * @param override - explicit binary path from deployment configuration.
 * @returns absolute executable path, or undefined when this host has no platform package or its binary is unbuilt.
 */
export function resolveWhatsAppBinary(override: string | undefined): string | undefined {
  if (override !== undefined) return override
  try {
    const manifest = createRequire(import.meta.url).resolve(`@aeven/whatsapp-mcp-${process.platform}-${process.arch}/package.json`)
    const binary = join(dirname(manifest), 'bin', process.platform === 'win32' ? 'whatsapp-mcp.exe' : 'whatsapp-mcp')
    // A workspace checkout links the platform package before its git-ignored binary is built; without the file
    // every start would fail, so the host reports WhatsApp as not configured instead.
    return existsSync(binary) ? binary : undefined
  } catch {
    // An absent optional platform package means WhatsApp is unsupported on this host; Settings reports it as not configured.
    return undefined
  }
}

/**
 * Resolve the bundled ffmpeg executable from the platform package installed for this host, else an ffmpeg on PATH.
 * @returns absolute executable path, or undefined when neither exists.
 */
export function resolveFfmpegBinary(): string | undefined {
  try {
    const manifest = createRequire(import.meta.url).resolve(`@aeven/ffmpeg-${process.platform}-${process.arch}/package.json`)
    const binary = join(dirname(manifest), 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    if (existsSync(binary)) return binary
  } catch {
    // No platform package for this host: the system's own ffmpeg, if any, is used below.
  }
  // A host without the bundled build (a server checkout that never built it) converts with an ffmpeg on PATH;
  // with neither, voice notes fail with the converter's own diagnostic.
  return pathExecutable(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
}

/**
 * Find an executable on PATH.
 * @param name - file name to look for.
 * @returns its absolute path, or undefined when no PATH directory holds it.
 */
function pathExecutable(name: string): string | undefined {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Daemon `/status` response; `qr_png` is a base64 PNG present only in the `qr` state, and `phone_code` the phone code
 * currently valid there once one was issued, which WhatsApp can replace mid-pairing.
 */
const statusSchema = z.object({
  state: z.enum(['starting', 'qr', 'paired', 'expired', 'failed']),
  qr_png: z.string().optional(), phone_code: z.string().optional(), phone: z.string().optional(), name: z.string().optional(),
})

/** Daemon `/pair/phone` response. */
const phoneCodeSchema = z.object({ code: z.string().min(1) })

/** Pairing state of one daemon. */
export type WhatsAppDaemonStatus = z.infer<typeof statusSchema>

/** Process and network budgets for one daemon; all fields come from validated deployment configuration. */
export interface WhatsAppDaemonOptions extends AccountDaemonOptions {
  /** Log every linking-handshake message the daemon sends and receives; names the account's number, so diagnosis only. */
  pairingTrace: boolean
}

/**
 * One `whatsapp-mcp serve` process bound to a loopback port chosen by the operating system.
 * The parent holds the child's stdin open; the daemon exits when it closes, so a crashed Host leaves no process holding the store lock.
 */
export class WhatsAppDaemon extends AccountDaemon {
  /**
   * @param binary - daemon executable.
   * @param directory - Aeven-owned data directory holding `store/` and `media/`.
   * @param options - process and request budgets.
   * @param ffmpeg - bundled converter the daemon finds on PATH for voice notes; omitted when this host has none.
   */
  constructor(private readonly binary: string, directory: string, options: WhatsAppDaemonOptions,
    private readonly ffmpeg?: string) {
    super('WhatsApp', directory, options)
    this.pairingTrace = options.pairingTrace
  }

  private readonly pairingTrace: boolean

  /** Spawn the daemon and wait for its bound loopback address. */
  async start(): Promise<void> {
    const store = join(this.directory, 'store')
    const media = join(this.directory, 'media')
    await mkdir(store, { recursive: true, mode: 0o700 })
    await mkdir(media, { recursive: true, mode: 0o700 })
    await this.launch(this.binary, ['-store', store, 'serve', '-addr', '127.0.0.1:0', '-exit-on-stdin-eof'], {
      WHATSAPP_MCP_TOKEN: this.token, WHATSAPP_MCP_MEDIA_ROOT: media,
      ...this.pairingTrace ? { WHATSAPP_MCP_PAIRING_TRACE: '1' } : {},
    }, this.ffmpeg === undefined ? [] : [dirname(this.ffmpeg)])
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

  /**
   * Ask WhatsApp for a phone-number linking code for the pairing in progress.
   * @param phone - the number being linked, in international form.
   * @returns the code, or why none was issued.
   * @throws when WhatsApp or the daemon refused for another reason, carrying the daemon's diagnostic.
   */
  async pairPhone(phone: string): Promise<WhatsAppPhoneCodeView> {
    const response = await fetch(`http://${this.requireAddress()}/pair/phone`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
      signal: AbortSignal.timeout(this.options.requestTimeoutMs),
    })
    if (response.status === 400) return { state: 'invalid-phone' }
    if (response.status === 409) return { state: 'expired' }
    if (response.status === 429) return { state: 'rate-limited' }
    if (!response.ok) throw new Error(`WhatsApp issued no linking code (HTTP ${String(response.status)}): ${(await response.text()).slice(0, 300).trim()}`)
    return { state: 'code', code: phoneCodeSchema.parse(await response.json()).code }
  }

  /** Remove this linked device from the WhatsApp account and clear its local session. */
  async logout(): Promise<void> {
    const response = await fetch(`http://${this.requireAddress()}/logout`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(this.options.requestTimeoutMs),
    })
    if (!response.ok) throw new Error(`WhatsApp logout failed with HTTP ${String(response.status)}`)
  }

}
