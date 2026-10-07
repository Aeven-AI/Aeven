/**
 * The curated tool surface: the 13 tools a Discord connection serves by default.
 *
 * The names are a public contract — the Aeven host keys its approval gate on
 * them, and `.agents/skills/discord` documents the same set for the model. The
 * guild is fixed by the environment, so no tool here accepts one.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  countOf,
  messageLines,
  renderArchivedThreads,
  renderChannel,
  renderChannels,
  renderGuild,
  renderMembers,
  renderMessageBatch,
  renderMessages,
  renderThread,
  sentMessageLine,
  toolText,
  type MessageRecord,
} from './format.ts'
import type { DiscordContext } from './lookups.ts'
import {
  channelTypeOf,
  emojiPathSegment,
  isSearchable,
  isThread,
  jumpUrl,
  readableMessageText,
  type DiscordChannel,
  type DiscordMember,
  type DiscordMessage,
  type DiscordRole,
} from './refs.ts'
import { DiscordError } from './rest.ts'
import { ChannelId, MessageId, UserId } from './vendor/snowflake.ts'

/** Names of the curated tool surface, in registration order. */
export const DISCORD_CURATED_TOOLS: readonly string[] = [
  'list_channels',
  'get_channel',
  'get_messages',
  'get_thread',
  'search_messages',
  'list_members',
  'get_guild_info',
  'send_message',
  'reply_message',
  'add_reaction',
  'remove_reaction',
  'send_file',
  'create_thread',
]

/** Most messages one `search_messages` page holds. */
const SEARCH_PAGE_MAX = 100
/** Most pages one `search_messages` channel walk holds. */
const SEARCH_PAGES_MAX = 5
/** Discord's refusal of the member list means the privileged intent is off. */
const MEMBERS_INTENT =
  'Discord refused the member list (HTTP 403). Enable the Server Members privileged intent for the Aeven application in the Discord Developer Portal.'

/**
 * The query string of a message-history read.
 * @param options - page size and the optional message-id cursors.
 * @returns the query string, starting with `?`.
 */
function historyQuery(options: { limit: number, before?: string | undefined, after?: string | undefined }): string {
  const params = new URLSearchParams({ limit: String(options.limit) })
  if (options.before !== undefined) params.set('before', options.before)
  if (options.after !== undefined) params.set('after', options.after)
  return `?${params.toString()}`
}

/**
 * Read one page of a channel's history.
 * @param ctx - the tool context.
 * @param channelId - the channel or thread to read.
 * @param options - page size and the optional message-id cursors.
 * @returns the messages, newest first.
 * @throws {DiscordError} when Discord refuses the read.
 */
async function historyPage(
  ctx: DiscordContext,
  channelId: string,
  options: { limit: number, before?: string | undefined, after?: string | undefined },
): Promise<DiscordMessage[]> {
  return await ctx.rest.request<DiscordMessage[]>('GET', `/channels/${channelId}/messages${historyQuery(options)}`)
}

/** One message a search matched. */
interface SearchMatch {
  /** The channel the message sits in. */
  channel: DiscordChannel
  /** The matched message. */
  message: DiscordMessage
}

/** What one search scan covered. */
interface SearchCoverage {
  /** How many messages the scan read. */
  scanned: number
  /** How many channels the scan read from. */
  channels: number
  /** How many channels Discord refused to the bot, which the scan skipped. */
  unreadable: number
  /** Whether the scan budget stopped the scan short of the pages it was asked for. */
  bounded: boolean
}

/**
 * Scan recent messages of the named channels for a substring of their readable text.
 * A channel the bot cannot read — a staff channel, a private channel, a channel whose
 * permissions exclude it — is skipped and counted, so one unreadable channel never
 * costs the caller the whole scan.
 * @param ctx - the tool context.
 * @param options - the query, the channels, the page size, the page cap, and a start cursor.
 * @returns the matches in scan order, and what the scan covered.
 * @throws {DiscordError} when Discord refuses the scan for a reason other than one channel.
 */
