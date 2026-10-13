/**
 * Shared arguments and entity resolution for the Aeven-owned Telegram tools.
 *
 * Upstream resolves a chat by id, @username, t.me link, "me", or a title fragment. A tool that acts
 * on a person needs the same reach for users, and a way to reach someone who is only visible as a
 * member of a group: Telegram refuses a bare user id without the access hash that arrives with a
 * member list, so the tools that accept people also accept a `chat` to search.
 */

import bigInt from 'big-integer'
import { Api, entityName, getClient, getDialogs, markedId, resolveChat } from '../source/src/client.ts'
import type { Entity } from '../source/src/types.ts'
import { z } from '../source/src/tools/helpers.ts'

/** A person to act on: numeric id, @username, t.me link, or part of a display name. */
export const userArg = z.string().describe('User: numeric id, @username, t.me link, or part of a name.')

/** A chat to search for a person in, for references that do not resolve on their own. */
export const chatHintArg = z
  .string()
  .optional()
  .describe('Chat to search for the person in when an id or name alone does not resolve.')

/** Members read per lookup; Telegram answers with a page rather than the whole roster. */
const MEMBER_PAGE = 200

/** The fields of a user a member reference is matched against. */
export interface MemberLike {
  id: { toString(): string }
  username?: string | null
  firstName?: string | null
  lastName?: string | null
  deleted?: boolean
}

/** A group whose members can be moderated, with the entity narrowed to its kind. */
export type GroupTarget =
  | { kind: 'group', entity: Api.Chat | Api.ChatForbidden }
  | { kind: 'supergroup', entity: Api.Channel }

/** How a person is named in a tool result: display name, handle, and id. */
export function userLabel(user: Entity): string {
  const username = user.className === 'User' && user.username ? ` (@${user.username})` : ''
  return `${entityName(user)}${username}, id ${markedId(user)}`
}

/** A member's display name, or what is left of the account when the name is gone. */
function displayName(member: MemberLike): string {
  const name = [member.firstName, member.lastName].filter(Boolean).join(' ')
  if (name !== '') return name
  return member.deleted === true ? 'Deleted account' : member.id.toString()
}

/** The id a reference names, without Telegram's chat marks. */
function bareId(ref: string): string {
  return ref.replace(/^-100/, '').replace(/^-/, '')
}

/** The handle in a reference, when it is written as @username or a t.me link. */
function handleIn(ref: string): string | undefined {
  const match = /^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z0-9_]{4,})/.exec(ref.trim())
  if (match !== null) return match[1] as string
  return ref.trim().startsWith('@') ? ref.trim().slice(1) : undefined
}

/**
 * Pick the member a reference names.
 *
 * An id or an @username matches one member exactly. A name fragment matches only when it is
 * unambiguous, so a reference that could name two people is reported rather than resolved to the
 * wrong one.
 * @param members - the members Telegram returned for the chat.
 * @param ref - numeric id, @username, or part of a display name.
 * @returns the matching member, or undefined when nothing matches.
 * @throws when a name fragment matches more than one member.
 */
export function matchMember<T extends MemberLike>(members: readonly T[], ref: string): T | undefined {
  const key = ref.trim()
  if (/^-?\d+$/.test(key)) {
    const id = bareId(key)
    return members.find(member => member.id.toString() === id)
  }
  const handle = handleIn(key)
  if (handle !== undefined) {
    const wanted = handle.toLowerCase()
    return members.find(member => member.username?.toLowerCase() === wanted)
  }
  const needle = key.toLowerCase()
  const named = members.filter(member => displayName(member).toLowerCase().includes(needle))
  const only = named.length === 1 ? named[0] : undefined
  if (only !== undefined) return only
  if (named.length > 1) {
    throw new Error(
      `"${key}" matches ${named.length} members — use an id or a @username:\n${
        named.slice(0, 10).map(member => `  • ${member.id.toString()} | ${displayName(member)}`).join('\n')
      }`
    )
  }
  return undefined
}

/** The people among your recent dialogs whose name contains the reference. */
async function userDialogs(ref: string): Promise<Entity[]> {
  const needle = ref.trim().toLowerCase()
  const dialogs = await getDialogs()
  return dialogs
    .map(dialog => dialog.entity as Entity | undefined)
    .filter((entity): entity is Entity => entity !== undefined && entity.className === 'User')
    .filter(entity => entityName(entity).toLowerCase().includes(needle))
}

/** A user by numeric id: the dialog cache first, then a chat's members, then Telegram itself. */
async function userById(id: string, chatHint?: string): Promise<Entity | undefined> {
  const dialogs = await getDialogs()
  const bare = bareId(id)
  const cached = dialogs.find(dialog => dialog.entity?.id.toString() === bare)
  if (cached?.entity !== undefined) return cached.entity as Entity
  if (chatHint !== undefined) {
    const member = await findMember(chatHint, id)
    if (member !== undefined) return member
  }
  const client = await getClient()
  const entity = await client.getEntity(bigInt(bare)).catch(() => undefined)
  return entity === undefined ? undefined : entity as Entity
}

