/** The moderation tools: local validation before any request, selection, and how Discord's answers are reported. */

import { afterEach, describe, expect, it } from 'vitest'
import {
  connectServer,
  json,
  refusal,
  resultText,
  stubFetch,
  TEST_ENV,
  TEST_GUILD,
  type FetchStub,
  type RecordedRequest,
  type Session,
} from './harness.ts'

const BASE = TEST_ENV['DISCORD_API_BASE'] ?? ''
const CHANNEL = '100000000000000001'
const VOICE = '100000000000000002'
const USER_A = '300000000000000001'
const USER_B = '300000000000000002'
const ROLE = '400000000000000001'
const RULE = '500000000000000001'

/** Ids of the four messages the purge reads, in the newest-first order Discord answers with. */
const MINE_FIRST = '200000000000000001'
const THEIRS = '200000000000000002'
const MINE_REFUSED = '200000000000000003'
const MINE_GONE = '200000000000000004'

const opened: Session[] = []
const strays: FetchStub[] = []

/** Install a fetch stub and remember it for teardown. */
function stub(respond: (request: RecordedRequest) => Response | Promise<Response>): FetchStub {
  const installed = stubFetch(respond)
  strays.push(installed)
  return installed
}

/** A session serving the administration surface on the given environment. */
async function open(env = TEST_ENV): Promise<Session> {
  const session = await connectServer({ ...env, DISCORD_ADMIN_TOOLS: '1' })
  opened.push(session)
  return session
}

/** A fence around the given text, at the given kind. */
function fence(kind: string, body: string): RegExp {
  return new RegExp(`<untrusted_discord_${kind} nonce="[0-9a-f]{16}">[\\s\\S]*${body}[\\s\\S]*</untrusted_discord_${kind}>`, 'u')
}

afterEach(async () => {
  for (const session of opened.splice(0)) await session.server.close()
  for (const stray of strays.splice(0)) stray.restore()
})

describe('purge_messages', () => {
  it('deletes only the selected author\'s messages and counts deleted, gone, and refused', async () => {
    const installed = stub((request) => {
      if (request.method === 'GET') {
        return json([
          { id: MINE_FIRST, author: { id: USER_A } },
          { id: THEIRS, author: { id: USER_B } },
          { id: MINE_REFUSED, author: { id: USER_A } },
          { id: MINE_GONE, author: { id: USER_A } },
        ])
      }
      if (request.url.endsWith(MINE_REFUSED)) return refusal(403)
      if (request.url.endsWith(MINE_GONE)) return refusal(404)
      return new Response(null, { status: 204 })
    })
    const session = await open()
    const result = await session.client.callTool({
      name: 'purge_messages',
      arguments: { channel_id: CHANNEL, count: 100, user_id: USER_A },
    })

    expect(result.isError).toBeFalsy()
    expect(installed.requests[0]?.method).toBe('GET')
    expect(installed.requests[0]?.url).toBe(`${BASE}/channels/${CHANNEL}/messages?limit=100`)
    expect(installed.requests.filter((request) => request.method === 'DELETE').map((request) => request.url)).toEqual([
      `${BASE}/channels/${CHANNEL}/messages/${MINE_FIRST}`,
      `${BASE}/channels/${CHANNEL}/messages/${MINE_REFUSED}`,
      `${BASE}/channels/${CHANNEL}/messages/${MINE_GONE}`,
    ])

    const text = resultText(result)
    expect(text).toContain('examined 4 messages, selected 3 messages')
    expect(text).toContain('deleted 1 — already gone 1 — refused 1')
    expect(text).not.toContain('BODY_SENTINEL')
  })
})

describe('bulk_ban_members', () => {
  it('submits the ids and reports Discord\'s failures by id, never the raw body', async () => {
    const installed = stub(() => json({ banned_users: [USER_A], failed_users: [USER_B] }, 201))
    const session = await open()
    const result = await session.client.callTool({
      name: 'bulk_ban_members',
      arguments: { user_ids: [USER_A, USER_B], delete_message_seconds: 3600 },
    })

    expect(result.isError).toBeFalsy()
    expect(installed.requests[0]?.method).toBe('POST')
    expect(installed.requests[0]?.url).toBe(`${BASE}/guilds/${TEST_GUILD}/bulk-ban`)
    expect(installed.requests[0]?.body).toBe(
      JSON.stringify({ user_ids: [USER_A, USER_B], delete_message_seconds: 3600 }),
    )

    const text = resultText(result)
    expect(text).toContain('submitted for 2 accounts')
    expect(text).toContain('banned by Discord: 1')
    expect(text).toContain(`failed: ${USER_B}`)
  })

  it('refuses a single-account call and one over Discord\'s cap, without any request', async () => {
    const installed = stub(() => json({}, 201))
    const session = await open()
    const single = await session.client.callTool({ name: 'bulk_ban_members', arguments: { user_ids: [] } })
    expect(single.isError).toBe(true)
    const many = await session.client.callTool({
      name: 'bulk_ban_members',
      arguments: { user_ids: Array.from({ length: 201 }, () => USER_A) },
    })
    expect(many.isError).toBe(true)
    expect(installed.requests).toEqual([])
  })
})

