/**
 * The moderation tool surface: the 8 tools that act on one member, one channel's recent
 * messages, one invite, or the server's audit log. Registered beside the administration
 * tools of `aeven/admin.ts`, and only when the deployment sets `DISCORD_ADMIN_TOOLS=1`.
 *
 * Every tool here names the guild from the environment, records the caller's `reason` as
 * Discord's audit-log entry, and reports Discord's refusals as fixed sentences.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { BAN_DELETE_SECONDS_MAX, reasonArgument, reasonHeaders } from './admin.ts'
import { countOf, renderAuditLog, renderInvites, renderMember, toolText } from './format.ts'
import type { DiscordContext } from './lookups.ts'
import type { DiscordAuditLogEntry, DiscordInvite, DiscordMember, DiscordMessage } from './refs.ts'
import { DiscordError } from './rest.ts'
import { ChannelId, UserId } from './vendor/snowflake.ts'

/** Names of the moderation tool surface, in registration order. */
export const MODERATION_TOOL_NAMES: readonly string[] = [
  'kick_member',
  'bulk_ban_members',
  'get_member',
  'edit_member',
  'purge_messages',
  'list_invites',
  'revoke_invite',
  'read_audit_log',
]

/** Most accounts one `bulk_ban_members` call bans. */
const BULK_BAN_MAX = 200
/** Most messages one `purge_messages` call examines. */
const PURGE_COUNT_MAX = 100
/** Most audit-log entries one `read_audit_log` call returns. */
const AUDIT_LOG_LIMIT_MAX = 100
/** Number of audit-log entries a call returns when it names none. */
const AUDIT_LOG_LIMIT_DEFAULT = 25

/** Invite codes Discord accepts: letters, digits, and hyphens. */
const InviteCodeArgument = z
  .string()
  .min(1, 'code must not be empty')
  .max(100, 'code must not exceed 100 characters')
  .regex(/^[A-Za-z0-9-]+$/u, 'code must hold only letters, digits, and hyphens')

/** The fields of Discord's bulk-ban answer this package reads. */
interface BulkBanAnswer {
  /** Ids Discord banned. */
  banned_users?: string[]
  /** Ids Discord refused. */
  failed_users?: string[]
}

/** The fields of Discord's audit-log answer this package reads. */
interface AuditLogAnswer {
  /** The entries, newest first. */
  audit_log_entries?: DiscordAuditLogEntry[]
}

/**
 * Register the moderation tools on a server.
 * @param server - the server the connector mounts.
 * @param ctx - the REST client, the fixed guild, and the shared lookups.
 */