/** Assert that a resolved entity is a person rather than a chat. */
function asUser(entity: Entity | undefined, ref: string): Entity {
  if (entity === undefined) throw new Error(`No Telegram user matches "${ref}".`)
  if (entity.className !== 'User') {
    throw new Error(`"${ref}" is ${entityName(entity)}, a chat rather than a person.`)
  }
  return entity
}

/**
 * Resolve one person, preferring the dialog cache so the result carries an access hash.
 * @param ref - numeric id, @username, t.me link, or part of a display name.
 * @param chatHint - a chat whose members are searched when the reference does not resolve alone.
 * @returns the resolved person.
 * @throws when the reference is the account itself, matches no user, or matches several.
 */
export async function resolveUser(ref: string, chatHint?: string): Promise<Entity> {
  const key = ref.trim()
  if (key === '') throw new Error('`user` is required (id, @username, t.me link, or part of a name)')
  if (key === 'me' || key === 'self') throw new Error('That reference is your own account.')

  if (/^-?\d+$/.test(key)) return asUser(await userById(key, chatHint), key)

  // A handle is either written as one or is the whole reference, as upstream resolves it.
  const handle = handleIn(key) ?? (/^[A-Za-z0-9_]{4,32}$/.test(key) ? key : undefined)
  if (handle !== undefined) {
    const client = await getClient()
    const entity = await client.getEntity(handle).catch(() => undefined)
    if (entity !== undefined) return asUser(entity as Entity, key)
  }

  const named = await userDialogs(key)
  const only = named.length === 1 ? named[0] : undefined
  if (only !== undefined) return only
  if (named.length > 1) {
    throw new Error(
      `"${key}" matches ${named.length} people — use an id or a @username:\n${
        named.slice(0, 10).map(entity => `  • ${userLabel(entity)}`).join('\n')
      }`
    )
  }
  if (chatHint !== undefined) {
    const member = await findMember(chatHint, key)
    if (member !== undefined) return member
  }
  throw new Error(`No user matching "${key}" among your recent chats. Pass \`chat\` to search that group's members.`)
}

/**
 * Find the member a reference names inside one chat.
 *
 * Telegram accepts a member reference together with the chat, which is how an id resolves when it
 * is absent from the dialog cache: a member list carries the access hash the bare id lacks.
 * @param chatRef - the chat to search.
 * @param ref - numeric id, @username, or part of a display name.
 * @returns the member, or undefined when the chat's first page of members holds no match.
 */
export async function findMember(chatRef: string, ref: string): Promise<Entity | undefined> {
  const { entity } = await resolveChat(chatRef)
  if (entity.className === 'User' || entity.className === 'UserEmpty') {
    throw new Error(`${entityName(entity)} is a person, not a chat with members.`)
  }
  const client = await getClient()
  const key = ref.trim()
  const numeric = /^-?\d+$/.test(key)
  // Telegram narrows a username or a name server-side; an id it cannot search for.
  const members = await client.getParticipants(entity, { limit: MEMBER_PAGE, search: numeric ? '' : key.replace(/^@/, '') })
  const matched = matchMember(members, key) as Entity | undefined
  if (matched !== undefined) return matched
  // A roster longer than one page hides the target; in a supergroup the id resolves directly once
  // Telegram has handed out its access hash.
  if (!numeric || entity.className !== 'Channel') return undefined
  const participant = await client
    .invoke(new Api.channels.GetParticipant({ channel: entity, participant: bigInt(bareId(key)) }))
    .catch(() => undefined)
  return (participant as { users?: Entity[] } | undefined)?.users?.[0]
}

/**
 * The group kind an entity is, or undefined for a person or a broadcast channel.
 * @param entity - the resolved chat.
 * @returns `group`, `supergroup`, or undefined.
 */
export function groupKind(entity: Entity): GroupTarget['kind'] | undefined {
  if (entity.className === 'Chat' || entity.className === 'ChatForbidden') return 'group'
  if (entity.className === 'Channel' && entity.megagroup) return 'supergroup'
  return undefined
}

/**
 * Require a group, so a tool refuses a person or a broadcast channel rather than failing inside
 * Telegram.
 * @param entity - the resolved chat.
 * @param title - the chat's name, for the error.
 * @returns the group kind with its entity narrowed.
 * @throws when the entity is neither a basic group nor a supergroup.
 */
export function requireGroup(entity: Entity, title: string): GroupTarget {
  if (entity.className === 'Chat' || entity.className === 'ChatForbidden') return { kind: 'group', entity }
  if (entity.className === 'Channel' && entity.megagroup) return { kind: 'supergroup', entity }
  throw new Error(`"${title}" is not a group whose members can be changed.`)
}

/**
 * Require a supergroup, where Telegram can ban, promote, and restrain members.
 * @param entity - the resolved chat.
 * @param title - the chat's name, for the error.
 * @returns the entity as a supergroup channel.
 * @throws when the entity is a basic group, a person, or a broadcast channel.
 */
export function requireSupergroup(entity: Entity, title: string): Api.Channel {
  const target = requireGroup(entity, title)
  if (target.kind !== 'supergroup') {
    throw new Error(`Telegram bans, promotes, and restrains members only in a supergroup; "${title}" is a basic group.`)
  }
  return target.entity
}
