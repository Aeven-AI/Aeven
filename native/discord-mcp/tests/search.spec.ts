/** `search_messages`: the readable-text filter, and the coverage line the scan budget produces. */

import { afterEach, describe, expect, it } from 'vitest'
import type { DiscordMessage } from '../aeven/refs.ts'
import { connectServer, json, resultText, stubFetch, TEST_ENV, TEST_GUILD, type FetchStub, type Session } from './harness.ts'

const GENERAL = '100000000000000001'
const ANNOUNCEMENTS = '100000000000000002'
const VOICE = '100000000000000003'

const CHANNELS = [
  { id: GENERAL, name: 'general', type: 0 },
  { id: ANNOUNCEMENTS, name: 'announcements', type: 5 },
  { id: VOICE, name: 'voice', type: 2 },
]

/** A message with the given id, channel, and readable text. */
function message(id: string, channelId: string, content: string, extra: Partial<DiscordMessage> = {}): DiscordMessage {
  return {
    id,
    channel_id: channelId,
    content,
    author: { id: '333333333333333333', username: 'tammy', global_name: 'Tammy' },
    timestamp: '2026-10-07T00:00:00.000Z',
    ...extra,
  }
}

/** Nothing readable in `content`; the text lives in a Components V2 `TextDisplay`. */
const COMPONENT_ONLY = message('200000000000000002', GENERAL, '', {
  components: [{ type: 10, content: 'Launch date confirmed' }, { type: 1, components: [{ type: 10, content: 'nested launch note' }] }],
})

const BY_CHANNEL = new Map<string, DiscordMessage[]>([
  [GENERAL, [message('200000000000000001', GENERAL, 'The LAUNCH plan is ready'), COMPONENT_ONLY]],
  [ANNOUNCEMENTS, [message('200000000000000003', ANNOUNCEMENTS, 'unrelated chatter')]],
  [VOICE, [message('200000000000000004', VOICE, 'launch in voice')]],
])

const strays: FetchStub[] = []
const opened: Session[] = []

/** Route every request a search a search makes, counting per-channel pages. */
function installRouting(): { stub: FetchStub, pages: string[] } {
  const pages: string[] = []
  const stub = stubFetch((request) => {
    const url = new URL(request.url)
    const pathname = url.pathname.slice(new URL(TEST_ENV['DISCORD_API_BASE'] ?? '').pathname.length)
    if (pathname === `/guilds/${TEST_GUILD}/channels`) return json(CHANNELS)
    const byId = /^\/channels\/(\d+)$/u.exec(pathname)
    if (byId !== null) {
      const found = CHANNELS.find((channel) => channel.id === byId[1])
      return found === undefined ? json({ message: 'unknown channel' }, 404) : json(found)
    }
    const perChannel = /^\/channels\/(\d+)\/messages$/u.exec(pathname)
    if (perChannel !== null) {
      const channelId = perChannel[1] ?? ''
      pages.push(`${channelId}${url.search}`)
      return json(BY_CHANNEL.get(channelId) ?? [])
    }
    throw new Error(`unexpected request ${request.url}`)
  })
  strays.push(stub)
  return { stub, pages }
}

/** A connected session on the given environment. */
async function open(env = TEST_ENV): Promise<Session> {
  const session = await connectServer(env)
  opened.push(session)
  return session
}

afterEach(async () => {
  for (const session of opened.splice(0)) await session.server.close()
  for (const stray of strays.splice(0)) stray.restore()
})

