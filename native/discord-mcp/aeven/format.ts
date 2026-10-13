/**
 * Tool text rendering.
 *
 * Discord-authored values — names, topics, message bodies, embed text, file
 * names, ban reasons — reach tool output only inside a nonce-fenced block, with a
 * fresh nonce per block. Status lines this package writes stay outside the fence,
 * so a model can tell its own instructions from other people's text.
 */

import type { ChannelPlacement } from './lookups.ts'
import type {
  DiscordAuditLogEntry,
  DiscordAutoModRule,
  DiscordBan,
  DiscordChannel,
  DiscordGuild,
  DiscordInvite,
  DiscordMember,
  DiscordMessage,
  DiscordRole,
} from './refs.ts'
import {
  auditActionName,
  authorName,
  channelTypeName,
  componentText,
  embedText,
  formatBytes,
  isThread,
  isoTime,
  jumpUrl,
  snowflakeTime,
} from './refs.ts'
import { wrapMessages, wrapUntrusted } from './vendor/untrusted.ts'

/** A channel type number for a category, used to name a channel's parent. */
const CATEGORY_TYPE = 4

/** One message prepared for a fenced batch. */
export interface MessageRecord {
  /** The message's id, recorded on its element. */
  id: string
  /** The message author's display name, recorded on its element. */
  author: string
  /** The lines a model reads for this message. */
  lines: readonly string[]
}

/**
 * One message as the lines a model reads.
 * @param message - the message to render.
 * @returns its identity line `[id] ISO-time author: text`, then a summary line per attachment, embed, and reaction it carries.
 */
export function messageLines(message: DiscordMessage): string[] {
  const content = message.content ?? ''
  const lines = [`[${message.id}] ${isoTime(message.timestamp)} ${authorName(message.author)}: ${content}`]

  const components = componentText(message)
  if (components !== '') lines.push(`components: ${components}`)

  const attachments = (message.attachments ?? []).map(
    (attachment) => `${attachment.filename ?? 'unnamed file'} (${formatBytes(attachment.size ?? 0)})`,
  )
  if (attachments.length > 0) lines.push(`attachments: ${attachments.join(', ')}`)

  if ((message.embeds ?? []).length > 0) lines.push(`embeds: ${embedText(message)}`)

  const reactions = (message.reactions ?? []).map(
    (reaction) => `${reaction.emoji?.name ?? 'unnamed emoji'} x${String(reaction.count ?? 0)}`,
  )
  if (reactions.length > 0) lines.push(`reactions: ${reactions.join(', ')}`)

  return lines
}

/**
 * A batch of message records as one fenced block.
 * @param records - the messages to render, already reduced to lines.
 * @param scope - the id the batch is scoped to: the channel id, or the guild id when the batch spans channels.
 * @returns the fenced block, one element per message.
 */
export function renderMessageBatch(records: readonly MessageRecord[], scope: string): string {
  return wrapMessages(
    records.map((record) => ({ id: record.id, author: record.author, content: record.lines.join('\n') })),
    scope,
  )
}

/**
 * A channel's messages as one fenced block.
 * @param messages - the messages to render.
 * @param scope - the id the batch is scoped to: the channel id, or the guild id when the batch spans channels.
 * @returns the fenced block, one element per message.
 */
export function renderMessages(messages: readonly DiscordMessage[], scope: string): string {
  return renderMessageBatch(
    messages.map((message) => ({
      id: message.id,
      author: authorName(message.author),
      lines: messageLines(message),
    })),
    scope,
  )
}

/**
 * The labelled fields of a channel.
 * @param channel - the channel to describe.
 * @param placement - the names of its category and, for a thread, its parent channel.
 * @returns one labelled line per field this package reports.
 */
