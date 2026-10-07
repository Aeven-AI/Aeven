/** The served tool surface: its exact names, and which of the two surfaces a process registers. */

import { afterEach, describe, expect, it } from 'vitest'
import { DISCORD_ADMIN_TOOL_NAMES } from '../aeven/admin.ts'
import { MODERATION_TOOL_NAMES } from '../aeven/moderation.ts'
import { DISCORD_CURATED_TOOLS } from '../aeven/tools.ts'
import {
  connectServer,
  refusal,
  resultText,
  servedToolNames,
  stubFetch,
  TEST_ENV,
  TEST_GUILD,
  type FetchStub,
  type Session,
} from './harness.ts'

/** The curated contract, restated here so a rename in `aeven/` fails this suite. */
const CURATED = [
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

/** The administration contract, restated here so a rename in `aeven/` fails this suite. */
const ADMINISTRATION = [
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

/** The moderation contract, restated here so a rename in `aeven/` fails this suite. */
const MODERATION = [
  'kick_member',
  'bulk_ban_members',
  'get_member',
  'edit_member',
  'purge_messages',
  'list_invites',
  'revoke_invite',
  'read_audit_log',
]

const opened: Session[] = []
const strays: FetchStub[] = []

/** Connect a session and remember it for teardown. */
async function open(env = TEST_ENV): Promise<Session> {
  const session = await connectServer(env)
  opened.push(session)
  return session
}

afterEach(async () => {
  for (const session of opened.splice(0)) await session.server.close()
  for (const stray of strays.splice(0)) stray.restore()
})

describe('exported tool names', () => {
  it('names exactly the 13 curated tools', () => {
    expect([...DISCORD_CURATED_TOOLS]).toEqual(CURATED)
    expect(DISCORD_CURATED_TOOLS).toHaveLength(13)
  })

  it('names exactly the 22 administration tools', () => {
    expect([...DISCORD_ADMIN_TOOL_NAMES]).toEqual(ADMINISTRATION)
    expect(DISCORD_ADMIN_TOOL_NAMES).toHaveLength(22)
  })

  it('names exactly the 8 moderation tools', () => {
    expect([...MODERATION_TOOL_NAMES]).toEqual(MODERATION)
    expect(MODERATION_TOOL_NAMES).toHaveLength(8)
  })

  it('keeps the three surfaces apart', () => {
    const curated = new Set(DISCORD_CURATED_TOOLS)
    const administration = new Set(DISCORD_ADMIN_TOOL_NAMES)
    expect(DISCORD_ADMIN_TOOL_NAMES.filter((name) => curated.has(name))).toEqual([])
    expect(MODERATION_TOOL_NAMES.filter((name) => curated.has(name))).toEqual([])
    expect(MODERATION_TOOL_NAMES.filter((name) => administration.has(name))).toEqual([])
  })
})

describe('the served surface', () => {
  it('serves the curated 13 and no administration tool by default', async () => {
    const session = await open()
    expect(await servedToolNames(session)).toEqual(CURATED)
  })

  it('serves the curated 13 and no administration tool for any other DISCORD_ADMIN_TOOLS value', async () => {
    const session = await open({ ...TEST_ENV, DISCORD_ADMIN_TOOLS: 'true' })
    expect(await servedToolNames(session)).toEqual(CURATED)
  })

  it('adds the administration 30 when DISCORD_ADMIN_TOOLS is "1"', async () => {
    const session = await open({ ...TEST_ENV, DISCORD_ADMIN_TOOLS: '1' })
    expect(await servedToolNames(session)).toEqual([...CURATED, ...ADMINISTRATION, ...MODERATION])
  })

  it('describes every tool for a model and takes no guild id anywhere', async () => {
    const session = await open({ ...TEST_ENV, DISCORD_ADMIN_TOOLS: '1' })
    const listed = await session.client.listTools()
    for (const tool of listed.tools) {
      expect(tool.description, tool.name).toBeTruthy()
      expect(Object.keys(tool.inputSchema.properties ?? {}), tool.name).not.toContain('guild_id')
    }
  })
})

describe('a guild the bot cannot see', () => {
  it('reports the bot\'s absence with the status Discord answered, and no response body', async () => {
    strays.push(stubFetch(() => refusal(404)))
    const session = await open()
    const result = await session.client.callTool({ name: 'list_channels', arguments: {} })
    const text = resultText(result)
    expect(result.isError).toBe(true)
    expect(text).toContain(`HTTP 404`)
    expect(text).toContain(TEST_GUILD)
    expect(text).toContain('not in that server')
    expect(text).not.toContain('BODY_SENTINEL')
  })

  it('leaves a channel-level 404 as the plain not-found sentence', async () => {
    strays.push(stubFetch(() => refusal(404)))
    const session = await open()
    const result = await session.client.callTool({
      name: 'get_channel',
      arguments: { channel_id: '100000000000000001' },
    })
    expect(resultText(result)).toContain('Discord holds nothing at this path. (HTTP 404)')
  })
})