async function scanMessages(
  ctx: DiscordContext,
  options: {
    channels: readonly DiscordChannel[]
    query: string
    limit: number
    pages: number
    before?: string | undefined
  },
): Promise<{ matches: SearchMatch[], coverage: SearchCoverage }> {
  const needle = options.query.toLowerCase()
  const matches: SearchMatch[] = []
  let scanned = 0
  let channels = 0
  let unreadable = 0
  let bounded = false

  for (const channel of options.channels) {
    const budget = ctx.maxScanMessages - scanned
    if (budget <= 0) {
      bounded = true
      break
    }
    let before = options.before
    let read = false
    for (let page = 0; page < options.pages; page += 1) {
      const remaining = ctx.maxScanMessages - scanned
      if (remaining <= 0) {
        bounded = true
        break
      }
      const size = Math.min(options.limit, remaining)
      let messages: DiscordMessage[]
      try {
        messages = await historyPage(ctx, channel.id, { limit: size, before })
      } catch (error) {
        // A refusal here is about this channel rather than about the scan: Discord hides
        // the channel from the bot, and the remaining channels still hold the answer.
        if (!isChannelUnreadable(error)) throw error
        unreadable += 1
        break
      }
      read = true
      scanned += messages.length
      for (const message of messages) {
        if (readableMessageText(message).toLowerCase().includes(needle)) matches.push({ channel, message })
      }
      if (messages.length < size) break
      if (size < options.limit) {
        bounded = true
        break
      }
      const oldest = messages[messages.length - 1]?.id
      if (oldest === undefined) break
      before = oldest
    }
    if (read) channels += 1
  }

  return { matches, coverage: { scanned, channels, unreadable, bounded } }
}

/**
 * Whether Discord refused one channel rather than the scan.
 * @param error - the value a channel read threw.
 * @returns true for the two answers that mean the channel is out of the bot's reach.
 */
function isChannelUnreadable(error: unknown): boolean {
  return error instanceof DiscordError && (error.status === 403 || error.status === 404)
}

/**
 * One entry of Discord's member-search answer as a guild member.
 * @param entry - a raw entry of the answer's `members` array.
 * @returns the member, whether Discord nested it under `member` or returned it directly.
 */
function memberFromSearchEntry(entry: unknown): DiscordMember {
  if (entry === null || typeof entry !== 'object') return {}
  const nested: unknown = (entry as { member?: unknown }).member
  return nested !== null && typeof nested === 'object' ? (nested as DiscordMember) : (entry as DiscordMember)
}

/**
 * Register the curated tools on a server.
 * @param server - the server the connector mounts.
 * @param ctx - the REST client, the fixed guild, and the shared lookups.
 */