describe('get_ban', () => {
  it('reports a 404 as the account not being banned', async () => {
    stub(() => refusal(404))
    const session = await open()
    const result = await session.client.callTool({ name: 'get_ban', arguments: { user_id: USER_A } })
    expect(result.isError).toBeFalsy()
    expect(resultText(result)).toBe(`account ${USER_A} is not banned from guild ${TEST_GUILD}`)
  })

  it('fences the banned name and the recorded reason', async () => {
    stub(() => json({ user: { id: USER_A, username: 'tammy' }, reason: 'advertising' }))
    const session = await open()
    const result = await session.client.callTool({ name: 'get_ban', arguments: { user_id: USER_A } })
    const text = resultText(result)
    expect(text).toContain(`ban of account ${USER_A}`)
    expect(text).toMatch(fence('bans', 'tammy'))
    expect(text).toMatch(fence('bans', 'advertising'))
  })
})

describe('get_member', () => {
  it('renders the timeout window, the join date, the role ids, and the voice state', async () => {
    stub(() => json({
      user: { id: USER_A, username: 'tammy', global_name: 'Tammy' },
      nick: 'Tam',
      joined_at: '2024-01-02T03:04:05.000Z',
      roles: [ROLE],
      communication_disabled_until: '2999-01-01T00:00:00.000Z',
      mute: true,
      deaf: false,
    }))
    const session = await open()
    const result = await session.client.callTool({ name: 'get_member', arguments: { user_id: USER_A } })
    const text = resultText(result)

    expect(result.isError).toBeFalsy()
    expect(text).toContain(`member ${USER_A} in guild ${TEST_GUILD}`)
    expect(text).toMatch(fence('members', 'display name: Tammy'))
    expect(text).toContain('nickname: Tam')
    expect(text).toContain('joined: 2024-01-02T03:04:05.000Z')
    expect(text).toContain(`roles: ${ROLE}`)
    expect(text).toContain('timed out: until 2999-01-01T00:00:00.000Z')
    expect(text).toContain('mute: true')
    expect(text).toContain('deaf: false')
  })

  it('reports no timeout when Discord carries no active one', async () => {
    stub(() => json({ user: { id: USER_A, username: 'tammy' }, communication_disabled_until: null }))
    const session = await open()
    const result = await session.client.callTool({ name: 'get_member', arguments: { user_id: USER_A } })
    expect(resultText(result)).toContain('timed out: no')
  })
})

describe('edit_member', () => {
  it('refuses an empty change set before any request', async () => {
    const installed = stub(() => new Response(null, { status: 204 }))
    const session = await open()
    const result = await session.client.callTool({ name: 'edit_member', arguments: { user_id: USER_A } })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toMatch(/needs at least one of/u)
    expect(installed.requests).toEqual([])
  })

  it('sends a nickname change and reports the changed field', async () => {
    const installed = stub(() => new Response(null, { status: 204 }))
    const session = await open()
    const result = await session.client.callTool({
      name: 'edit_member',
      arguments: { user_id: USER_A, nickname: 'Tam', channel_id: VOICE },
    })
    expect(result.isError).toBeFalsy()
    expect(installed.requests[0]?.method).toBe('PATCH')
    expect(installed.requests[0]?.url).toBe(`${BASE}/guilds/${TEST_GUILD}/members/${USER_A}`)
    expect(installed.requests[0]?.body).toBe(JSON.stringify({ nick: 'Tam', channel_id: VOICE }))
    expect(resultText(result)).toContain('changed in guild')
    expect(resultText(result)).toContain('nick, channel_id')
  })
})

describe('edit_role', () => {
  it('refuses an empty change set before any request', async () => {
    const installed = stub(() => json({}))
    const session = await open()
    const result = await session.client.callTool({ name: 'edit_role', arguments: { role_id: ROLE } })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toMatch(/needs at least one of/u)
    expect(installed.requests).toEqual([])
  })

  it('changes the named fields and returns their names', async () => {
    const installed = stub(() => json({ id: ROLE }))
    const session = await open()
    const result = await session.client.callTool({
      name: 'edit_role',
      arguments: { role_id: ROLE, name: 'moderators', permissions: '1024' },
    })
    expect(result.isError).toBeFalsy()
    expect(installed.requests[0]?.method).toBe('PATCH')
    expect(installed.requests[0]?.url).toBe(`${BASE}/guilds/${TEST_GUILD}/roles/${ROLE}`)
    expect(installed.requests[0]?.body).toBe(JSON.stringify({ name: 'moderators', permissions: '1024' }))
    expect(resultText(result)).toContain('name, permissions')
  })
})