function channelLines(channel: DiscordChannel, placement: ChannelPlacement): string[] {
  const lines = [
    `id: ${channel.id}`,
    `name: ${channel.name ?? ''}`,
    `type: ${channelTypeName(channel.type)}`,
    `category: ${placement.category ?? ''}`,
    `topic: ${channel.topic ?? ''}`,
    `slowmode: ${String(channel.rate_limit_per_user ?? 0)} seconds`,
  ]
  if (isThread(channel.type)) {
    lines.push(`parent: ${placement.parent ?? channel.parent_id ?? ''}`)
    lines.push(`owner: ${channel.owner_id ?? ''}`)
    lines.push(`messages: ${String(channel.message_count ?? 0)}`)
    lines.push(`members: ${String(channel.member_count ?? 0)}`)
    lines.push(`archived: ${String(channel.thread_metadata?.archived ?? false)}`)
    lines.push(`auto-archive: ${String(channel.thread_metadata?.auto_archive_duration ?? 0)} minutes`)
  }
  return lines
}

/**
 * One channel as a fenced block.
 * @param channel - the channel to describe.
 * @param placement - the names of its category and, for a thread, its parent channel.
 * @returns the fenced block.
 */
export function renderChannel(channel: DiscordChannel, placement: ChannelPlacement): string {
  return wrapUntrusted(channelLines(channel, placement).join('\n'), 'channels')
}

/**
 * One thread as a fenced block.
 * @param thread - the thread to describe.
 * @param placement - the names of its category and its parent channel.
 * @returns the fenced block.
 */
export function renderThread(thread: DiscordChannel, placement: ChannelPlacement): string {
  return wrapUntrusted(channelLines(thread, placement).join('\n'), 'thread')
}

/**
 * A guild's channel list as one fenced block.
 * @param channels - the channels to render, threads already excluded.
 * @param guildName - the guild's name, shown as the block's first line.
 * @returns the fenced block.
 */
export function renderChannels(channels: readonly DiscordChannel[], guildName: string): string {
  const categories = new Map<string, string>()
  for (const channel of channels) {
    if (channel.type === CATEGORY_TYPE && channel.name !== undefined) categories.set(channel.id, channel.name)
  }
  const lines = [`server: ${guildName}`]
  for (const channel of channels) {
    const category = channel.parent_id === undefined || channel.parent_id === null
      ? ''
      : ` — category: ${categories.get(channel.parent_id) ?? channel.parent_id}`
    const topic = channel.topic === undefined || channel.topic === null || channel.topic === '' ? '' : ` — topic: ${channel.topic}`
    lines.push(`[${channel.id}] ${channel.name ?? ''} — type: ${channelTypeName(channel.type)}${category}${topic}`)
  }
  return wrapUntrusted(lines.join('\n'), 'channels')
}

/**
 * A page of guild members as one fenced block.
 * @param members - the members to render.
 * @param guildName - the guild's name, shown as the block's first line.
 * @param roleNames - the guild's role names, used to name each member's roles.
 * @returns the fenced block.
 */
export function renderMembers(
  members: readonly DiscordMember[],
  guildName: string,
  roleNames: readonly DiscordRole[],
): string {
  const byId = new Map(roleNames.map((role) => [role.id, role.name ?? role.id]))
  const lines = [`server: ${guildName}`, `members: ${String(members.length)}`]
  for (const member of members) {
    const names = (member.roles ?? []).map((roleId) => byId.get(roleId)).filter((name) => name !== undefined)
    const nickname = member.nick === undefined || member.nick === null || member.nick === '' ? '' : ` (nickname: ${member.nick})`
    const roles = names.length === 0 ? '' : ` — roles: ${names.join(', ')}`
    lines.push(`[${member.user?.id ?? 'unknown id'}] ${authorName(member.user)}${nickname}${roles}`)
  }
  return wrapUntrusted(lines.join('\n'), 'members')
}

/**
 * A guild as one fenced block.
 * @param guild - the guild to describe.
 * @param roleCount - how many roles the guild holds.
 * @returns the fenced block.
 */