export function registerCuratedTools(server: McpServer, ctx: DiscordContext): void {
  server.registerTool('list_channels', {
    description:
      'List the connected Discord server\'s channels, with each channel\'s id, name, type, category, and topic. ' +
      'Threads are not listed. Requires the View Channels permission.',
    inputSchema: {
      type: z
        .enum(['text', 'voice', 'category', 'forum', 'announcement', 'stage'])
        .optional()
        .describe('Return only channels of this type. Omit to list every channel.'),
    },
  }, async ({ type }) => {
    const all = (await ctx.lookups.channels()).filter((channel) => !isThread(channel.type))
    const wanted = type === undefined ? all : all.filter((channel) => channel.type === channelTypeOf(type))
    const guildName = await ctx.lookups.guildName()
    return toolText(`guild ${ctx.guildId} — ${countOf(wanted.length, 'channel')}\n${renderChannels(wanted, guildName)}`)
  })

  server.registerTool('get_channel', {
    description:
      'Read one Discord channel or thread by id: its name, type, category, topic, and slowmode, plus its parent, ' +
      'owner, member count, message count, and archive state when it is a thread. Requires the View Channels permission.',
    inputSchema: {
      channel_id: ChannelId.describe('Id of the channel to read.'),
    },
  }, async ({ channel_id }) => {
    const channel = await ctx.lookups.channel(channel_id)
    const placement = await ctx.lookups.place(channel)
    return toolText(`channel ${channel.id}\n${renderChannel(channel, placement)}`)
  })

  server.registerTool('get_messages', {
    description:
      'Read a Discord channel\'s recent messages, newest first, as `[id] ISO-time author: text` with attachment, ' +
      'embed, and reaction summaries. Message bodies need the Message Content intent; without it, text carried by ' +
      'Components or embeds is still reported. Requires the Read Message History permission.',
    inputSchema: {
      channel_id: ChannelId.describe('Id of the channel to read.'),
      limit: z.number().int().min(1).max(100).default(50).describe('How many messages to return, newest first.'),
      before: MessageId.optional().describe('Return messages older than this message id. Not valid with `after`.'),
      after: MessageId.optional().describe('Return messages newer than this message id. Not valid with `before`.'),
    },
  }, async ({ channel_id, limit, before, after }) => {
    if (before !== undefined && after !== undefined) {
      throw new Error('before and after cannot be combined: give at most one message-id cursor.')
    }
    const messages = await historyPage(ctx, channel_id, { limit, before, after })
    return toolText(`channel ${channel_id} — ${countOf(messages.length, 'message')}\n${renderMessages(messages, channel_id)}`)
  })

  server.registerTool('get_thread', {
    description:
      'Read one Discord thread: its name, category, parent channel, owner, member and message counts, archived state, ' +
      'and auto-archive duration, plus its recent messages. Set `archived` to list the parent channel\'s archived ' +
      'public threads instead, which needs the Manage Threads permission.',
    inputSchema: {
      thread_id: ChannelId.describe('Id of the thread, or of a channel whose archived threads to list.'),
      limit: z.number().int().min(1).max(100).default(50).describe('How many messages to return, newest first.'),
      before: MessageId.optional().describe('Return messages older than this message id.'),
      archived: z
        .boolean()
        .optional()
        .describe('List the parent channel\'s archived public threads instead of reading this thread\'s messages.'),
    },
  }, async ({ thread_id, limit, before, archived }) => {
    const thread = await ctx.lookups.channel(thread_id)
    const placement = await ctx.lookups.place(thread)
    const head = `thread ${thread.id}\n${renderThread(thread, placement)}`

    if (archived === true && isThread(thread.type)) {
      const parentId = thread.parent_id
      if (parentId === undefined || parentId === null) {
        throw new Error('Discord reported no parent channel for this thread, so its archived threads cannot be listed.')
      }
      const parent = await ctx.lookups.channel(parentId)
      const listing = await ctx.rest.request<{ threads?: DiscordChannel[] }>(
        'GET',
        `/channels/${parentId}/threads/archived/public`,
      )
      const threads = listing.threads ?? []
      return toolText(
        `${head}\nchannel ${parentId} — ${countOf(threads.length, 'archived public thread')}\n` +
        `${renderArchivedThreads(threads, parent.name ?? parentId)}`,
      )
    }

    const messages = await historyPage(ctx, thread_id, { limit, before })
    return toolText(`${head}\nthread ${thread_id} — ${countOf(messages.length, 'message')}\n${renderMessages(messages, thread_id)}`)
  })

  server.registerTool('search_messages', {
    description:
      'Find a case-insensitive substring of message text in the connected server. Discord reserves server-wide ' +
      'search for user accounts, so this walks recent messages instead: name `channel_id` to scan one channel, or ' +
      'omit it to scan the server\'s text and announcement channels under a scan budget. Returns every match with ' +
      'its channel and jump link, then what the scan covered. Requires the Read Message History permission.',
    inputSchema: {
      query: z.string().min(1).describe('Text to find, matched case-insensitively against message text.'),
      channel_id: ChannelId.optional().describe('Scan only this channel. Omit to scan the server\'s text channels.'),
      limit: z.number().int().min(1).max(SEARCH_PAGE_MAX).default(SEARCH_PAGE_MAX).describe('Messages per page.'),
      pages: z.number().int().min(1).max(SEARCH_PAGES_MAX).default(2).describe('Pages read per channel.'),
      before: MessageId.optional().describe('Start each channel at messages older than this message id.'),
    },
  }, async ({ query, channel_id, limit, pages, before }) => {
    const channels = channel_id === undefined
      ? (await ctx.lookups.channels()).filter((channel) => isSearchable(channel.type))
      : [await ctx.lookups.channel(channel_id)]
    const { matches, coverage } = await scanMessages(ctx, { channels, query, limit, pages, before })

    const records: MessageRecord[] = matches.map((match) => ({
      id: match.message.id,
      author: match.message.author?.global_name ?? match.message.author?.username ?? 'unknown author',
      lines: [
        ...messageLines(match.message),
        `channel: #${match.channel.name ?? match.channel.id}`,
        `jump: ${jumpUrl(ctx.guildId, match.channel.id, match.message.id)}`,
      ],
    }))
    const reached = coverage.bounded
      ? `bounded by the scan budget of ${String(ctx.maxScanMessages)} messages`
      : 'complete'
    const skipped = coverage.unreadable === 0
      ? ''
      : `; ${countOf(coverage.unreadable, 'channel')} not visible to the Aeven bot`
    // The caller named one channel, so a refusal there is the answer rather than a footnote.
    if (channel_id !== undefined && coverage.channels === 0 && coverage.unreadable > 0) {
      throw new Error(`The Aeven bot cannot read channel ${channel_id}: the server's permissions hide it from the bot.`)
    }
    return toolText(
      `search "${query}" — ${countOf(matches.length, 'match', 'matches')}\n` +
      `${renderMessageBatch(records, channel_id ?? ctx.guildId)}\n` +
      `coverage: scanned ${countOf(coverage.scanned, 'message')} across ${countOf(coverage.channels, 'channel')} — ${reached}${skipped}`,
    )
  })

  server.registerTool('list_members', {
    description:
      'List the connected server\'s members with their display names and roles. Needs the Server Members privileged ' +
      'intent enabled for the Aeven application. Give `query` to search by name prefix instead of paging with `after`.',
    inputSchema: {
      limit: z.number().int().min(1).max(1000).default(100).describe('How many members to return.'),
      after: UserId.optional().describe('Return members after this user id, for paging.'),
      query: z.string().min(1).optional().describe('Match members whose name starts with this text.'),
    },
  }, async ({ limit, after, query }) => {
    let members: DiscordMember[]
    try {
      if (query === undefined) {
        const params = new URLSearchParams({ limit: String(limit) })
        if (after !== undefined) params.set('after', after)
        members = await ctx.rest.request<DiscordMember[]>('GET', `/guilds/${ctx.guildId}/members?${params.toString()}`)
      } else {
        const answer = await ctx.rest.request<{ members?: unknown[] }>(
          'POST',
          `/guilds/${ctx.guildId}/members-search`,
          { body: { query, limit } },
        )
        members = (answer.members ?? []).map(memberFromSearchEntry)
      }
    } catch (error) {
      if (error instanceof DiscordError && error.status === 403) throw new Error(MEMBERS_INTENT)
      throw error
    }
    const roles: DiscordRole[] = await ctx.lookups.roles()
    const guildName = await ctx.lookups.guildName()
    return toolText(`guild ${ctx.guildId} — ${countOf(members.length, 'member')}\n${renderMembers(members, guildName, roles)}`)
  })

  server.registerTool('get_guild_info', {
    description:
      'Read the connected Discord server\'s own record: name, id, owner, member and online counts, description, ' +
      'boost tier, locale, features, and role count. Takes no arguments; the server is fixed by the connection.',
    inputSchema: {},
  }, async () => {
    const guild = await ctx.lookups.guild()
    const roles = await ctx.lookups.roles()
    return toolText(`guild ${guild.id}\n${renderGuild(guild, roles.length)}`)
  })

  server.registerTool('send_message', {
    description:
      'Post a message to a Discord channel as the Aeven bot. Returns the new message id and its jump link. Requires ' +
      'the Send Messages permission in that channel. Other people see the result, so the user approves it first.',
    inputSchema: {
      channel_id: ChannelId.describe('Id of the channel to post in.'),
      content: z
        .string()
        .min(1, 'content must not be empty')
        .max(2000, 'content must not exceed 2000 characters')
        .describe('Message text, 1 to 2000 characters.'),
    },
  }, async ({ channel_id, content }) => {
    const message = await ctx.rest.request<DiscordMessage>('POST', `/channels/${channel_id}/messages`, { body: { content } })
    return toolText(sentMessageLine(ctx.guildId, message))
  })

  server.registerTool('reply_message', {
    description:
      'Post a message in a Discord channel that references an earlier message in the same channel. Returns the new ' +
      'message id and its jump link. Requires the Send Messages permission in that channel.',
    inputSchema: {
      channel_id: ChannelId.describe('Id of the channel holding both messages.'),
      message_id: MessageId.describe('Id of the message being answered.'),
      content: z
        .string()
        .min(1, 'content must not be empty')
        .max(2000, 'content must not exceed 2000 characters')
        .describe('Message text, 1 to 2000 characters.'),
    },
  }, async ({ channel_id, message_id, content }) => {
    const message = await ctx.rest.request<DiscordMessage>('POST', `/channels/${channel_id}/messages`, {
      body: {
        content,
        message_reference: { message_id, channel_id, fail_if_not_exists: false },
      },
    })
    return toolText(sentMessageLine(ctx.guildId, message))
  })

  server.registerTool('add_reaction', {
    description:
      'Add a reaction from the Aeven bot to a Discord message. Requires the Add Reactions permission in that channel.',
    inputSchema: {
      channel_id: ChannelId.describe('Id of the channel holding the message.'),
      message_id: MessageId.describe('Id of the message to react to.'),
      emoji: z.string().min(1).describe('A unicode emoji glyph, or `name:id` for a custom emoji of this server.'),
    },
  }, async ({ channel_id, message_id, emoji }) => {
    await ctx.rest.request('PUT', `/channels/${channel_id}/messages/${message_id}/reactions/${emojiPathSegment(emoji)}/@me`)
    return toolText(`reaction ${emoji} added to message ${message_id} in channel ${channel_id}`)
  })

  server.registerTool('remove_reaction', {
    description:
      'Remove the Aeven bot\'s own reaction from a Discord message. Requires the Add Reactions permission in that ' +
      'channel. Other people\'s reactions are left alone.',
    inputSchema: {
      channel_id: ChannelId.describe('Id of the channel holding the message.'),
      message_id: MessageId.describe('Id of the message to remove the reaction from.'),
      emoji: z.string().min(1).describe('A unicode emoji glyph, or `name:id` for a custom emoji of this server.'),
    },
  }, async ({ channel_id, message_id, emoji }) => {
    await ctx.rest.request('DELETE', `/channels/${channel_id}/messages/${message_id}/reactions/${emojiPathSegment(emoji)}/@me`)
    return toolText(`reaction ${emoji} removed from message ${message_id} in channel ${channel_id}`)
  })

  server.registerTool('send_file', {
    description:
      'Upload one file from this computer to a Discord channel as the Aeven bot, with an optional caption and an ' +
      'optional reply reference. Returns the new message id and its jump link. Requires the Attach Files and Send ' +
      'Messages permissions in that channel.',
    inputSchema: {
      channel_id: ChannelId.describe('Id of the channel to upload to.'),
      file_path: z.string().min(1).describe('Local path of the file to upload.'),
      caption: z
        .string()
        .max(2000, 'caption must not exceed 2000 characters')
        .optional()
        .describe('Message text sent beside the file, up to 2000 characters.'),
      reply_to_message_id: MessageId.optional().describe('Answer this message in the same channel.'),
    },
  }, async ({ channel_id, file_path, caption, reply_to_message_id }) => {
    const payload: Record<string, unknown> = {}
    if (caption !== undefined) payload['content'] = caption
    if (reply_to_message_id !== undefined) {
      payload['message_reference'] = { message_id: reply_to_message_id, channel_id, fail_if_not_exists: false }
    }
    const message = await ctx.rest.upload<DiscordMessage>(`/channels/${channel_id}/messages`, {
      filePath: file_path,
      payload,
      maxBytes: ctx.maxFileBytes,
    })
    return toolText(sentMessageLine(ctx.guildId, message))
  })

  server.registerTool('create_thread', {
    description:
      'Open a thread in a Discord channel, anchored on an existing message when `message_id` is given and standalone ' +
      'otherwise. Returns the new thread id and name. Requires the Create Public Threads permission.',
    inputSchema: {
      channel_id: ChannelId.describe('Id of the channel the thread belongs to.'),
      message_id: MessageId.optional().describe('Anchor the thread on this message. Omit for a standalone thread.'),
      name: z
        .string()
        .min(1, 'name must not be empty')
        .max(100, 'name must not exceed 100 characters')
        .describe('Thread name, 1 to 100 characters.'),
      auto_archive_duration: z
        .union([z.literal(60), z.literal(1440), z.literal(4320), z.literal(10080)])
        .optional()
        .describe('Minutes of inactivity before the thread archives: 60, 1440, 4320, or 10080.'),
      rate_limit_per_user: z
        .number()
        .int()
        .min(0)
        .max(21600)
        .optional()
        .describe('Seconds each member must wait between posts, 0 to 21600.'),
    },
  }, async ({ channel_id, message_id, name, auto_archive_duration, rate_limit_per_user }) => {
    const payload: Record<string, unknown> = { name }
    if (auto_archive_duration !== undefined) payload['auto_archive_duration'] = auto_archive_duration
    if (rate_limit_per_user !== undefined) payload['rate_limit_per_user'] = rate_limit_per_user
    const anchored = message_id !== undefined
    const path = anchored ? `/channels/${channel_id}/messages/${message_id}/threads` : `/channels/${channel_id}/threads`
    const body = anchored ? payload : { ...payload, type: 11 }
    const thread = await ctx.rest.request<DiscordChannel>('POST', path, { body })
    return toolText(`thread ${thread.id} named "${name}" in channel ${channel_id}`)
  })
}
