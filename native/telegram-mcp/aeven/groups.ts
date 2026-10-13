/**
 * Group and channel administration: creating, joining, leaving, and the settings an admin changes.
 *
 * Upstream ships none of them. Everything here acts visibly on a real account, so the connector's
 * approval gate covers all of it; only the invite listing is read-only.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Api, entityName, getClient, getMe, markedId, resolveChat } from '../source/src/client.ts'
import { fmtDate, parseTime, unix } from '../source/src/format.ts'
import type { Entity } from '../source/src/types.ts'
import { chatArg, tool, z } from '../source/src/tools/helpers.ts'
import { requireGroup, resolveUser, userArg, userLabel } from './refs.ts'
import { ALL_MESSAGES, RESTRICTION_NAMES, withheldRights } from './rights.ts'

/** The restrictions `set_group_permissions` accepts, as schema values. */
const restrictionArg = z.enum(RESTRICTION_NAMES as [string, ...string[]])

/** A time the caller named, refused when it is not in the future. */
function futureDate(value: string | undefined, label: string): Date | undefined {
  const date = parseTime(value, { label, direction: 'future' })
  if (date !== undefined && date.getTime() <= Date.now()) throw new Error(`${label} must be in the future.`)
  return date
}

/** One invite link as a result line. */
function inviteLine(invite: Api.TypeExportedChatInvite): string {
  const exported = invite as Api.ChatInviteExported
  const bits = [exported.link]
  if (exported.title) bits.push(`"${exported.title}"`)
  if (exported.usageLimit) bits.push(`${exported.usage ?? 0} of ${exported.usageLimit} uses`)
  else if (exported.usage) bits.push(`${exported.usage} uses`)
  if (exported.expireDate) bits.push(`expires ${fmtDate(exported.expireDate)}`)
  if (exported.requestNeeded) bits.push('approval required')
  if (exported.permanent) bits.push('primary link')
  if (exported.revoked) bits.push('revoked')
  return `  • ${bits.join(' | ')}`
}

/** The standing invite link Telegram keeps on the full chat, for a group that has one. */
async function primaryInvite(entity: Entity): Promise<string | undefined> {
  const client = await getClient()
  const full = entity.className === 'Channel'
    ? await client.invoke(new Api.channels.GetFullChannel({ channel: entity }))
    : await client.invoke(new Api.messages.GetFullChat({ chatId: entity.id }))
  const chatFull = (full as { fullChat?: { exportedInvite?: { link?: string } } }).fullChat
  return chatFull?.exportedInvite?.link
}

