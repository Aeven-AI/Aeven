/**
 * Message share plugin, browser half: the share action in the
 * conversation.chat.assistant-actions strip, placed before branch, with its
 * share dialog and the shared-link manager. Every call goes through the
 * generated messageShare Remote; the Host builds the snapshot from the Session
 * log and the Aeven API files each link under the signed-in account.
 * @module @aeven/client-ui-message-share/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@aeven/api-remotes/client'
import type { MessageShareResult } from '@aeven/host-message-share/types'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@aeven/api-remotes/client'
// Type-only: pulls the ui-conversation SlotMap merge (the assistant-actions entry).
import type {} from '@aeven/client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@aeven/client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@aeven/client-ui-renderer/client'
import type {} from '@aeven/client-ui-chat/client'
import type {} from '@aeven/client-ui-session/client'
import { ShareAction } from './ShareAction.tsx'
import type { MessageShareInjected, ShareOutcome } from './slots.ts'
import { en, es, zh } from './locales.ts'

export type { MessageShareActionProps, MessageShareInjected, ShareOutcome } from './slots.ts'
export type { MessageShareKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'share'

/** Required services: the slot registry, the Remote namespace, and the copy. */
export const inject = ['slots', 'remote', 'remote.messageShare', 'locale']

/**
 * Fold the carrier result and the Host's business result into one outcome;
 * a carrier failure reads as the API being unavailable.
 * @param carried - the Remote call's settled result.
 * @returns the value, or the failure code.
 */
function outcome<T>(carried: RemoteResult<MessageShareResult<T>>): ShareOutcome<T> {
  if (!carried.ok) return { ok: false, code: 'unavailable' }
  const result = carried.value
  return result.ok ? { ok: true, value: result.value } : { ok: false, code: result.error.code }
}

/**
 * Client plugin body: the per-message share entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-message-share: dictionaries')

  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'share',
    // After feedback (10) and read aloud (20), so the action sits directly before branch.
    order: 30,
    locale: NS,
    inject: (sessionId): MessageShareInjected => ({
      share: async messageId => outcome(await ctx.remote.messageShare.create({ sessionId, messageId })),
      list: async cursor => outcome(await ctx.remote.messageShare.list(cursor === undefined ? {} : { cursor })),
      remove: async shareId => outcome(await ctx.remote.messageShare.delete({ shareId })),
      removeAll: async () => outcome(await ctx.remote.messageShare.deleteAll()),
    }),
  }, ShareAction))
}