export function registerModerationTools(server: McpServer, ctx: DiscordContext): void {
  server.registerTool('kick_member', {
    description:
      'Remove a member from the connected server. The account may rejoin with a new invite unless it is banned. ' +
      'Requires the Kick Members permission and a role position above the member\'s highest role; the server owner ' +
      'cannot be removed.',
    inputSchema: {
      user_id: UserId.describe('Id of the member to remove.'),
      reason: reasonArgument('this kick'),
    },
  }, async ({ user_id, reason }) => {
    await ctx.rest.request('DELETE', `/guilds/${ctx.guildId}/members/${user_id}`, { headers: reasonHeaders(reason) })
    return toolText(`account ${user_id} removed from guild ${ctx.guildId}; it may rejoin unless banned`)
  })

  server.registerTool('bulk_ban_members', {
    description:
      'Ban up to 200 accounts from the connected server in one call, optionally deleting their recent messages. ' +
      'Requires the Ban Members permission and a role position above every account\'s highest role; the server owner ' +
      'cannot be banned. Reports Discord\'s failures by account id.',
    inputSchema: {
      user_ids: z.array(UserId).min(1).max(BULK_BAN_MAX).describe(`Ids of the accounts to ban, 1 to ${String(BULK_BAN_MAX)}.`),
      delete_message_seconds: z
        .number()
        .int()
        .min(0)
        .max(BAN_DELETE_SECONDS_MAX)
        .optional()
        .describe('Delete these accounts\' messages from the last N seconds, 0 to 604800. Omit to delete none.'),
      reason: reasonArgument('this bulk ban'),
    },
  }, async ({ user_ids, delete_message_seconds, reason }) => {
    const body: Record<string, unknown> = { user_ids }
    if (delete_message_seconds !== undefined) body['delete_message_seconds'] = delete_message_seconds
    const answer = await ctx.rest.request<BulkBanAnswer>('POST', `/guilds/${ctx.guildId}/bulk-ban`, {
      body,
      headers: reasonHeaders(reason),
    })
    const banned = answer?.banned_users ?? []
    const failed = answer?.failed_users ?? []
    const lines = [`bulk ban submitted for ${countOf(user_ids.length, 'account')} in guild ${ctx.guildId}`]
    lines.push(`banned by Discord: ${String(banned.length)}`)
    if (failed.length > 0) lines.push(`failed: ${failed.join(', ')}`)
    return toolText(lines.join('\n'))
  })

  server.registerTool('get_member', {
    description:
      'Read one member of the connected server: display name, nickname, join date, role ids, whether the account is ' +
      'currently timed out and until when, and whether it is muted or deafened in voice. Requires the Server Members ' +
      'privileged intent and the View Channels permission.',
    inputSchema: {
      user_id: UserId.describe('Id of the member to read.'),
    },
  }, async ({ user_id }) => {
    const member = await ctx.rest.request<DiscordMember>('GET', `/guilds/${ctx.guildId}/members/${user_id}`)
    const guildName = await ctx.lookups.guildName()
    return toolText(`member ${user_id} in guild ${ctx.guildId}\n${renderMember(member, guildName)}`)
  })

  server.registerTool('edit_member', {
    description:
      'Change a member of the connected server: their nickname, voice mute, voice deafen, or the voice channel they ' +
      'sit in. Give at least one field. Requires the Moderate Members permission, and Move Members for a channel move, ' +
      'with a role position above the member\'s highest role; the server owner cannot be changed.',
    inputSchema: {
      user_id: UserId.describe('Id of the member to change.'),
      nickname: z
        .string()
        .max(32, 'nickname must not exceed 32 characters')
        .optional()
        .describe('New nickname, up to 32 characters; an empty string clears the nickname.'),
      mute: z.boolean().optional().describe('Whether Discord server-mutes the member in voice channels.'),
      deaf: z.boolean().optional().describe('Whether Discord server-deafens the member in voice channels.'),
      channel_id: ChannelId.optional().describe('Voice channel to move the member into.'),
      disconnect: z.boolean().optional().describe('With `channel_id`, whether Discord disconnects the member from voice.'),
      reason: reasonArgument('this member change'),
    },
  }, async ({ user_id, nickname, mute, deaf, channel_id, disconnect, reason }) => {
    const body: Record<string, unknown> = {}
    if (nickname !== undefined) body['nick'] = nickname
    if (mute !== undefined) body['mute'] = mute
    if (deaf !== undefined) body['deaf'] = deaf
    if (channel_id !== undefined) body['channel_id'] = channel_id
    if (disconnect !== undefined) body['disconnect'] = disconnect
    if (Object.keys(body).length === 0) {
      throw new Error('edit_member needs at least one of nickname, mute, deaf, channel_id, or disconnect.')
    }
    await ctx.rest.request('PATCH', `/guilds/${ctx.guildId}/members/${user_id}`, { body, headers: reasonHeaders(reason) })
    return toolText(`member ${user_id} changed in guild ${ctx.guildId}: ${Object.keys(body).join(', ')}`)
  })

  server.registerTool('purge_messages', {
    description:
      'Delete recent messages in one channel as the bot, one at a time, so messages older than Discord\'s two-week ' +
      'bulk-delete window go too. Reads the newest `count` messages, deletes only the ones `user_id` selected when it ' +
      'is given, and reports how many were deleted, already gone, and refused. Requires the Manage Messages permission.',
    inputSchema: {
      channel_id: ChannelId.describe('Id of the channel holding the messages.'),
      count: z.number().int().min(1).max(PURGE_COUNT_MAX).describe('How many recent messages to examine, 1 to 100.'),
      user_id: UserId.optional().describe('Delete only messages this author wrote. Omit to delete every selected message.'),
      reason: reasonArgument('these deletions'),
    },
  }, async ({ channel_id, count, user_id, reason }) => {
    const messages = await ctx.rest.request<DiscordMessage[]>(
      'GET',
      `/channels/${channel_id}/messages?limit=${String(count)}`,
    )
    const selected = messages.filter((message) => user_id === undefined || message.author?.id === user_id)
    let deleted = 0
    let gone = 0
    let refused = 0
    for (const message of selected) {
      try {
        await ctx.rest.request('DELETE', `/channels/${channel_id}/messages/${message.id}`, {
          headers: reasonHeaders(reason),
        })
        deleted += 1
      } catch (error) {
        if (error instanceof DiscordError && error.status === 404) {
          gone += 1
          continue
        }
        if (error instanceof DiscordError && error.status === 403) {
          refused += 1
          continue
        }
        throw error
      }
    }
    return toolText(
      `channel ${channel_id} — examined ${countOf(messages.length, 'message')}, ` +
      `selected ${countOf(selected.length, 'message')}\n` +
      `deleted ${String(deleted)} — already gone ${String(gone)} — refused ${String(refused)}`,
    )
  })

  server.registerTool('list_invites', {
    description:
      'List the connected server\'s active invites: code, channel, creator, uses, maximum uses, expiry, and whether ' +
      'the invite is temporary. Requires the Manage Server permission.',
    inputSchema: {},
  }, async () => {
    const invites = await ctx.rest.request<DiscordInvite[]>('GET', `/guilds/${ctx.guildId}/invites`)
    const guildName = await ctx.lookups.guildName()
    return toolText(`guild ${ctx.guildId} — ${countOf(invites.length, 'invite')}\n${renderInvites(invites, guildName)}`)
  })

  server.registerTool('revoke_invite', {
    description:
      'Revoke one invite of the connected server so its code stops admitting anyone. Requires the Manage Server ' +
      'permission, or the Manage Channels permission in the invite\'s channel.',
    inputSchema: {
      code: InviteCodeArgument.describe('Code of the invite to revoke, 1 to 100 characters of letters, digits, and hyphens.'),
      reason: reasonArgument('this invite revocation'),
    },
  }, async ({ code, reason }) => {
    await ctx.rest.request('DELETE', `/invites/${code}`, { headers: reasonHeaders(reason) })
    return toolText(`invite ${code} revoked`)
  })

  server.registerTool('read_audit_log', {
    description:
      'Read the connected server\'s newest audit-log entries: the action, the actor\'s id, the target\'s id, when the ' +
      'action happened, and the reason Discord recorded, newest first. Requires the View Audit Log permission.',
    inputSchema: {
      limit: z
        .number()
        .int()
        .min(1)
        .max(AUDIT_LOG_LIMIT_MAX)
        .default(AUDIT_LOG_LIMIT_DEFAULT)
        .describe(`How many entries to return, 1 to ${String(AUDIT_LOG_LIMIT_MAX)}, newest first.`),
      action_type: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe('Return only entries of this Discord audit action type, for example 20 for a member kick.'),
      user_id: UserId.optional().describe('Return only entries this account performed.'),
    },
  }, async ({ limit, action_type, user_id }) => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (action_type !== undefined) params.set('action_type', String(action_type))
    if (user_id !== undefined) params.set('user_id', user_id)
    const answer = await ctx.rest.request<AuditLogAnswer>(
      'GET',
      `/guilds/${ctx.guildId}/audit-logs?${params.toString()}`,
    )
    const entries = answer?.audit_log_entries ?? []
    const guildName = await ctx.lookups.guildName()
    return toolText(
      `guild ${ctx.guildId} — ${countOf(entries.length, 'audit-log entry', 'audit-log entries')}\n` +
      `${renderAuditLog(entries, guildName)}`,
    )
  })
}