/** Register the group, channel, and invite tools. */
export function registerGroupTools(server: McpServer): void {
  tool(
    server,
    'create_group',
    {
      title: 'Create a group',
      description: 'Create a basic group with the named people in it.',
      inputSchema: {
        title: z.string().min(1).describe('Group name.'),
        users: z.array(userArg).min(1).describe('People to add.'),
        about: z.string().optional().describe('Description shown on the group profile.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ title, users, about }) => {
      const client = await getClient()
      const invited = await Promise.all(users.map(async user => await resolveUser(user)))
      const result = await client.invoke(new Api.messages.CreateChat({ users: invited, title }))
      const updates = (result as { updates?: { chats?: Entity[], users?: Entity[] } }).updates
      const chat = updates?.chats?.[0]
      if (about !== undefined && chat !== undefined) {
        await client.invoke(new Api.messages.EditChatAbout({ peer: chat, about }))
      }
      const known = new Map((updates?.users ?? []).map(user => [user.id.toString(), user]))
      const rejected = ((result as { missingInvitees?: Api.MissingInvitee[] }).missingInvitees ?? [])
        .map(entry => known.get(entry.userId.toString()) ?? `id ${entry.userId.toString()}`)
      const note = rejected.length === 0
        ? ''
        : ` ${rejected.map(entry => typeof entry === 'string' ? entry : userLabel(entry)).join(', ')} could not be added.`
      return `Created group "${chat === undefined ? title : entityName(chat)}"${
        chat === undefined ? '' : ` (id ${markedId(chat)})`
      }.${note}`
    }
  )

  tool(
    server,
    'join_chat',
    {
      title: 'Join a group or channel',
      description: 'Join through an invite link, or a public group or channel by its @username.',
      inputSchema: {
        link: z.string().describe('Invite link (t.me/+hash or t.me/joinchat/hash), @username, or t.me link.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ link }) => {
      const client = await getClient()
      const key = link.trim()
      const invite = /^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:joinchat\/|\+)([A-Za-z0-9_-]+)$/.exec(key)
        ?? /^\+([A-Za-z0-9_-]+)$/.exec(key)
      if (invite !== null) {
        await client.invoke(new Api.messages.ImportChatInvite({ hash: invite[1] as string }))
        return 'Joined through the invite link.'
      }
      const { entity, title } = await resolveChat(key)
      if (entity.className !== 'Channel') {
        throw new Error(`"${title}" is a basic group; joining it takes an invite link.`)
      }
      await client.invoke(new Api.channels.JoinChannel({ channel: entity }))
      return `Joined "${title}".`
    }
  )

  tool(
    server,
    'leave_chat',
    {
      title: 'Leave a group or channel',
      description: 'Leave a group or channel you are in. An owner has to hand the group over or delete it first.',
      inputSchema: { chat: chatArg },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ chat }) => {
      const client = await getClient()
      const { entity, title } = await resolveChat(chat)
      const target = requireGroup(entity, title)
      if (target.kind === 'supergroup') {
        await client.invoke(new Api.channels.LeaveChannel({ channel: target.entity }))
      } else {
        await client.invoke(new Api.messages.DeleteChatUser({ chatId: target.entity.id, userId: await getMe() }))
      }
      return `Left "${title}".`
    }
  )

  tool(
    server,
    'set_group_info',
    {
      title: 'Change a group name or description',
      description: 'Set the name or the description of a group or channel. Takes the change-info admin right.',
      inputSchema: {
        chat: chatArg,
        title: z.string().min(1).optional().describe('New group name.'),
        about: z.string().optional().describe('New description; an empty string clears it.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ chat, title, about }) => {
      if (title === undefined && about === undefined) throw new Error('Set `title`, `about`, or both.')
      const client = await getClient()
      const { entity, title: current } = await resolveChat(chat)
      const target = requireGroup(entity, current)
      const changed: string[] = []
      if (title !== undefined) {
        await client.invoke(target.kind === 'supergroup'
          ? new Api.channels.EditTitle({ channel: target.entity, title })
          : new Api.messages.EditChatTitle({ chatId: target.entity.id, title }))
        changed.push(`name to "${title}"`)
      }
      if (about !== undefined) {
        await client.invoke(new Api.messages.EditChatAbout({ peer: entity, about }))
        changed.push('description')
      }
      return `Updated the ${changed.join(' and the ')} of "${current}".`
    }
  )

  tool(
    server,
    'set_group_permissions',
    {
      title: 'Restrict what members may do',
      description:
        `Replace the rights withheld from every member of a group. Names: ${RESTRICTION_NAMES.join(', ')}, where ${ALL_MESSAGES} covers every posting right. Pass none to let members do everything their admin rights allow.`,
      inputSchema: {
        chat: chatArg,
        withheld: z.array(restrictionArg).describe('Rights withheld from members.'),
        until: z.string().optional().describe("When the restriction lifts: ISO timestamp or an offset like '7d'. Omit to keep it until an admin lifts it."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ chat, withheld, until }) => {
      const client = await getClient()
      const { entity, title } = await resolveChat(chat)
      requireGroup(entity, title)
      const lifts = futureDate(until, 'until')
      await client.invoke(new Api.messages.EditChatDefaultBannedRights({
        peer: entity, bannedRights: withheldRights(withheld, lifts === undefined ? 0 : unix(lifts)),
      }))
      if (withheld.length === 0) return `Members of "${title}" may do everything their admin rights allow.`
      return `Withheld ${withheld.join(', ')} from members of "${title}"${
        lifts === undefined ? '' : ` until ${fmtDate(unix(lifts))}`
      }.`
    }
  )

  tool(
    server,
    'create_invite_link',
    {
      title: 'Create an invite link',
      description: 'Create an invite link for a group or channel, optionally limited in time or uses, or held for approval.',
      inputSchema: {
        chat: chatArg,
        name: z.string().optional().describe('Label for the link, visible to admins only.'),
        expires_at: z.string().optional().describe("When the link stops working: ISO timestamp or an offset like '7d'."),
        usage_limit: z.number().int().min(1).optional().describe('How many people may join through it.'),
        request_approval: z.boolean().default(false).describe('New joiners wait for an admin to approve them.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ chat, name, expires_at, usage_limit, request_approval }) => {
      const client = await getClient()
      const { entity, title } = await resolveChat(chat)
      requireGroup(entity, title)
      const expires = futureDate(expires_at, 'expires_at')
      const invite = await client.invoke(new Api.messages.ExportChatInvite({
        peer: entity,
        ...name === undefined ? {} : { title: name },
        ...expires === undefined ? {} : { expireDate: unix(expires) },
        ...usage_limit === undefined ? {} : { usageLimit: usage_limit },
        requestNeeded: request_approval,
      })) as Api.ChatInviteExported
      const terms = [
        expires === undefined ? '' : `expires ${fmtDate(unix(expires))}`,
        usage_limit === undefined ? '' : `${usage_limit} uses`,
        request_approval ? 'joiners need approval' : '',
      ].filter(Boolean)
      return `Invite link for "${title}": ${invite.link}${terms.length === 0 ? '' : ` (${terms.join(', ')})`}.`
    }
  )

  tool(
    server,
    'list_invite_links',
    {
      title: 'List invite links',
      description: "List the invite links of a group or channel: its standing link, and the links you created.",
      inputSchema: {
        chat: chatArg,
        revoked: z.boolean().default(false).describe('List revoked links instead of active ones.'),
        limit: z.number().int().min(1).max(100).default(50).describe('How many links to list.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ chat, revoked, limit }) => {
      const client = await getClient()
      const { entity, title } = await resolveChat(chat)
      requireGroup(entity, title)
      const standing = revoked ? undefined : await primaryInvite(entity)
      const result = await client.invoke(new Api.messages.GetExportedChatInvites({
        peer: entity, adminId: await getMe(), limit, revoked,
      })) as Api.messages.ExportedChatInvites
      const lines = result.invites.map(inviteLine)
      if (standing !== undefined) lines.unshift(`  • ${standing} | the group's standing link`)
      if (lines.length === 0) return `"${title}" has no ${revoked ? 'revoked' : 'active'} invite links you can see.`
      return `Invite links for "${title}":\n${lines.join('\n')}`
    }
  )

  tool(
    server,
    'revoke_invite_link',
    {
      title: 'Revoke an invite link',
      description: 'Revoke an invite link so it stops admitting people. Anyone already in the group stays.',
      inputSchema: { chat: chatArg, link: z.string().describe('The invite link to revoke.') },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ chat, link }) => {
      const client = await getClient()
      const { entity, title } = await resolveChat(chat)
      requireGroup(entity, title)
      await client.invoke(new Api.messages.EditExportedChatInvite({
        peer: entity, link: link.trim(), revoked: true,
      }))
      return `Revoked ${link.trim()} for "${title}".`
    }
  )
}
