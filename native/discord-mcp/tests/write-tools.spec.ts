/** The writing tools: local validation before any request, and the multipart upload body. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { connectServer, json, resultText, stubFetch, TEST_ENV, TEST_GUILD, type FetchStub, type Session } from './harness.ts'

const CHANNEL = '100000000000000001'
const MESSAGE = '200000000000000001'

const strays: FetchStub[] = []
const opened: Session[] = []
const homes: string[] = []

/** Install a fetch stub and remember it for teardown. */
function stub(respond: Parameters<typeof stubFetch>[0]): FetchStub {
  const installed = stubFetch(respond)
  strays.push(installed)
  return installed
}

/** A connected session on the given environment. */
async function open(env = TEST_ENV): Promise<Session> {
  const session = await connectServer(env)
  opened.push(session)
  return session
}

/** A temporary directory holding one file. */
async function scratch(name: string, contents: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'discord-mcp-spec-'))
  homes.push(home)
  const path = join(home, name)
  await writeFile(path, contents)
  return path
}

/**
 * Answer the member and role reads one `list_members` call makes.
 * @param request - the recorded request.
 * @param body - the members to answer with, and the role list.
 * @returns the response.
 */
function route(request: { url: string }, body: { members: unknown[], roles?: unknown[] }): Response {
  if (request.url.includes('/roles')) return json(body.roles ?? [])
  if (request.url.includes('/members-search')) return json({ members: body.members })
  return json(body.members)
}