export function renderGuild(guild: DiscordGuild, roleCount: number): string {
  const lines = [
    `id: ${guild.id}`,
    `name: ${guild.name ?? ''}`,
    `owner: ${guild.owner_id ?? ''}`,
    `members: ${String(guild.approximate_member_count ?? 0)}`,
    `online: ${String(guild.approximate_presence_count ?? 0)}`,
    `description: ${guild.description ?? ''}`,
    `boost tier: ${String(guild.premium_tier ?? 0)}`,
    `locale: ${guild.preferred_locale ?? ''}`,
    `features: ${(guild.features ?? []).join(', ')}`,
    `roles: ${String(roleCount)}`,
  ]
  return wrapUntrusted(lines.join('\n'), 'guild')
}

/**
 * A guild's roles as one fenced block.
 * @param roles - the roles to render.
 * @param guildName - the guild's name, shown as the block's first line.
 * @returns the fenced block.
 */
export function renderRoles(roles: readonly DiscordRole[], guildName: string): string {
  const lines = [`server: ${guildName}`]
  for (const role of roles) {
    const managed = role.managed === true ? ' — managed by an integration' : ''
    lines.push(`[${role.id}] ${role.name ?? ''} — position: ${String(role.position ?? 0)}${managed}`)
  }
  return wrapUntrusted(lines.join('\n'), 'roles')
}

/**
 * A guild's bans as one fenced block.
 * @param bans - the bans to render.
 * @param guildName - the guild's name, shown as the block's first line.
 * @returns the fenced block.
 */
export function renderBans(bans: readonly DiscordBan[], guildName: string): string {
  const lines = [`server: ${guildName}`, `bans: ${String(bans.length)}`]
  for (const ban of bans) {
    lines.push(`[${ban.user?.id ?? 'unknown id'}] ${authorName(ban.user)} — reason: ${ban.reason ?? ''}`)
  }
  return wrapUntrusted(lines.join('\n'), 'bans')
}

/**
 * One ban as a fenced block.
 * @param ban - the ban to describe.
 * @param guildName - the guild's name, shown as the block's first line.
 * @returns the fenced block.
 */
export function renderBan(ban: DiscordBan, guildName: string): string {
  const lines = [
    `server: ${guildName}`,
    `[${ban.user?.id ?? 'unknown id'}] ${authorName(ban.user)} — reason: ${ban.reason ?? ''}`,
  ]
  return wrapUntrusted(lines.join('\n'), 'bans')
}

/**
 * One member's own record as a fenced block.
 * @param member - the member to describe.
 * @param guildName - the guild's name, shown as the block's first line.
 * @returns the fenced block, carrying the member's timeout window and voice state.
 */
export function renderMember(member: DiscordMember, guildName: string): string {
  const until = member.communication_disabled_until ?? ''
  const timedOut = until !== '' && new Date(until).getTime() > Date.now()
  const lines = [
    `server: ${guildName}`,
    `id: ${member.user?.id ?? 'unknown id'}`,
    `display name: ${authorName(member.user)}`,
    `nickname: ${member.nick ?? ''}`,
    `joined: ${isoTime(member.joined_at)}`,
    `roles: ${(member.roles ?? []).join(', ')}`,
    `timed out: ${timedOut ? `until ${isoTime(until)}` : 'no'}`,
    `mute: ${String(member.mute ?? false)}`,
    `deaf: ${String(member.deaf ?? false)}`,
  ]
  return wrapUntrusted(lines.join('\n'), 'members')
}

/**
 * A guild's active invites as one fenced block.
 * @param invites - the invites to render.
 * @param guildName - the guild's name, shown as the block's first line.
 * @returns the fenced block.
 */
export function renderInvites(invites: readonly DiscordInvite[], guildName: string): string {
  const lines = [`server: ${guildName}`, `invites: ${String(invites.length)}`]
  for (const invite of invites) {
    const expires = invite.expires_at === undefined || invite.expires_at === null
      ? 'never'
      : isoTime(invite.expires_at)
    lines.push(
      `[${invite.code ?? 'unknown code'}] channel: ${invite.channel?.name ?? invite.channel?.id ?? ''}` +
      ` — creator: ${authorName(invite.inviter)} — uses: ${String(invite.uses ?? 0)} of ${String(invite.max_uses ?? 0)}` +
      ` — expires: ${expires} — temporary: ${String(invite.temporary ?? false)}`,
    )
  }
  return wrapUntrusted(lines.join('\n'), 'invites')
}

