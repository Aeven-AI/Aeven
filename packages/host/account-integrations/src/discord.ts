/**
 * Discord connector settings the Host owns: the connector process entry, the permission
 * bitfields the install link requests, and the guild details Settings shows.
 *
 * The Aeven Discord application's credentials — client secret and bot token — live on the
 * Aeven API. The install consent, the bot's membership checks, and every Discord REST call
 * go through its connector broker and proxy, which act as the bot only inside guilds the
 * calling user installed it into.
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/**
 * Resolve the connector server entry of the vendored Discord package installed for this host.
 * @param override - explicit entry path from deployment configuration.
 * @returns absolute entry path, or undefined when this host has no vendored package.
 */
export function resolveDiscordEntry(override: string | undefined): string | undefined {
  if (override !== undefined) return override
  try {
    const manifest = createRequire(import.meta.url).resolve('@aeven/discord-mcp/package.json')
    return join(dirname(manifest), 'dist', 'main.js')
  } catch {
    // An absent package means Discord is unsupported on this host; Settings reports it as not configured.
    return undefined
  }
}

/**
 * Permission bitfield of the curated surface: read the server, post and reply,
 * react, upload files, and open threads. Computed from Discord's documented
 * `PermissionFlagsBits` values and kept as a decimal string because the
 * bitfield exceeds the exact integer range of a JSON number.
 */
export const DISCORD_CURATED_PERMISSIONS = '377957239872'

/**
 * Bitfield for a deployment that also serves the administration tools: the
 * curated surface plus kick, ban, timeout, channel and thread management, role
 * management, message management, audit-log reading, and server settings.
 */
export const DISCORD_ADMIN_PERMISSIONS = '1494917180662'

/** The guild an install authorized. */
export interface DiscordGuild {
  id: string
  name: string
  /** Icon hash Discord reports; absent when the guild has no icon. */
  icon?: string
}

/**
 * Icon URL Settings renders for one guild.
 * @param guild - guild whose icon is read.
 * @returns the CDN URL of the guild's icon, or undefined when it has none.
 */
export function discordGuildIcon(guild: DiscordGuild): string | undefined {
  if (guild.icon === undefined || guild.icon === '') return undefined
  const format = guild.icon.startsWith('a_') ? 'gif' : 'png'
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${format}?size=64`
}