describe('search_messages', () => {
  it('matches a case-insensitive substring of the readable message text', async () => {
    installRouting()
    const session = await open()
    const result = await session.client.callTool({
      name: 'search_messages',
      arguments: { query: 'launch', channel_id: GENERAL, limit: 50, pages: 2 },
    })
    const text = resultText(result)
    expect(text).toContain('2 matches')
    expect(text).toContain('The LAUNCH plan is ready')
    expect(text).toContain('Launch date confirmed')
    expect(text).toContain('nested launch note')
    expect(text).toContain('channel: #general')
    expect(text).toContain(`https://discord.com/channels/${TEST_GUILD}/${GENERAL}/200000000000000001`)
  })

  it('reports matches with the channel they sit in, newest first per channel', async () => {
    installRouting()
    const session = await open()
    const result = await session.client.callTool({
      name: 'search_messages',
      arguments: { query: 'unrelated', channel_id: ANNOUNCEMENTS },
    })
    const text = resultText(result)
    expect(text).toContain('1 match')
    expect(text).toContain('channel: #announcements')
    expect(text).toContain('unrelated chatter')
  })

  it('scans the text and announcement channels of the guild and skips voice', async () => {
    const { pages } = installRouting()
    const session = await open()
    const result = await session.client.callTool({ name: 'search_messages', arguments: { query: 'launch' } })
    expect(pages.map((page) => page.split('?')[0])).toEqual([GENERAL, ANNOUNCEMENTS])
    expect(resultText(result)).not.toContain('launch in voice')
  })

  it('reports a complete scan when the budget was never reached', async () => {
    installRouting()
    const session = await open()
    const result = await session.client.callTool({ name: 'search_messages', arguments: { query: 'launch' } })
    expect(resultText(result)).toContain('coverage: scanned 3 messages across 2 channels — complete')
  })

  it('stops at the configured scan budget and says the scan was bounded', async () => {
    const { pages } = installRouting()
    const session = await open({ ...TEST_ENV, DISCORD_MAX_SCAN_MESSAGES: '4' })
    const result = await session.client.callTool({
      name: 'search_messages',
      arguments: { query: 'launch', channel_id: GENERAL, limit: 2, pages: 5 },
    })
    expect(pages).toHaveLength(2)
    expect(resultText(result))
      .toContain('coverage: scanned 4 messages across 1 channel — bounded by the scan budget of 4 messages')
  })

  it('reports no matches without pretending the scan was empty of messages', async () => {
    installRouting()
    const session = await open()
    const result = await session.client.callTool({
      name: 'search_messages',
      arguments: { query: 'nothing-matches-this', channel_id: GENERAL },
    })
    expect(resultText(result)).toContain('0 matches')
    expect(resultText(result)).toContain('scanned 2 messages across 1 channel — complete')
  })

  it('skips a channel Discord hides from the bot and reports how many it skipped', async () => {
    const stub = stubFetch((request) => {
      const url = new URL(request.url)
      const pathname = url.pathname.slice(new URL(TEST_ENV['DISCORD_API_BASE'] ?? '').pathname.length)
      if (pathname === `/guilds/${TEST_GUILD}/channels`) return json(CHANNELS)
      const byId = /^\/channels\/(\d+)$/u.exec(pathname)
      if (byId !== null) return json(CHANNELS.find((channel) => channel.id === byId[1]) ?? { message: 'unknown' })
      const perChannel = /^\/channels\/(\d+)\/messages$/u.exec(pathname)
      if (perChannel !== null) {
        // The staff channel refuses the bot; the scan has to carry on without it.
        if (perChannel[1] === ANNOUNCEMENTS) return json({ message: 'Missing Permissions' }, 403)
        return json(BY_CHANNEL.get(perChannel[1] ?? '') ?? [])
      }
      throw new Error(`unexpected request ${request.url}`)
    })
    strays.push(stub)
    const session = await open()
    const result = await session.client.callTool({ name: 'search_messages', arguments: { query: 'launch' } })
    const text = resultText(result)
    expect(text).toContain('The LAUNCH plan is ready')
    expect(text).toContain('across 1 channel — complete; 1 channel not visible to the Aeven bot')
  })

  it('fails a named channel the bot cannot read instead of reporting an empty scan', async () => {
    const stub = stubFetch((request) => {
      const url = new URL(request.url)
      const pathname = url.pathname.slice(new URL(TEST_ENV['DISCORD_API_BASE'] ?? '').pathname.length)
      const byId = /^\/channels\/(\d+)$/u.exec(pathname)
      if (byId !== null) return json(CHANNELS.find((channel) => channel.id === byId[1]) ?? { message: 'unknown' })
      if (/^\/channels\/(\d+)\/messages$/u.test(pathname)) return json({ message: 'Missing Permissions' }, 403)
      throw new Error(`unexpected request ${request.url}`)
    })
    strays.push(stub)
    const session = await open()
    const result = await session.client.callTool({
      name: 'search_messages',
      arguments: { query: 'launch', channel_id: ANNOUNCEMENTS },
    })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain(`The Aeven bot cannot read channel ${ANNOUNCEMENTS}`)
  })

  it('rejects an empty query before any request', async () => {
    const { stub } = installRouting()
    const session = await open()
    const result = await session.client.callTool({ name: 'search_messages', arguments: { query: '' } })
    expect(result.isError).toBe(true)
    expect(stub.requests).toEqual([])
  })
})

describe('get_messages', () => {
  it('renders `[id] ISO-time author: text` and refuses two cursors at once', async () => {
    installRouting()
    const session = await open()
    const read = await session.client.callTool({
      name: 'get_messages',
      arguments: { channel_id: GENERAL, limit: 50 },
    })
    expect(resultText(read)).toContain('[200000000000000001] 2026-10-07T00:00:00.000Z Tammy: The LAUNCH plan is ready')

    const before = '200000000000000001'
    const after = '200000000000000002'
    const both = await session.client.callTool({ name: 'get_messages', arguments: { channel_id: GENERAL, before, after } })
    expect(both.isError).toBe(true)
    expect(resultText(both)).toMatch(/before and after cannot be combined/u)
  })

  it('passes one cursor through as a query parameter', async () => {
    const { stub } = installRouting()
    const session = await open()
    await session.client.callTool({ name: 'get_messages', arguments: { channel_id: GENERAL, before: '200000000000000009' } })
    expect(stub.requests.at(-1)?.url).toBe(`${TEST_ENV['DISCORD_API_BASE']}/channels/${GENERAL}/messages?limit=50&before=200000000000000009`)
  })
})
