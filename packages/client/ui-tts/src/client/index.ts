/**
 * Read-aloud plugin, browser half: the composer toggle and the sentence queue that speaks assistant
 * replies through the Host `tts` Remote. Reading is session-scoped and starts switched off.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { HostObservable } from '@aeven/client-ui-slots'
import type {} from '@aeven/api-remotes/client'
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/client-ui-chat/client'
import type {} from '@aeven/client-ui-conversation/client'
import type {} from '@aeven/client-ui-renderer/client'
import { ReadAloud, type ReadAloudSnapshot } from './engine.ts'
import { en, es, NS, zh, type ReadAloudKey } from './locales.ts'
import { MessageReadAloud, type MessageReadAloudInjected } from './MessageReadAloud.tsx'
import { ReadAloudToggle, type ReadAloudInjected } from './ReadAloud.tsx'
import { SystemVoice, type SystemVoiceInjected } from './SystemVoice.tsx'
import { writeEnabled } from './voices.ts'
import type { TtsVoiceId } from '@aeven/text-to-speech/types'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Read-aloud toggle copy. */
    'read-aloud': ReadAloudKey
  }
}

export type { ReadAloudInjected, ReadAloudProps } from './ReadAloud.tsx'

/** Required services: the synthesis Remote, the slot registry, and dictionaries. */
export const inject = ['remote', 'remote.tts', 'slots', 'locale']

/**
 * Register the dictionaries and the composer toggle.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-tts: dictionaries')
  const listeners = new Set<() => void>()
  const engine = new ReadAloud({
    speak: async (text, language, voiceId, signal) => {
      const result = await ctx.remote.tts.synthesize({
        text, language, ...(voiceId === undefined ? {} : { voiceId: voiceId as TtsVoiceId }),
      }, signal)
      if (!result.ok) throw result.error
      return result.value.audioBase64
    },
    fallbackLanguage: () => document.documentElement.lang.split('-')[0] ?? 'en',
    publish: () => { for (const listener of listeners) listener() },
  })
  ctx.effect(() => () => { engine.dispose() }, 'ui-tts: engine')
  const readAloud: HostObservable<ReadAloudSnapshot> = {
    getSnapshot: () => engine.view,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  const face: ReadAloudInjected = {
    hooks: { readAloud },
    setEnabled: (sessionId, enabled, key, shown) => {
      writeEnabled(enabled)
      engine.setEnabled(sessionId, enabled, key, shown)
    },
    sync: (sessionId, key, text) => { engine.sync(sessionId, key, text) },
    finish: (sessionId) => { engine.finish(sessionId) },
  }
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: 'read-aloud', order: 200, locale: NS, inject: () => face,
  }, ReadAloudToggle))
  const voiceFace: SystemVoiceInjected = {
    loadCatalog: async () => {
      const result = await ctx.remote.tts.catalog()
      if (!result.ok) throw result.error
      return result.value
    },
  }
  ctx.slots.inject('conversation.input.options', () => ctx.slots.register({
    name: 'conversation.input.options', id: 'read-aloud-voice', locale: NS, inject: () => voiceFace,
  }, SystemVoice))
  const messageFace: MessageReadAloudInjected = {
    hooks: { readAloud },
    read: (channel, text) => { engine.speakOnce(channel, text) },
    stop: (channel) => { engine.stopChannel(channel) },
  }
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions', id: 'read-aloud-message', order: 20, locale: NS,
    inject: (): MessageReadAloudInjected => messageFace,
  }, MessageReadAloud))
}
