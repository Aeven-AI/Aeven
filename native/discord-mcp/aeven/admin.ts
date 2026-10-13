/**
 * The administration tool surface: 22 tools registered only when the deployment
 * sets `DISCORD_ADMIN_TOOLS=1`, never by default.
 *
 * Every tool here names the guild from the environment, reads its fields through
 * the same REST client and the same lookups as the curated surface, and records
 * the caller's `reason` as Discord's audit-log entry.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  countOf,
  renderAutoModRules,
  renderBan,
  renderBans,
  renderRoles,
  toolText,
} from './format.ts'
import type { DiscordContext } from './lookups.ts'
import { channelTypeOf, type DiscordAutoModRule, type DiscordBan, type DiscordChannel, type DiscordRole } from './refs.ts'
import { DiscordError } from './rest.ts'
import { PermissionString } from './vendor/permissions.ts'
import { ChannelId, MessageId, RoleId, Snowflake, UserId } from './vendor/snowflake.ts'

/** Names of the administration tool surface, in registration order. */
export const DISCORD_ADMIN_TOOL_NAMES: readonly string[] = [
  'list_roles',
  'create_role',
  'edit_role',
  'delete_role',
  'assign_role',
  'remove_role',
  'list_bans',
  'get_ban',
  'ban_member',
  'unban_member',
  'timeout_member',
  'clear_timeout',
  'delete_messages',
  'create_channel',
  'delete_channel',
  'edit_channel',
  'set_channel_permissions',
  'list_automod_rules',
  'create_automod_rule',
  'edit_automod_rule',
  'delete_automod_rule',
  'edit_guild',
]

/** Longest timeout Discord accepts, in minutes: 28 days. */
const TIMEOUT_MINUTES_MAX = 40_320
/** Longest ban message-deletion window Discord accepts, in seconds: 7 days. */
export const BAN_DELETE_SECONDS_MAX = 604_800
/** Most messages one `delete_messages` call removes. */
const DELETE_MESSAGES_MAX = 100
/** Largest role colour Discord accepts: 0xFFFFFF. */
const ROLE_COLOR_MAX = 16_777_215
/** Discord's AutoMod rule event types, 1 through 7. */
const AUTOMOD_EVENT_TYPES_MAX = 7
/** Discord's AutoMod rule trigger types, 1 through 6. */
const AUTOMOD_TRIGGER_TYPES_MAX = 6
/** Discord's permission-overwrite target types. */
const OVERWRITE_TYPES = { role: 0, member: 1 } as const
/** An id that is neither a channel, a role, nor a user: an overwrite target or an AutoMod rule. */
const OtherId = Snowflake.describe('Discord id (17-20 digit snowflake).')

/**
 * The audit-log headers of a call.
 * @param reason - the reason to record, when the caller gave one.
 * @returns the extra request headers, empty when no reason was given.
 */
export function reasonHeaders(reason: string | undefined): Record<string, string> {
  return reason === undefined ? {} : { 'X-Audit-Log-Reason': encodeURIComponent(reason) }
}

/**
 * The shared `reason` argument of the administration tools.
 * @param what - what the recorded reason will describe, for the parameter description.
 * @returns the optional reason schema.
 */
export function reasonArgument(what: string): z.ZodOptional<z.ZodString> {
  return z.string().max(512, 'reason must not exceed 512 characters').optional().describe(`Audit-log reason recorded with ${what}.`)
}

/**
 * Register the administration tools on a server.
 * @param server - the server the connector mounts.
 * @param ctx - the REST client, the fixed guild, and the shared lookups.
 */
