/**
 * Discord field resolution: record types narrowed to the fields this package
 * reads, channel type names, jump links, and readable message text.
 */

/** A Discord user as message and member records carry one. */
export interface DiscordUser {
  id: string
  username?: string
  global_name?: string | null
}

/** A Discord attachment as a message carries one. Filenames are Discord-authored text. */
export interface DiscordAttachment {
  filename?: string
  size?: number
}

/** One field of a Discord embed. */
export interface EmbedField {
  name?: string
  value?: string
}

/** A Discord embed, narrowed to the text-bearing fields. */
export interface DiscordEmbed {
  author?: { name?: string }
  title?: string
  description?: string
  fields?: EmbedField[]
  footer?: { text?: string }
}

/** A Discord reaction summary as a message carries one. */
export interface DiscordReaction {
  emoji?: { name?: string | null, id?: string | null }
  count?: number
}

/** A Discord message, narrowed to the fields this package reads. */
export interface DiscordMessage {
  id: string
  channel_id: string
  content?: string
  author?: DiscordUser
  timestamp?: string
  components?: unknown[]
  embeds?: DiscordEmbed[]
  attachments?: DiscordAttachment[]
  reactions?: DiscordReaction[]
}

/** A Discord channel, narrowed to the fields this package reads. */
export interface DiscordChannel {
  id: string
  name?: string
  type: number
  topic?: string | null
  parent_id?: string | null
  rate_limit_per_user?: number
  message_count?: number
  member_count?: number
  owner_id?: string
  thread_metadata?: { archived?: boolean, auto_archive_duration?: number }
}

/** A Discord guild, narrowed to the fields this package reads. */
export interface DiscordGuild {
  id: string
  name?: string
  owner_id?: string
  description?: string | null
  premium_tier?: number
  preferred_locale?: string
  features?: string[]
  approximate_member_count?: number
  approximate_presence_count?: number
}

/** A Discord role, narrowed to the fields this package reads. */
export interface DiscordRole {
  id: string
  name?: string
  managed?: boolean
  position?: number
}

/** A Discord guild member, narrowed to the fields this package reads. */
export interface DiscordMember {
  user?: DiscordUser
  nick?: string | null
  roles?: string[]
  joined_at?: string
  communication_disabled_until?: string | null
  mute?: boolean
  deaf?: boolean
}

/** A Discord ban, narrowed to the fields this package reads. */
export interface DiscordBan {
  user?: DiscordUser
  reason?: string | null
}

/** A Discord AutoMod rule, narrowed to the fields this package reads. */
export interface DiscordAutoModRule {
  id: string
  name?: string
  event_type?: number
  trigger_type?: number
  enabled?: boolean
  actions?: unknown[]
}

/** A Discord guild invite, narrowed to the fields this package reads. */
export interface DiscordInvite {
  code?: string
  channel?: { id?: string, name?: string }
  inviter?: DiscordUser
  uses?: number
  max_uses?: number
  temporary?: boolean
  expires_at?: string | null
}

/** A Discord audit-log entry, narrowed to the fields this package reads. */
export interface DiscordAuditLogEntry {
  id: string
  action_type: number
  user_id?: string | null
  target_id?: string | null
  reason?: string | null
}

/** Channel type names the `type` filter of `list_channels` accepts. */
export type ChannelTypeFilter = 'text' | 'voice' | 'category' | 'forum' | 'announcement' | 'stage'

/** Discord's numeric channel type for each filter name. */
const FILTER_TYPES: Readonly<Record<ChannelTypeFilter, number>> = {
  text: 0,
  voice: 2,
  category: 4,
  announcement: 5,
  stage: 13,
  forum: 15,
}

/** Discord's name for each numeric channel type this package reports. */
const TYPE_NAMES: Readonly<Record<number, string>> = {
  0: 'text',
  1: 'direct message',
  2: 'voice',
  3: 'group direct message',
  4: 'category',
  5: 'announcement',
  10: 'announcement thread',
  11: 'public thread',
  12: 'private thread',
  13: 'stage',
  14: 'directory',
  15: 'forum',
  16: 'media',
}

