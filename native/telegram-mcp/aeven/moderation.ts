/**
 * Moderation tools: blocking people, reporting spam, and the membership changes an admin makes.
 *
 * Upstream ships none of them. Every tool here acts visibly on a real account, so the connector's
 * approval gate covers all of them; only the two listings are read-only.
 */

import bigInt from 'big-integer'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Api, getClient, resolveChat } from '../source/src/client.ts'
import { fmtDate, peerId } from '../source/src/format.ts'
import type { Entity } from '../source/src/types.ts'
import { chatArg, tool, z } from '../source/src/tools/helpers.ts'
import { chatHintArg, findMember, requireGroup, requireSupergroup, resolveUser, userArg, userLabel } from './refs.ts'
import { ADMIN_RIGHTS, adminRightsFrom, DEFAULT_ADMIN_RIGHTS, noRightsWithheld, removalRights } from './rights.ts'

/** The admin rights `promote_member` accepts, as schema values. */
const adminRightArg = z.enum(Object.keys(ADMIN_RIGHTS) as [string, ...string[]])

/** Whether Telegram currently reports this account as blocked. */
async function isBlocked(user: Entity): Promise<boolean> {
  const client = await getClient()
  const full = await client.invoke(new Api.users.GetFullUser({ id: user }))
  return (full as { fullUser?: { blocked?: boolean } }).fullUser?.blocked === true
}

/** One banned member as a result line: who, and when the ban ends. */
function bannedLine(participant: Api.TypeChannelParticipant, users: Map<string, Entity>): string {
  const banned = participant as Api.ChannelParticipantBanned
  const id = peerId(banned.peer) ?? 'unknown'
  const user = users.get(id)
  const until = banned.bannedRights?.untilDate ?? 0
  const label = user === undefined ? `id ${id}` : userLabel(user)
  return `  • ${label} | ${until === 0 ? 'until an admin lifts it' : `until ${fmtDate(until)}`}`
}