export function registerAdminTools(server: McpServer, ctx: DiscordContext): void {
  server.registerTool('list_roles', {
    description:
      'List the connected server\'s roles with their ids, names, and positions. Requires the Manage Roles permission.',
    inputSchema: {},
  }, async () => {
    const roles: DiscordRole[] = await ctx.lookups.roles()
    const guildName = await ctx.lookups.guildName()
    return toolText(`guild ${ctx.guildId} — ${countOf(roles.length, 'role')}\n${renderRoles(roles, guildName)}`)
  })

  server.registerTool('create_role', {
    description:
      'Create a role in the connected server and return its id. Requires the Manage Roles permission, and the ' +
      'caller\'s highest role must sit above the role it creates.',
    inputSchema: {
      name: z.string().min(1, 'name must not be empty').max(100, 'name must not exceed 100 characters').describe('Role name.'),
      permissions: PermissionString.optional().describe('Permission bitfield of the new role, as a base-10 string.'),
      reason: reasonArgument('this role creation'),
    },
  }, async ({ name, permissions, reason }) => {
    const body: Record<string, unknown> = { name }
    if (permissions !== undefined) body['permissions'] = permissions
    const role = await ctx.rest.request<DiscordRole>('POST', `/guilds/${ctx.guildId}/roles`, {
      body,
      headers: reasonHeaders(reason),
    })
    return toolText(`role ${role.id} named "${name}" created in guild ${ctx.guildId}`)
  })

  server.registerTool('edit_role', {
    description:
      'Change a role\'s name, colour, hoist flag, mentionable flag, or permission bits. Give at least one field. ' +
      'Requires the Manage Roles permission and a role position above the one changed.',
    inputSchema: {
      role_id: RoleId.describe('Id of the role to change.'),
      name: z
        .string()
        .min(1, 'name must not be empty')
        .max(100, 'name must not exceed 100 characters')
        .optional()
        .describe('New role name.'),
      color: z
        .number()
        .int()
        .min(0)
        .max(ROLE_COLOR_MAX)
        .optional()
        .describe('New role colour as an RGB integer, 0 to 16777215.'),
      hoist: z.boolean().optional().describe('Whether Discord shows the role in its own section of the member list.'),
      mentionable: z.boolean().optional().describe('Whether members may mention the role.'),
      permissions: PermissionString.optional().describe('New permission bitfield, as a base-10 string.'),
      reason: reasonArgument('this role change'),
    },
  }, async ({ role_id, name, color, hoist, mentionable, permissions, reason }) => {
    const body: Record<string, unknown> = {}
    if (name !== undefined) body['name'] = name
    if (color !== undefined) body['color'] = color
    if (hoist !== undefined) body['hoist'] = hoist
    if (mentionable !== undefined) body['mentionable'] = mentionable
    if (permissions !== undefined) body['permissions'] = permissions
    if (Object.keys(body).length === 0) {
      throw new Error('edit_role needs at least one of name, color, hoist, mentionable, or permissions.')
    }
    await ctx.rest.request('PATCH', `/guilds/${ctx.guildId}/roles/${role_id}`, { body, headers: reasonHeaders(reason) })
    return toolText(`role ${role_id} changed in guild ${ctx.guildId}: ${Object.keys(body).join(', ')}`)
  })

  server.registerTool('delete_role', {
    description:
      'Delete a role from the connected server. Members holding it lose it and its permissions. Requires the Manage ' +
      'Roles permission and a role position above the one deleted.',
    inputSchema: {
      role_id: RoleId.describe('Id of the role to delete.'),
      reason: reasonArgument('this role deletion'),
    },
  }, async ({ role_id, reason }) => {
    await ctx.rest.request('DELETE', `/guilds/${ctx.guildId}/roles/${role_id}`, { headers: reasonHeaders(reason) })
    return toolText(`role ${role_id} deleted from guild ${ctx.guildId}`)
  })

  server.registerTool('assign_role', {
    description:
      'Give a role to a member of the connected server. Requires the Manage Roles permission and a role position ' +
      'above the one assigned.',
    inputSchema: {
      user_id: UserId.describe('Id of the member receiving the role.'),
      role_id: RoleId.describe('Id of the role to give.'),
      reason: reasonArgument('this role assignment'),
    },
  }, async ({ user_id, role_id, reason }) => {
    await ctx.rest.request('PUT', `/guilds/${ctx.guildId}/members/${user_id}/roles/${role_id}`, {
      headers: reasonHeaders(reason),
    })
    return toolText(`role ${role_id} given to member ${user_id} in guild ${ctx.guildId}`)
  })

  server.registerTool('remove_role', {
    description:
      'Take a role away from a member of the connected server. Requires the Manage Roles permission and a role ' +
      'position above the one removed.',
    inputSchema: {
      user_id: UserId.describe('Id of the member losing the role.'),
      role_id: RoleId.describe('Id of the role to take away.'),
      reason: reasonArgument('this role removal'),
    },
  }, async ({ user_id, role_id, reason }) => {
    await ctx.rest.request('DELETE', `/guilds/${ctx.guildId}/members/${user_id}/roles/${role_id}`, {
      headers: reasonHeaders(reason),
    })
    return toolText(`role ${role_id} taken from member ${user_id} in guild ${ctx.guildId}`)
  })

  server.registerTool('list_bans', {
    description:
      'List the connected server\'s bans with each banned account\'s name and the recorded reason. Requires the Ban ' +
      'Members permission.',
    inputSchema: {
      limit: z.number().int().min(1).max(1000).default(100).describe('How many bans to return.'),
    },
  }, async ({ limit }) => {
    const bans = await ctx.rest.request<DiscordBan[]>('GET', `/guilds/${ctx.guildId}/bans?limit=${String(limit)}`)
    const guildName = await ctx.lookups.guildName()
    return toolText(`guild ${ctx.guildId} — ${countOf(bans.length, 'ban')}\n${renderBans(bans, guildName)}`)
  })

  server.registerTool('get_ban', {
    description:
      'Read the connected server\'s ban of one account: the banned user\'s id and name, and the reason Discord holds ' +
      'with the ban. Reports that the account is not banned instead of an error when no ban exists. Requires the Ban ' +
      'Members permission.',
    inputSchema: {
      user_id: UserId.describe('Id of the account whose ban to read.'),
    },
  }, async ({ user_id }) => {
    let ban: DiscordBan
    try {
      ban = await ctx.rest.request<DiscordBan>('GET', `/guilds/${ctx.guildId}/bans/${user_id}`)
    } catch (error) {
      if (error instanceof DiscordError && error.status === 404) {
        return toolText(`account ${user_id} is not banned from guild ${ctx.guildId}`)
      }
      throw error
    }
    const guildName = await ctx.lookups.guildName()
    return toolText(`guild ${ctx.guildId} — ban of account ${user_id}\n${renderBan(ban, guildName)}`)
  })

  server.registerTool('ban_member', {
    description:
      'Ban an account from the connected server, optionally deleting its recent messages. Requires the Ban Members ' +
      'permission and a role position above the account\'s highest role.',
    inputSchema: {
      user_id: UserId.describe('Id of the account to ban.'),
      delete_message_seconds: z
        .number()
        .int()
        .min(0)
        .max(BAN_DELETE_SECONDS_MAX)
        .optional()
        .describe('Delete this account\'s messages from the last N seconds, 0 to 604800. Omit to delete none.'),
      reason: reasonArgument('this ban'),
    },
  }, async ({ user_id, delete_message_seconds, reason }) => {
    const body = delete_message_seconds === undefined ? {} : { delete_message_seconds }
    await ctx.rest.request('PUT', `/guilds/${ctx.guildId}/bans/${user_id}`, { body, headers: reasonHeaders(reason) })
    return toolText(`account ${user_id} banned from guild ${ctx.guildId}`)
  })

  server.registerTool('unban_member', {
    description: 'Lift a ban so the account may join the connected server again. Requires the Ban Members permission.',
    inputSchema: {
      user_id: UserId.describe('Id of the banned account.'),
      reason: reasonArgument('this unban'),
    },
  }, async ({ user_id, reason }) => {
    await ctx.rest.request('DELETE', `/guilds/${ctx.guildId}/bans/${user_id}`, { headers: reasonHeaders(reason) })
    return toolText(`account ${user_id} unbanned from guild ${ctx.guildId}`)
  })

  server.registerTool('timeout_member', {
    description:
      'Silence a member of the connected server for a number of minutes: they keep reading but cannot post, react, ' +
      'or join voice. Requires the Moderate Members permission and a role position above the member\'s highest role.',
    inputSchema: {
      user_id: UserId.describe('Id of the member to silence.'),
      minutes: z.number().int().min(1).max(TIMEOUT_MINUTES_MAX).describe('How many minutes the timeout lasts, 1 to 40320 (28 days).'),
      reason: reasonArgument('this timeout'),
    },
  }, async ({ user_id, minutes, reason }) => {
    const until = new Date(Date.now() + minutes * 60_000).toISOString()
    await ctx.rest.request('PATCH', `/guilds/${ctx.guildId}/members/${user_id}`, {
      body: { communication_disabled_until: until },
      headers: reasonHeaders(reason),
    })
    return toolText(`member ${user_id} timed out in guild ${ctx.guildId} until ${until}`)
  })

  server.registerTool('clear_timeout', {
    description:
      'Lift a member\'s timeout early so they can post again. Requires the Moderate Members permission and a role ' +
      'position above the member\'s highest role.',
    inputSchema: {
      user_id: UserId.describe('Id of the timed-out member.'),
      reason: reasonArgument('this timeout removal'),
    },
  }, async ({ user_id, reason }) => {
    await ctx.rest.request('PATCH', `/guilds/${ctx.guildId}/members/${user_id}`, {
      body: { communication_disabled_until: null },
      headers: reasonHeaders(reason),
    })
    return toolText(`timeout lifted from member ${user_id} in guild ${ctx.guildId}`)
  })

  server.registerTool('delete_messages', {
    description:
      'Delete messages in one channel as the bot, one by one, so messages older than Discord\'s two-week bulk-delete ' +
      'window go too. Report which ids were removed, which were already gone, and which Discord refused. Requires the ' +
      'Manage Messages permission.',
    inputSchema: {
      channel_id: ChannelId.describe('Id of the channel holding the messages.'),
      message_ids: z
        .array(MessageId)
        .min(1)
        .max(DELETE_MESSAGES_MAX)
        .describe(`Ids of the messages to delete, up to ${String(DELETE_MESSAGES_MAX)}.`),
      reason: reasonArgument('these deletions'),
    },
  }, async ({ channel_id, message_ids, reason }) => {
    const removed: string[] = []
    const gone: string[] = []
    const refused: string[] = []
    for (const id of message_ids) {
      try {
        await ctx.rest.request('DELETE', `/channels/${channel_id}/messages/${id}`, { headers: reasonHeaders(reason) })
        removed.push(id)
      } catch (error) {
        if (error instanceof DiscordError && error.status === 404) {
          gone.push(id)
          continue
        }
        if (error instanceof DiscordError && error.status === 403) {
          refused.push(id)
          continue
        }
        throw error
      }
    }
    const lines = [`channel ${channel_id} — deleted ${countOf(removed.length, 'message')}`]
    if (gone.length > 0) lines.push(`already gone: ${gone.join(', ')}`)
    if (refused.length > 0) lines.push(`refused: ${refused.join(', ')}`)
    return toolText(lines.join('\n'))
  })

  server.registerTool('create_channel', {
    description:
      'Create a channel in the connected server and return its id. Requires the Manage Channels permission.',
    inputSchema: {
      name: z.string().min(1, 'name must not be empty').max(100, 'name must not exceed 100 characters').describe('Channel name.'),
      type: z
        .enum(['text', 'voice', 'category', 'forum', 'announcement', 'stage'])
        .optional()
        .describe('Channel type. Omit for a text channel.'),
      parent_id: ChannelId.optional().describe('Category to place the new channel in.'),
      topic: z
        .string()
        .max(1024, 'topic must not exceed 1024 characters')
        .optional()
        .describe('Channel topic, for text and forum channels.'),
      reason: reasonArgument('this channel creation'),
    },
  }, async ({ name, type, parent_id, topic, reason }) => {
    const body: Record<string, unknown> = { name }
    if (type !== undefined) body['type'] = channelTypeOf(type)
    if (parent_id !== undefined) body['parent_id'] = parent_id
    if (topic !== undefined) body['topic'] = topic
    const channel = await ctx.rest.request<DiscordChannel>('POST', `/guilds/${ctx.guildId}/channels`, {
      body,
      headers: reasonHeaders(reason),
    })
    return toolText(`channel ${channel.id} named "${name}" created in guild ${ctx.guildId}`)
  })

  server.registerTool('delete_channel', {
    description:
      'Delete a channel or thread from the connected server, along with its messages. Requires the Manage Channels ' +
      'permission.',
    inputSchema: {
      channel_id: ChannelId.describe('Id of the channel or thread to delete.'),
      reason: reasonArgument('this channel deletion'),
    },
  }, async ({ channel_id, reason }) => {
    await ctx.rest.request('DELETE', `/channels/${channel_id}`, { headers: reasonHeaders(reason) })
    return toolText(`channel ${channel_id} deleted`)
  })

  server.registerTool('edit_channel', {
    description:
      'Change a channel\'s name, topic, slowmode, position in its category, or parent category. Give at least one ' +
      'field. Requires the Manage Channels permission.',
    inputSchema: {
      channel_id: ChannelId.describe('Id of the channel to change.'),
      name: z.string().min(1).max(100).optional().describe('New channel name.'),
      topic: z.string().max(1024).optional().describe('New channel topic.'),
      slowmode: z.number().int().min(0).max(21_600).optional().describe('Seconds each member must wait between posts, 0 to 21600.'),
      position: z.number().int().min(0).optional().describe('New sort position among the sibling channels.'),
      parent: ChannelId.optional().describe('Category to move the channel into.'),
      reason: reasonArgument('this channel change'),
    },
  }, async ({ channel_id, name, topic, slowmode, position, parent, reason }) => {
    const body: Record<string, unknown> = {}
    if (name !== undefined) body['name'] = name
    if (topic !== undefined) body['topic'] = topic
    if (slowmode !== undefined) body['rate_limit_per_user'] = slowmode
    if (position !== undefined) body['position'] = position
    if (parent !== undefined) body['parent_id'] = parent
    if (Object.keys(body).length === 0) throw new Error('edit_channel needs at least one of name, topic, slowmode, position, or parent.')
    const channel = await ctx.rest.request<DiscordChannel>('PATCH', `/channels/${channel_id}`, {
      body,
      headers: reasonHeaders(reason),
    })
    return toolText(`channel ${channel.id} changed in guild ${ctx.guildId}`)
  })

  server.registerTool('set_channel_permissions', {
    description:
      'Set the permission overwrite a channel or category holds for one role or member: the bits in `allow` are ' +
      'granted and the bits in `deny` are refused. Requires the Manage Roles permission. Both bitfields travel as ' +
      'base-10 strings because they exceed the exact range of a JSON number.',
    inputSchema: {
      channel_id: ChannelId.describe('Id of the channel or category holding the overwrite.'),
      overwrite_id: OtherId.describe('Id of the role or member the overwrite applies to.'),
      type: z.enum(['role', 'member']).describe('Whether the overwrite applies to a role or to one member.'),
      allow: PermissionString.describe('Base-10 permission bitfield to grant, for example "1024" for View Channel.'),
      deny: PermissionString.describe('Base-10 permission bitfield to refuse. Use "0" to refuse nothing.'),
      reason: reasonArgument('this permission change'),
    },
  }, async ({ channel_id, overwrite_id, type, allow, deny, reason }) => {
    await ctx.rest.request('PUT', `/channels/${channel_id}/permissions/${overwrite_id}`, {
      body: { allow, deny, type: OVERWRITE_TYPES[type] },
      headers: reasonHeaders(reason),
    })
    return toolText(`${type} overwrite ${overwrite_id} set on channel ${channel_id}: allow ${allow}, deny ${deny}`)
  })

  server.registerTool('list_automod_rules', {
    description:
      'List the connected server\'s AutoMod rules with their ids, trigger types, and enabled state. Requires the ' +
      'Manage Server permission.',
    inputSchema: {},
  }, async () => {
    const rules = await ctx.rest.request<DiscordAutoModRule[]>('GET', `/guilds/${ctx.guildId}/auto-moderation/rules`)
    const guildName = await ctx.lookups.guildName()
    return toolText(`guild ${ctx.guildId} — ${countOf(rules.length, 'AutoMod rule')}\n${renderAutoModRules(rules, guildName)}`)
  })

  server.registerTool('create_automod_rule', {
    description:
      'Create an AutoMod rule in the connected server and return its id. Requires the Manage Server permission. ' +
      'Discord event types: 1 message sent, 2 member updated. Trigger types: 1 keyword, 3 spam, 4 keyword preset, ' +
      '5 mention spam. A keyword trigger needs its words in `trigger_metadata`.',
    inputSchema: {
      name: z.string().min(1, 'name must not be empty').max(100, 'name must not exceed 100 characters').describe('Rule name.'),
      event_type: z.number().int().min(1).max(2).describe('What the rule watches: 1 for a message sent, 2 for a member updated.'),
      trigger_type: z
        .number()
        .int()
        .min(1)
        .max(5)
        .describe('What fires the rule: 1 keyword, 3 spam, 4 keyword preset, 5 mention spam.'),
      actions: z
        .array(z.record(z.string(), z.unknown()))
        .min(1)
        .describe(
          'What the rule does, for example `[{"type": 1}]` to block the message or ' +
          '`[{"type": 2, "metadata": {"channel_id": "<id>"}}]` to send an alert.',
        ),
      trigger_metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Trigger settings, such as `{"keyword_filter": ["badword"]}` for a keyword trigger.'),
      enabled: z.boolean().default(true).describe('Whether the rule takes effect immediately.'),
      reason: reasonArgument('this rule creation'),
    },
  }, async ({ name, event_type, trigger_type, actions, trigger_metadata, enabled, reason }) => {
    const body: Record<string, unknown> = { name, event_type, trigger_type, actions, enabled }
    if (trigger_metadata !== undefined) body['trigger_metadata'] = trigger_metadata
    const rule = await ctx.rest.request<DiscordAutoModRule>('POST', `/guilds/${ctx.guildId}/auto-moderation/rules`, {
      body,
      headers: reasonHeaders(reason),
    })
    return toolText(`AutoMod rule ${rule.id} named "${name}" created in guild ${ctx.guildId}, enabled ${String(enabled)}`)
  })

  server.registerTool('edit_automod_rule', {
    description:
      'Change an AutoMod rule\'s name, event type, trigger type, trigger metadata, actions, enabled state, or exempt ' +
      'roles and channels. Give at least one field. Requires the Manage Server permission.',
    inputSchema: {
      rule_id: OtherId.describe('Id of the AutoMod rule to change.'),
      name: z
        .string()
        .min(1, 'name must not be empty')
        .max(100, 'name must not exceed 100 characters')
        .optional()
        .describe('New rule name.'),
      event_type: z
        .number()
        .int()
        .min(1)
        .max(AUTOMOD_EVENT_TYPES_MAX)
        .optional()
        .describe('What the rule watches: 1 for a message sent, 2 for a member updated, and Discord\'s remaining event types up to 7.'),
      trigger_type: z
        .number()
        .int()
        .min(1)
        .max(AUTOMOD_TRIGGER_TYPES_MAX)
        .optional()
        .describe(
          'What fires the rule: 1 keyword, 3 spam, 4 keyword preset, 5 mention spam, and Discord\'s ' +
          'remaining trigger types up to 6.',
        ),
      trigger_metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('New trigger settings, such as `{"keyword_filter": ["badword"]}`.'),
      actions: z
        .array(z.record(z.string(), z.unknown()))
        .min(1)
        .optional()
        .describe('What the rule does, for example `[{"type": 1}]` to block the message.'),
      enabled: z.boolean().optional().describe('Whether the rule takes effect.'),
      exempt_roles: z.array(RoleId).optional().describe('Role ids the rule never applies to.'),
      exempt_channels: z.array(ChannelId).optional().describe('Channel ids the rule never applies to.'),
      reason: reasonArgument('this rule change'),
    },
  }, async ({ rule_id, name, event_type, trigger_type, trigger_metadata, actions, enabled, exempt_roles, exempt_channels, reason }) => {
    const body: Record<string, unknown> = {}
    if (name !== undefined) body['name'] = name
    if (event_type !== undefined) body['event_type'] = event_type
    if (trigger_type !== undefined) body['trigger_type'] = trigger_type
    if (trigger_metadata !== undefined) body['trigger_metadata'] = trigger_metadata
    if (actions !== undefined) body['actions'] = actions
    if (enabled !== undefined) body['enabled'] = enabled
    if (exempt_roles !== undefined) body['exempt_roles'] = exempt_roles
    if (exempt_channels !== undefined) body['exempt_channels'] = exempt_channels
    if (Object.keys(body).length === 0) {
      throw new Error(
        'edit_automod_rule needs at least one of name, event_type, trigger_type, trigger_metadata, ' +
        'actions, enabled, exempt_roles, or exempt_channels.',
      )
    }
    await ctx.rest.request('PATCH', `/guilds/${ctx.guildId}/auto-moderation/rules/${rule_id}`, {
      body,
      headers: reasonHeaders(reason),
    })
    return toolText(`AutoMod rule ${rule_id} changed in guild ${ctx.guildId}: ${Object.keys(body).join(', ')}`)
  })

  server.registerTool('delete_automod_rule', {
    description: 'Delete an AutoMod rule from the connected server. Requires the Manage Server permission.',
    inputSchema: {
      rule_id: OtherId.describe('Id of the AutoMod rule to delete.'),
      reason: reasonArgument('this rule deletion'),
    },
  }, async ({ rule_id, reason }) => {
    await ctx.rest.request('DELETE', `/guilds/${ctx.guildId}/auto-moderation/rules/${rule_id}`, {
      headers: reasonHeaders(reason),
    })
    return toolText(`AutoMod rule ${rule_id} deleted from guild ${ctx.guildId}`)
  })

  server.registerTool('edit_guild', {
    description:
      'Change the connected server\'s name, description, verification level, or preferred locale. Give at least one ' +
      'field. Requires the Manage Server permission.',
    inputSchema: {
      name: z.string().min(1).max(100).optional().describe('New server name.'),
      description: z.string().max(300).optional().describe('New server description.'),
      verification_level: z
        .number()
        .int()
        .min(0)
        .max(4)
        .optional()
        .describe('How hard Discord makes new members prove they are human: 0 none, 1 low, 2 medium, 3 high, 4 highest.'),
      preferred_locale: z.string().optional().describe('Preferred language of the server, such as `en-US`.'),
      reason: reasonArgument('this server change'),
    },
  }, async ({ name, description, verification_level, preferred_locale, reason }) => {
    const body: Record<string, unknown> = {}
    if (name !== undefined) body['name'] = name
    if (description !== undefined) body['description'] = description
    if (verification_level !== undefined) body['verification_level'] = verification_level
    if (preferred_locale !== undefined) body['preferred_locale'] = preferred_locale
    if (Object.keys(body).length === 0) {
      throw new Error('edit_guild needs at least one of name, description, verification_level, or preferred_locale.')
    }
    await ctx.rest.request('PATCH', `/guilds/${ctx.guildId}`, { body, headers: reasonHeaders(reason) })
    return toolText(`guild ${ctx.guildId} changed: ${Object.keys(body).join(', ')}`)
  })
}
