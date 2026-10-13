/**
 * The two rights vocabularies the Telegram tools speak: what an admin may do in a supergroup, and
 * what members may be withheld. Telegram names each right differently on the wire than the apps
 * do, so every accepted name maps to the field it sets and an unknown name is refused rather than
 * silently dropped.
 */

import { Api } from '../source/src/client.ts'

/** Admin rights `promote_member` grants, and the field each one sets. */
export const ADMIN_RIGHTS = {
  change_info: 'changeInfo',
  post_messages: 'postMessages',
  edit_messages: 'editMessages',
  delete_messages: 'deleteMessages',
  ban_users: 'banUsers',
  invite_users: 'inviteUsers',
  pin_messages: 'pinMessages',
  add_admins: 'addAdmins',
  anonymous: 'anonymous',
  manage_call: 'manageCall',
  manage_topics: 'manageTopics',
  other: 'other',
} as const

/** A right `promote_member` grants. */
export type AdminRightName = keyof typeof ADMIN_RIGHTS

/** What an admin gets when the caller names no rights: what a moderator needs, and nothing more. */
export const DEFAULT_ADMIN_RIGHTS: readonly AdminRightName[] = [
  'change_info', 'delete_messages', 'ban_users', 'invite_users', 'pin_messages', 'manage_call',
]

/** Rights members may be withheld, and the field each one sets. */
export const MEMBER_RESTRICTIONS = {
  send_messages: 'sendMessages',
  send_media: 'sendMedia',
  send_stickers: 'sendStickers',
  send_gifs: 'sendGifs',
  send_games: 'sendGames',
  send_inline: 'sendInline',
  embed_links: 'embedLinks',
  send_polls: 'sendPolls',
  send_plain: 'sendPlain',
  send_photos: 'sendPhotos',
  send_videos: 'sendVideos',
  send_round_videos: 'sendRoundvideos',
  send_audio: 'sendAudios',
  send_voice: 'sendVoices',
  send_docs: 'sendDocs',
  send_reactions: 'sendReactions',
  invite_users: 'inviteUsers',
  pin_messages: 'pinMessages',
  change_info: 'changeInfo',
  manage_topics: 'manageTopics',
} as const

/** A restriction `set_group_permissions` withholds. */
export type RestrictionName = keyof typeof MEMBER_RESTRICTIONS

/** The shorthand that withholds every posting right at once. */
export const ALL_MESSAGES = 'all_messages'

/** The posting rights `all_messages` expands to. */
export const POSTING_RESTRICTIONS: readonly RestrictionName[] = [
  'send_messages', 'send_media', 'send_stickers', 'send_gifs', 'send_games', 'send_inline',
  'embed_links', 'send_polls', 'send_plain', 'send_reactions',
]

/** Every name `set_group_permissions` accepts, the shorthand included. */
export const RESTRICTION_NAMES: readonly string[] = [...Object.keys(MEMBER_RESTRICTIONS), ALL_MESSAGES]

/** The args object `ChatBannedRights` takes, whose `untilDate` is the one required field. */
type BannedRightsArgs = ConstructorParameters<typeof Api.ChatBannedRights>[0]

/**
 * Build Telegram admin rights.
 * @param names - the rights to grant.
 * @returns the rights object for `channels.EditAdmin`.
 * @throws when a name is not a known right.
 */
export function adminRightsFrom(names: readonly string[]): Api.ChatAdminRights {
  const fields: Record<string, boolean> = {}
  for (const name of names) {
    const field = ADMIN_RIGHTS[name as AdminRightName] as string | undefined
    if (field === undefined) {
      throw new Error(`Unknown admin right "${name}". Known: ${Object.keys(ADMIN_RIGHTS).join(', ')}.`)
    }
    fields[field] = true
  }
  return new Api.ChatAdminRights(fields)
}

/**
 * Rights that withhold nothing: the object that lifts a ban or a restriction.
 * @param until - when the rights end, in seconds since the epoch; 0 means no end.
 * @returns the rights object that grants everything back.
 */
export function noRightsWithheld(until = 0): Api.ChatBannedRights {
  return new Api.ChatBannedRights({ untilDate: until })
}

/**
 * The rights that remove a member: without `viewMessages` Telegram does not bar the account at all.
 * @param until - when the removal ends, in seconds since the epoch; 0 means forever.
 * @returns the rights object for a ban.
 */
export function removalRights(until = 0): Api.ChatBannedRights {
  return new Api.ChatBannedRights({ viewMessages: true, untilDate: until })
}

/**
 * Build the rights to withhold from every member of a group.
 * @param names - restrictions, or `all_messages` for the whole posting set.
 * @param until - when the restriction lifts, in seconds since the epoch; 0 means until an admin lifts it.
 * @returns the default-permissions object for `messages.EditChatDefaultBannedRights`.
 * @throws when a name is not a known restriction.
 */
export function withheldRights(names: readonly string[], until = 0): Api.ChatBannedRights {
  const flags: Record<string, boolean> = {}
  for (const name of names) {
    for (const one of name === ALL_MESSAGES ? POSTING_RESTRICTIONS : [name]) {
      const field = MEMBER_RESTRICTIONS[one as RestrictionName] as string | undefined
      if (field === undefined) {
        throw new Error(`Unknown restriction "${one}". Known: ${RESTRICTION_NAMES.join(', ')}.`)
      }
      flags[field] = true
    }
  }
  // Each name was checked against the vocabulary above, so these fields are exactly the
  // constructor's args; only building them by name needs the assertion.
  return new Api.ChatBannedRights({ ...flags, untilDate: until } as BannedRightsArgs)
}
