/** Settings → Memory: the signed-in user's memories and learned capabilities, over the memoryManager Remote. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/client-ui-settings/client'
import type {} from '@aeven/client-ui-renderer/client'
import type {} from '@aeven/api-session-controller/client'
import type { ManagedMemory, RemoteResult } from '@aeven/api-remotes/client'
import { MemorySection, type MemorySectionInjected } from './MemorySection.tsx'
import { en, zh, type MemoryLocaleKey } from './locales.ts'

export type { MemorySectionInjected, MemorySectionProps } from './MemorySection.tsx'
export type { MemoryLocaleKey } from './locales.ts'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Settings → Memory copy. */
    'settings.memory': MemoryLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.memory'

/** Services required by the Settings registration and the generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.memoryManager', 'sessions']

/**
 * Unwrap one Remote result.
 * @param result - Remote outcome.
 * @returns the value.
 * @throws when the Remote call failed.
 */
async function value<T>(result: Promise<RemoteResult<T>>): Promise<T> {
  const settled = await result
  if (!settled.ok) throw new Error(`memoryManager: ${settled.error.code}: ${settled.error.message}`)
  return settled.value
}

/**
 * Register the Memory section once the `settings.section` declaration is on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-memory: dictionaries')

  const t = ctx.locale.bind(NS)
  const remote = ctx.remote.memoryManager
  const operations: MemorySectionInjected = {
    memories: request => value(remote.memories(request)),
    editMemory: (id, summary) => value(remote.editMemory(id, summary)),
    forgetMemory: id => value(remote.forgetMemory(id)),
    capabilities: () => value(remote.capabilities()),
    capability: name => value(remote.capability(name)),
    editCapability: (name, edit) => value(remote.editCapability(name, edit)),
    setCapabilityStatus: (name, status) => value(remote.setCapabilityStatus(name, status)),
    deleteCapability: name => value(remote.deleteCapability(name)),
    openConversation: (sessionId) => { ctx.sessions.open(sessionId as ManagedMemory['sessionId']) },
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'memory',
    order: 40,
    label: () => t('nav'),
    locale: NS,
    inject: () => operations,
  }, MemorySection))
}