/** Register the blocking, reporting, and member-administration tools. */
export function registerModerationTools(server: McpServer): void {
  tool(
    server,
    'block_contact',
    {
      title: 'Block a user',
      description:
        'Block a person so they can no longer message you or see your last seen, photo, or status. Blocking does not remove them from a group; use kick_member for that.',
      inputSchema: { user: userArg, chat: chatHintArg },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ user, chat }) => {
      const client = await getClient()
      const person = await resolveUser(user, chat)
      await client.invoke(new Api.contacts.Block({ id: person }))
      if (!(await isBlocked(person))) {
        throw new Error(`Telegram still reports ${userLabel(person)} as not blocked.`)
      }
      return `Blocked ${userLabel(person)} — Telegram reports blocked: yes.`
    }
  )

  tool(
    server,
    'unblock_contact',
    {
      title: 'Unblock a user',
      description: 'Unblock a person you blocked, so they can message you again.',
      inputSchema: { user: userArg, chat: chatHintArg },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ user, chat }) => {
      const client = await getClient()
      const person = await resolveUser(user, chat)
      await client.invoke(new Api.contacts.Unblock({ id: person }))
      if (await isBlocked(person)) {
        throw new Error(`Telegram still reports ${userLabel(person)} as blocked.`)
      }
      return `Unblocked ${userLabel(person)} — Telegram reports blocked: no.`
    }
  )

  tool(
    server,
    'list_blocked',
    {
      title: 'List blocked users',
      description: 'List the accounts this Telegram account has blocked.',
      inputSchema: { limit: z.number().int().min(1).max(100).default(50).describe('How many to list.') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ limit }) => {
      const client = await getClient()
      const result = await client.invoke(new Api.contacts.GetBlocked({ offset: 0, limit }))
      const blocked = (result as { blocked?: Api.PeerBlocked[] }).blocked ?? []
      if (blocked.length === 0) return 'No blocked users.'
      const lines = await Promise.all(blocked.map(async entry => {
        const entity = await client.getEntity(entry.peerId).catch(() => undefined)
        const label = entity === undefined ? `id ${peerId(entry.peerId) ?? 'unknown'}` : userLabel(entity as Entity)
        return `  • ${label} | blocked ${fmtDate(entry.date)}`
      }))
      return `${blocked.length} blocked user(s):\n${lines.join('\n')}`
    }
  )

  tool(
    server,
    'report_spam',
    {
      title: 'Report spam',
      description:
        'Report a person, group, or channel to Telegram as spam, the report the Telegram apps send. Telegram decides what follows.',
      inputSchema: { chat: chatArg },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ chat }) => {
      const client = await getClient()
      const { entity, title } = await resolveChat(chat)
      const accepted = await client.invoke(new Api.messages.ReportSpam({ peer: entity }))
      return accepted === false
        ? `Telegram accepted no spam report for "${title}".`
        : `Reported "${title}" to Telegram as spam.`
    }
  )

  tool(
    server,
    'kick_member',
    {
      title: 'Remove a member from a group',
      description:
        'Remove someone from a group. ban=true also bars them from rejoining; ban=false removes them and lets an admin invite them back. revoke_history deletes the messages they sent.',
      inputSchema: {
        chat: chatArg,
        user: userArg,
        ban: z.boolean().default(false).describe('Also bar them from rejoining.'),
        revoke_history: z.boolean().default(false).describe('Also delete the messages they sent here.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ chat, user, ban, revoke_history }) => {
      const client = await getClient()
      const { entity, title } = await resolveChat(chat)
      const target = requireGroup(entity, title)
      const member = await findMember(chat, user)
      if (member === undefined) throw new Error(`No member matching "${user}" in "${title}".`)
      const label = userLabel(member)
      if (member.className === 'User' && member.self) throw new Error(`${label} is your own account.`)
      if (target.kind === 'group') {
        // A basic group has no bans: Telegram removes the member outright.
        await client.invoke(new Api.messages.DeleteChatUser({
          chatId: target.entity.id, userId: member, revokeHistory: revoke_history,
        }))
        return `Removed ${label} from "${title}".`
      }
      await client.invoke(new Api.channels.EditBanned({
        channel: target.entity, participant: member, bannedRights: removalRights(),
      }))
      if (revoke_history) {
        await client.invoke(new Api.channels.DeleteParticipantHistory({ channel: target.entity, participant: member }))
      }
      if (!ban) {
        // Lifting the ban at once leaves them out of the group but able to return through an invite.
        await client.invoke(new Api.channels.EditBanned({
          channel: target.entity, participant: member, bannedRights: noRightsWithheld(),
        }))
        return `Removed ${label} from "${title}" — they can rejoin through an invite link.`
      }
      return `Banned ${label} from "${title}" — they cannot rejoin until an admin lifts the ban.`
    }
  )

  tool(
    server,
    'unban_member',
    {
      title: 'Lift a ban in a supergroup',
      description: 'Lift the ban that keeps someone out of a supergroup, so they can join it again.',
      inputSchema: { chat: chatArg, user: userArg },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ chat, user }) => {
      const client = await getClient()
      const { entity, title } = await resolveChat(chat)
      const channel = requireSupergroup(entity, title)
      // A banned account is not in the member list, so resolve the reference without it.
      const person = await resolveUser(user, chat)
      await client.invoke(new Api.channels.EditBanned({
        channel, participant: person, bannedRights: noRightsWithheld(),
      }))
      return `Lifted the ban on ${userLabel(person)} in "${title}" — they can join again.`
    }
  )

  tool(
    server,
    'list_banned',
    {
      title: 'List banned members',
      description: 'List the accounts banned from a supergroup, and when each ban ends.',
      inputSchema: {
        chat: chatArg,
        limit: z.number().int().min(1).max(200).default(100).describe('How many to list.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ chat, limit }) => {
      const client = await getClient()
      const { entity, title } = await resolveChat(chat)
      const channel = requireSupergroup(entity, title)
      const result = await client.invoke(new Api.channels.GetParticipants({
        channel, filter: new Api.ChannelParticipantsKicked({ q: '' }), offset: 0, limit, hash: bigInt(0),
      })) as Api.channels.ChannelParticipants
      const participants = result.participants
      if (participants.length === 0) return `Nobody is banned from "${title}".`
      const users = new Map(result.users.map(user => [user.id.toString(), user as Entity]))
      return `${participants.length} banned member(s) of "${title}":\n${
        participants.map(participant => bannedLine(participant, users)).join('\n')
      }`
    }
  )

  tool(
    server,
    'promote_member',
    {
      title: 'Promote a member to admin',
      description:
        `Give someone admin rights in a supergroup. Omit rights for the default set: ${DEFAULT_ADMIN_RIGHTS.join(', ')}.`,
      inputSchema: {
        chat: chatArg,
        user: userArg,
        rights: z.array(adminRightArg).min(1).optional().describe('Admin rights to grant; omit for the default set.'),
        rank: z.string().optional().describe('Title shown beside their name, like "Moderator".'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ chat, user, rights, rank }) => {
      const client = await getClient()
      const { entity, title } = await resolveChat(chat)
      const channel = requireSupergroup(entity, title)
      const member = await findMember(chat, user)
      if (member === undefined) throw new Error(`No member matching "${user}" in "${title}".`)
      const granted = rights ?? [...DEFAULT_ADMIN_RIGHTS]
      await client.invoke(new Api.channels.EditAdmin({
        channel, userId: member, adminRights: adminRightsFrom(granted), ...rank === undefined ? {} : { rank },
      }))
      return `Promoted ${userLabel(member)} to admin in "${title}" with ${granted.join(', ')}.`
    }
  )

  tool(
    server,
    'demote_admin',
    {
      title: 'Remove admin rights',
      description: 'Take a member\'s admin rights away, leaving them in the group as an ordinary member.',
      inputSchema: { chat: chatArg, user: userArg },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ chat, user }) => {
      const client = await getClient()
      const { entity, title } = await resolveChat(chat)
      const channel = requireSupergroup(entity, title)
      const person = await resolveUser(user, chat)
      await client.invoke(new Api.channels.EditAdmin({
        channel, userId: person, adminRights: new Api.ChatAdminRights({}),
      }))
      return `Removed the admin rights of ${userLabel(person)} in "${title}".`
    }
  )
}