afterEach(async () => {
  for (const session of opened.splice(0)) await session.server.close()
  for (const stray of strays.splice(0)) stray.restore()
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

describe('send_message', () => {
  it('refuses empty content locally, without any request', async () => {
    const installed = stub(() => json({ id: MESSAGE, channel_id: CHANNEL }))
    const session = await open()
    const result = await session.client.callTool({
      name: 'send_message',
      arguments: { channel_id: CHANNEL, content: '' },
    })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toMatch(/content/u)
    expect(installed.requests).toEqual([])
  })

  it('refuses content over 2000 characters locally, without any request', async () => {
    const installed = stub(() => json({ id: MESSAGE, channel_id: CHANNEL }))
    const session = await open()
    const result = await session.client.callTool({
      name: 'send_message',
      arguments: { channel_id: CHANNEL, content: 'x'.repeat(2001) },
    })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toMatch(/2000/u)
    expect(installed.requests).toEqual([])
  })

  it('accepts exactly 2000 characters and reports the new message', async () => {
    const installed = stub(() => json({ id: MESSAGE, channel_id: CHANNEL }))
    const session = await open()
    const result = await session.client.callTool({
      name: 'send_message',
      arguments: { channel_id: CHANNEL, content: 'x'.repeat(2000) },
    })
    expect(result.isError).toBeFalsy()
    expect(resultText(result)).toBe(
      `message ${MESSAGE} in channel ${CHANNEL} — https://discord.com/channels/${TEST_GUILD}/${CHANNEL}/${MESSAGE}`,
    )
    expect(installed.requests[0]?.method).toBe('POST')
    expect(installed.requests[0]?.url).toBe(`${TEST_ENV['DISCORD_API_BASE']}/channels/${CHANNEL}/messages`)
    expect(installed.requests[0]?.body).toBe(JSON.stringify({ content: 'x'.repeat(2000) }))
  })

  it('refuses a message id that is not a snowflake', async () => {
    const installed = stub(() => json({ id: MESSAGE, channel_id: CHANNEL }))
    const session = await open()
    const result = await session.client.callTool({
      name: 'reply_message',
      arguments: { channel_id: CHANNEL, message_id: 'not-an-id', content: 'hi' },
    })
    expect(result.isError).toBe(true)
    expect(installed.requests).toEqual([])
  })

  it('references the answered message when replying', async () => {
    const installed = stub(() => json({ id: MESSAGE, channel_id: CHANNEL }))
    const session = await open()
    await session.client.callTool({
      name: 'reply_message',
      arguments: { channel_id: CHANNEL, message_id: MESSAGE, content: 'answering' },
    })
    expect(installed.requests[0]?.body).toBe(JSON.stringify({
      content: 'answering',
      message_reference: { message_id: MESSAGE, channel_id: CHANNEL, fail_if_not_exists: false },
    }))
  })
})

describe('send_file', () => {
  it('uploads one file as multipart with payload_json and files[0]', async () => {
    const path = await scratch('notes.txt', 'hello')
    const installed = stub(() => json({ id: MESSAGE, channel_id: CHANNEL }))
    const session = await open()
    const result = await session.client.callTool({
      name: 'send_file',
      arguments: { channel_id: CHANNEL, file_path: path, caption: 'a caption', reply_to_message_id: MESSAGE },
    })

    expect(result.isError).toBeFalsy()
    const request = installed.requests[0]
    expect(request?.method).toBe('POST')
    expect(request?.url).toBe(`${TEST_ENV['DISCORD_API_BASE']}/channels/${CHANNEL}/messages`)
    // The multipart boundary is fetch's to set; the client must not claim a content type of its own.
    expect(request?.headers['content-type']).toBeUndefined()
    expect(request?.headers['authorization']).toBe('Bot spec-bot-token')

    const form = request?.body
    expect(form).toBeInstanceOf(FormData)
    const body = form as FormData
    expect(body.get('payload_json')).toBe(JSON.stringify({
      content: 'a caption',
      message_reference: { message_id: MESSAGE, channel_id: CHANNEL, fail_if_not_exists: false },
    }))
    const uploaded = body.get('files[0]')
    expect(uploaded).toBeInstanceOf(Blob)
    expect((uploaded as File).name).toBe('notes.txt')
    expect(await (uploaded as File).text()).toBe('hello')
    expect(resultText(result)).toContain(`https://discord.com/channels/${TEST_GUILD}/${CHANNEL}/${MESSAGE}`)
  })

  it('sends an empty payload beside the file when no caption or reply is given', async () => {
    const path = await scratch('plain.bin', 'bytes')
    const installed = stub(() => json({ id: MESSAGE, channel_id: CHANNEL }))
    const session = await open()
    await session.client.callTool({ name: 'send_file', arguments: { channel_id: CHANNEL, file_path: path } })
    const body = installed.requests[0]?.body as FormData
    expect(body.get('payload_json')).toBe('{}')
    expect((body.get('files[0]') as File).name).toBe('plain.bin')
  })

  it('refuses a missing file with a clear message and no request', async () => {
    const installed = stub(() => json({ id: MESSAGE, channel_id: CHANNEL }))
    const session = await open()
    const result = await session.client.callTool({
      name: 'send_file',
      arguments: { channel_id: CHANNEL, file_path: join(tmpdir(), 'discord-mcp-absent', 'nope.txt') },
    })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toMatch(/No readable file exists at the given path/u)
    expect(installed.requests).toEqual([])
  })

  it('refuses a file over the configured cap, without reading it into a request', async () => {
    const path = await scratch('big.txt', 'x'.repeat(64))
    const installed = stub(() => json({ id: MESSAGE, channel_id: CHANNEL }))
    const session = await open({ ...TEST_ENV, DISCORD_MAX_FILE_BYTES: '8' })
    const result = await session.client.callTool({
      name: 'send_file',
      arguments: { channel_id: CHANNEL, file_path: path },
    })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toMatch(/larger than this connector may upload/u)
    expect(installed.requests).toEqual([])
  })
})

describe('create_thread', () => {
  it('anchors a thread on a message when one is named', async () => {
    const installed = stub(() => json({ id: '400000000000000001', name: 'topic' }))
    const session = await open()
    await session.client.callTool({
      name: 'create_thread',
      arguments: { channel_id: CHANNEL, message_id: MESSAGE, name: 'topic', auto_archive_duration: 1440 },
    })
    expect(installed.requests[0]?.url).toBe(`${TEST_ENV['DISCORD_API_BASE']}/channels/${CHANNEL}/messages/${MESSAGE}/threads`)
    expect(installed.requests[0]?.body).toBe(JSON.stringify({ name: 'topic', auto_archive_duration: 1440 }))
  })

  it('creates a standalone public thread of type 11 when no message is named', async () => {
    const installed = stub(() => json({ id: '400000000000000001', name: 'topic' }))
    const session = await open()
    await session.client.callTool({ name: 'create_thread', arguments: { channel_id: CHANNEL, name: 'topic' } })
    expect(installed.requests[0]?.url).toBe(`${TEST_ENV['DISCORD_API_BASE']}/channels/${CHANNEL}/threads`)
    expect(installed.requests[0]?.body).toBe(JSON.stringify({ name: 'topic', type: 11 }))
  })
})

describe('reactions', () => {
  it('percent-encodes a custom emoji in the path segment', async () => {
    const installed = stub(() => new Response(null, { status: 204 }))
    const session = await open()
    await session.client.callTool({
      name: 'add_reaction',
      arguments: { channel_id: CHANNEL, message_id: MESSAGE, emoji: 'party:1234567890123456789' },
    })
    expect(installed.requests[0]?.url).toBe(
      `${TEST_ENV['DISCORD_API_BASE']}/channels/${CHANNEL}/messages/${MESSAGE}/reactions/party%3A1234567890123456789/@me`,
    )
    expect(installed.requests[0]?.method).toBe('PUT')
  })

  it('removes the bot\'s own reaction with DELETE on the same path', async () => {
    const installed = stub(() => new Response(null, { status: 204 }))
    const session = await open()
    await session.client.callTool({
      name: 'remove_reaction',
      arguments: { channel_id: CHANNEL, message_id: MESSAGE, emoji: '👍' },
    })
    expect(installed.requests[0]?.method).toBe('DELETE')
    expect(installed.requests[0]?.url).toBe(
      `${TEST_ENV['DISCORD_API_BASE']}/channels/${CHANNEL}/messages/${MESSAGE}/reactions/${encodeURIComponent('👍')}/@me`,
    )
  })
})

describe('list_members', () => {
  it('names the Server Members intent when Discord refuses the member list', async () => {
    stub(() => json({ message: 'Missing Permissions', code: 50013 }, 403))
    const session = await open()
    const result = await session.client.callTool({ name: 'list_members', arguments: {} })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('Server Members privileged intent')
    expect(resultText(result)).not.toContain('Missing Permissions')
  })

  it('searches by name through the members-search endpoint when a query is given', async () => {
    const installed = stub((request) => route(request, { members: [{ user: { id: '555555555555555555', username: 'tammy' }, roles: [] }] }))
    const session = await open()
    const result = await session.client.callTool({ name: 'list_members', arguments: { query: 'tam', limit: 5 } })
    expect(installed.requests[0]?.url).toBe(`${TEST_ENV['DISCORD_API_BASE']}/guilds/${TEST_GUILD}/members-search`)
    expect(installed.requests[0]?.method).toBe('POST')
    expect(installed.requests[0]?.body).toBe(JSON.stringify({ query: 'tam', limit: 5 }))
    expect(resultText(result)).toContain('tammy')
  })

  it('pages the plain member list with a user-id cursor', async () => {
    const installed = stub((request) => route(request, { members: [{ user: { id: '555555555555555555', username: 'tammy' }, roles: [] }] }))
    const session = await open()
    await session.client.callTool({ name: 'list_members', arguments: { limit: 10, after: '444444444444444444' } })
    expect(installed.requests[0]?.url).toBe(
      `${TEST_ENV['DISCORD_API_BASE']}/guilds/${TEST_GUILD}/members?limit=10&after=444444444444444444`,
    )
  })

  it('names each member\'s roles from the guild role list', async () => {
    const members = [{ user: { id: '555555555555555555', username: 'tammy' }, roles: ['666666666666666666'] }]
    stub((request) => route(request, { members, roles: [{ id: '666666666666666666', name: 'moderators' }] }))
    const session = await open()
    const result = await session.client.callTool({ name: 'list_members', arguments: {} })
    expect(resultText(result)).toContain('roles: moderators')
  })
})