/**
 * A guild's audit-log entries as one fenced block.
 * @param entries - the entries to render, newest first.
 * @param guildName - the guild's name, shown as the block's first line.
 * @returns the fenced block, with each entry's action, actor, target, created instant, and reason.
 */
export function renderAuditLog(entries: readonly DiscordAuditLogEntry[], guildName: string): string {
  const lines = [`server: ${guildName}`, `entries: ${String(entries.length)}`]
  for (const entry of entries) {
    const reason = entry.reason === undefined || entry.reason === null || entry.reason === ''
      ? ''
      : ` — reason: ${entry.reason}`
    lines.push(
      `[${entry.id}] ${auditActionName(entry.action_type)} — actor: ${entry.user_id ?? 'unknown id'}` +
      ` — target: ${entry.target_id ?? 'none'} — created: ${snowflakeTime(entry.id)}${reason}`,
    )
  }
  return wrapUntrusted(lines.join('\n'), 'audit_log')
}

/**
 * A guild's AutoMod rules as one fenced block.
 * @param rules - the rules to render.
 * @param guildName - the guild's name, shown as the block's first line.
 * @returns the fenced block.
 */
export function renderAutoModRules(rules: readonly DiscordAutoModRule[], guildName: string): string {
  const lines = [`server: ${guildName}`, `rules: ${String(rules.length)}`]
  for (const rule of rules) {
    lines.push(
      `[${rule.id}] ${rule.name ?? ''} — enabled: ${String(rule.enabled ?? false)}` +
      ` — event: ${String(rule.event_type ?? 0)} — trigger: ${String(rule.trigger_type ?? 0)}` +
      ` — actions: ${String((rule.actions ?? []).length)}`,
    )
  }
  return wrapUntrusted(lines.join('\n'), 'automod_rules')
}

/**
 * The status line for a message this process created.
 * @param guildId - the guild this process serves.
 * @param message - Discord's created-message response.
 * @returns the message id and its jump link.
 */
export function sentMessageLine(guildId: string, message: { id: string, channel_id: string }): string {
  return `message ${message.id} in channel ${message.channel_id} — ${jumpUrl(guildId, message.channel_id, message.id)}`
}

/** A tool result carrying one text block. The MCP result type keeps an open index signature. */
export interface ToolText {
  [key: string]: unknown
  content: { type: 'text', text: string }[]
}

/**
 * Wrap text as a tool result.
 * @param value - the text to return.
 * @returns the result holding that one text block.
 */
export function toolText(value: string): ToolText {
  return { content: [{ type: 'text', text: value }] }
}

/**
 * A record count as a short status clause.
 * @param count - how many records the response carries.
 * @param singular - the singular noun for one record.
 * @param plural - the plural noun, defaulting to the singular with an `s`.
 * @returns the clause, pluralised for any count but one.
 */
export function countOf(count: number, singular: string, plural = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : plural}`
}

/**
 * A parent channel's archived public threads as one fenced block.
 * @param threads - the archived threads to render.
 * @param parentName - the parent channel's name, shown as the block's first line.
 * @returns the fenced block.
 */
export function renderArchivedThreads(threads: readonly DiscordChannel[], parentName: string): string {
  const lines = [`parent: ${parentName}`, `archived public threads: ${String(threads.length)}`]
  for (const thread of threads) {
    lines.push(
      `[${thread.id}] ${thread.name ?? ''} — messages: ${String(thread.message_count ?? 0)}` +
      ` — members: ${String(thread.member_count ?? 0)}` +
      ` — auto-archive: ${String(thread.thread_metadata?.auto_archive_duration ?? 0)} minutes`,
    )
  }
  return wrapUntrusted(lines.join('\n'), 'thread')
}