/** Discord's name for each audit-log action type this package names. */
const AUDIT_ACTION_NAMES: Readonly<Record<number, string>> = {
  1: 'GUILD_UPDATE',
  10: 'CHANNEL_CREATE',
  11: 'CHANNEL_UPDATE',
  12: 'CHANNEL_DELETE',
  13: 'CHANNEL_OVERWRITE_CREATE',
  14: 'CHANNEL_OVERWRITE_UPDATE',
  15: 'CHANNEL_OVERWRITE_DELETE',
  20: 'MEMBER_KICK',
  21: 'MEMBER_PRUNE',
  22: 'MEMBER_BAN_ADD',
  23: 'MEMBER_BAN_REMOVE',
  24: 'MEMBER_UPDATE',
  25: 'MEMBER_ROLE_UPDATE',
  26: 'MEMBER_MOVE',
  27: 'MEMBER_DISCONNECT',
  28: 'BOT_ADD',
  30: 'ROLE_CREATE',
  31: 'ROLE_UPDATE',
  32: 'ROLE_DELETE',
  40: 'INVITE_CREATE',
  41: 'INVITE_UPDATE',
  42: 'INVITE_DELETE',
  72: 'MESSAGE_DELETE',
  73: 'MESSAGE_BULK_DELETE',
  140: 'AUTOMOD_RULE_CREATE',
  141: 'AUTOMOD_RULE_UPDATE',
  142: 'AUTOMOD_RULE_DELETE',
  145: 'AUTOMOD_USER_COMMUNICATION_DISABLED'
}

/** Milliseconds from the Unix epoch to Discord's epoch, 2015-01-01T00:00:00Z. */
const DISCORD_EPOCH_MS = 1_420_070_400_000

/** Thread channel types: channels whose parent holds them rather than the guild's channel list. */
const THREAD_TYPES = new Set([10, 11, 12])

/** Channel types `search_messages` scans: text channels and announcement channels. */
const SEARCHABLE_TYPES = new Set([0, 5])

/**
 * Discord's numeric type for a filter name.
 * @param filter - the filter name a caller passed.
 * @returns Discord's numeric channel type.
 */
export function channelTypeOf(filter: ChannelTypeFilter): number {
  return FILTER_TYPES[filter]
}

/**
 * Discord's name for a channel type.
 * @param type - Discord's numeric channel type.
 * @returns the name, or `type <n>` for a type this package does not name.
 */
export function channelTypeName(type: number): string {
  return TYPE_NAMES[type] ?? `type ${String(type)}`
}

/**
 * Whether a channel type is a thread.
 * @param type - Discord's numeric channel type.
 * @returns true for announcement, public, and private threads.
 */
export function isThread(type: number): boolean {
  return THREAD_TYPES.has(type)
}

/**
 * Whether a channel type holds messages a search can scan.
 * @param type - Discord's numeric channel type.
 * @returns true for text and announcement channels.
 */
export function isSearchable(type: number): boolean {
  return SEARCHABLE_TYPES.has(type)
}

/**
 * Discord's name for an audit-log action type.
 *
 * Discord carries no `MEMBER_TIMEOUT` action type: a timeout a human set is recorded as
 * `MEMBER_UPDATE`, and one an AutoMod rule applied as `AUTOMOD_USER_COMMUNICATION_DISABLED`.
 * @param actionType - Discord's numeric audit-log action type.
 * @returns the name, or the number itself for a type this package does not name.
 */
export function auditActionName(actionType: number): string {
  return AUDIT_ACTION_NAMES[actionType] ?? String(actionType)
}

/**
 * The instant a Discord snowflake was issued.
 *
 * An audit-log entry carries no created timestamp of its own; the high bits of its id hold one.
 * @param id - a Discord snowflake.
 * @returns the instant in ISO 8601, or a fixed placeholder when the value is not a snowflake.
 */
