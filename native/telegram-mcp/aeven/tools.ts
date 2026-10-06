/**
 * Tools the connector lets through without a prompt.
 *
 * Upstream marks each tool with `readOnlyHint`; everything else — upstream's and every Aeven-owned
 * tool — acts on a real account other people can see, so the connector asks first.
 * `tests/daemon.spec.ts` fails if this list and the served annotations drift apart, and
 * `packages/host/account-integrations` mirrors it for the approval gate.
 */

/** Read-only tool names, as the tools annotate themselves. */
export const TELEGRAM_READ_TOOLS: readonly string[] = [
  'whoami', 'list_chats', 'get_chat', 'list_members', 'find_public_chat',
  'get_history', 'search_messages', 'get_message', 'get_replies', 'get_unread', 'chat_digest',
  'list_media', 'download_media',
  'poll_results', 'list_scheduled', 'get_draft', 'random_member',
  'list_blocked', 'list_banned', 'list_invite_links',
]

/** The Aeven-owned tools served beside upstream's: moderation, administration, and raw schema access. */
export const TELEGRAM_AEVEN_TOOLS: readonly string[] = [
  'block_contact', 'unblock_contact', 'list_blocked', 'report_spam',
  'kick_member', 'unban_member', 'list_banned', 'promote_member', 'demote_admin',
  'create_group', 'join_chat', 'leave_chat', 'set_group_info', 'set_group_permissions',
  'create_invite_link', 'list_invite_links', 'revoke_invite_link',
  'telegram_api_call',
]