describe('edit_automod_rule', () => {
  it('refuses an empty change set before any request', async () => {
    const installed = stub(() => json({}))
    const session = await open()
    const result = await session.client.callTool({ name: 'edit_automod_rule', arguments: { rule_id: RULE } })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toMatch(/needs at least one of/u)
    expect(installed.requests).toEqual([])
  })

  it('changes the enabled flag and returns its name', async () => {
    const installed = stub(() => json({ id: RULE }))
    const session = await open()
    const result = await session.client.callTool({
      name: 'edit_automod_rule',
      arguments: { rule_id: RULE, enabled: false, exempt_roles: [ROLE] },
    })
    expect(result.isError).toBeFalsy()
    expect(installed.requests[0]?.method).toBe('PATCH')
    expect(installed.requests[0]?.url).toBe(`${BASE}/guilds/${TEST_GUILD}/auto-moderation/rules/${RULE}`)
    expect(installed.requests[0]?.body).toBe(JSON.stringify({ enabled: false, exempt_roles: [ROLE] }))
    expect(resultText(result)).toContain('enabled, exempt_roles')
  })
})

describe('list_invites', () => {
  it('fences the Discord-authored channel name', async () => {
    stub(() => json([{
      code: 'abc123',
      channel: { id: CHANNEL, name: 'secret-lounge' },
      inviter: { id: USER_A, username: 'tammy' },
      uses: 4,
      max_uses: 10,
      temporary: true,
      expires_at: null,
    }]))
    const session = await open()
    const result = await session.client.callTool({ name: 'list_invites', arguments: {} })
    const text = resultText(result)

    expect(result.isError).toBeFalsy()
    expect(text).toContain(`guild ${TEST_GUILD} — 1 invite`)
    expect(text).toMatch(fence('invites', 'secret-lounge'))
    expect(text).toContain('uses: 4 of 10')
    expect(text).toContain('expires: never')
    expect(text).toContain('temporary: true')
  })
})

describe('revoke_invite', () => {
  it('rejects a malformed code before any request', async () => {
    const installed = stub(() => new Response(null, { status: 204 }))
    const session = await open()
    for (const code of ['not a code', 'x'.repeat(101), '']) {
      const result = await session.client.callTool({ name: 'revoke_invite', arguments: { code } })
      expect(result.isError, code).toBe(true)
    }
    expect(installed.requests).toEqual([])
  })

  it('revokes a well-formed code and records the reason', async () => {
    const installed = stub(() => new Response(null, { status: 204 }))
    const session = await open()
    const result = await session.client.callTool({
      name: 'revoke_invite',
      arguments: { code: 'abc-123', reason: 'leaked publicly' },
    })
    expect(result.isError).toBeFalsy()
    expect(installed.requests[0]?.method).toBe('DELETE')
    expect(installed.requests[0]?.url).toBe(`${BASE}/invites/abc-123`)
    expect(installed.requests[0]?.headers['X-Audit-Log-Reason']).toBe(encodeURIComponent('leaked publicly'))
    expect(resultText(result)).toBe('invite abc-123 revoked')
  })
})

describe('read_audit_log', () => {
  it('names a known action type, prints an unknown one, and fences the reason', async () => {
    const installed = stub(() => json({
      audit_log_entries: [
        { id: '1490000000000000000', action_type: 20, user_id: USER_A, target_id: USER_B, reason: 'spam' },
        { id: '1490000000000000001', action_type: 999, user_id: null, target_id: null, reason: null },
      ],
    }))
    const session = await open()
    const result = await session.client.callTool({ name: 'read_audit_log', arguments: {} })
    const text = resultText(result)

    expect(result.isError).toBeFalsy()
    expect(installed.requests[0]?.url).toBe(`${BASE}/guilds/${TEST_GUILD}/audit-logs?limit=25`)
    expect(text).toContain('2 audit-log entries')
    expect(text).toMatch(fence('audit_log', 'MEMBER_KICK'))
    expect(text).toContain(`actor: ${USER_A} — target: ${USER_B}`)
    expect(text).toContain('actor: unknown id — target: none')
    expect(text).toMatch(/created: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/u)
    expect(text).toContain('999')
    expect(text).toMatch(fence('audit_log', 'reason: spam'))
  })

  it('passes the action, actor, and limit filters to Discord', async () => {
    const installed = stub(() => json({ audit_log_entries: [] }))
    const session = await open()
    await session.client.callTool({
      name: 'read_audit_log',
      arguments: { limit: 5, action_type: 22, user_id: USER_A },
    })
    expect(installed.requests[0]?.url).toBe(
      `${BASE}/guilds/${TEST_GUILD}/audit-logs?limit=5&action_type=22&user_id=${USER_A}`,
    )
  })
})