export function snowflakeTime(id: string): string {
  if (!/^\d+$/u.test(id)) return 'unknown time'
  const parsed = new Date(Number(BigInt(id) >> 22n) + DISCORD_EPOCH_MS)
  return Number.isNaN(parsed.getTime()) ? 'unknown time' : parsed.toISOString()
}

/**
 * The browser link to one message.
 * @param guildId - the guild this process serves.
 * @param channelId - the channel holding the message.
 * @param messageId - the message to link.
 * @returns the `discord.com` jump URL.
 */
export function jumpUrl(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`
}

/**
 * Encode a reaction for use as one URL path segment.
 * @param emoji - a unicode glyph, or `name:id` for a custom emoji.
 * @returns the percent-encoded segment.
 */
export function emojiPathSegment(emoji: string): string {
  return encodeURIComponent(emoji)
}

/**
 * The display name of a user.
 * @param user - the user, when the record carries one.
 * @returns the global name, else the username, else a fixed placeholder.
 */
export function authorName(user: DiscordUser | undefined): string {
  if (user === undefined) return 'unknown author'
  return user.global_name ?? user.username ?? 'unknown author'
}

/**
 * A message timestamp as ISO 8601.
 * @param timestamp - Discord's ISO 8601 timestamp.
 * @returns the same instant in UTC ISO form, or a fixed placeholder when the value is absent or unparseable.
 */
export function isoTime(timestamp: string | undefined): string {
  if (timestamp === undefined) return 'unknown time'
  const parsed = new Date(timestamp)
  return Number.isNaN(parsed.getTime()) ? 'unknown time' : parsed.toISOString()
}

/**
 * A byte count as a short human-readable size.
 * @param bytes - the size in bytes.
 * @returns the size in bytes, KiB, or MiB.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

/**
 * Collect the text of Components V2 `TextDisplay` parts.
 * @param component - a raw Discord component, possibly holding children.
 * @param into - the collected lines, appended in tree order.
 */
function collectComponentText(component: unknown, into: string[]): void {
  if (component === null || typeof component !== 'object') return
  const record = component as { type?: unknown, content?: unknown, components?: unknown }
  // Discord numbers Components V2 `TextDisplay` 10; this package carries no
  // `discord-api-types` dependency, so the number is stated here.
  if (record.type === 10 && typeof record.content === 'string') into.push(record.content)
  if (Array.isArray(record.components)) {
    for (const child of record.components) collectComponentText(child, into)
  }
}

/**
 * The text of a message's Components V2 `TextDisplay` parts.
 * @param message - the message to read.
 * @returns the part texts, joined by newlines, empty when the message carries none.
 */
export function componentText(message: DiscordMessage): string {
  const parts: string[] = []
  for (const component of message.components ?? []) collectComponentText(component, parts)
  return parts.filter((part) => part.length > 0).join('\n')
}

/**
 * The text of a message's embeds.
 * @param message - the message to read.
 * @returns the title, description, field, and footer texts, joined by newlines.
 */
export function embedText(message: DiscordMessage): string {
  const parts: string[] = []
  for (const embed of message.embeds ?? []) {
    parts.push(embed.author?.name ?? '', embed.title ?? '', embed.description ?? '')
    for (const field of embed.fields ?? []) parts.push(field.name ?? '', field.value ?? '')
    parts.push(embed.footer?.text ?? '')
  }
  return parts.filter((part) => part.length > 0).join('\n')
}

/**
 * Everything readable in a message: its content, its Components V2 text, and its embed text.
 * @param message - the message to read.
 * @returns the readable text, joined by newlines.
 */
export function readableMessageText(message: DiscordMessage): string {
  const parts = [message.content ?? '', componentText(message), embedText(message)]
  return parts.filter((part) => part.length > 0).join('\n')
}
