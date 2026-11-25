/**
 * Read-aloud plugin, browser half: the per-message read action on assistant replies and user prompts, the agent-switched reply reading that
 * follows `read_aloud` calls, and the sentence queue that speaks both through the Host `tts` Remote.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { HostObservable, SessionIdOf } from '@aeven/client-ui-slots'
import type { CommandUiContract } from '@aeven/client-ui-commands/client'
import type {} from '@aeven/api-remotes/client'
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/client-ui-chat/client'
import type {} from '@aeven/client-ui-conversation/client'
import type {} from '@aeven/client-ui-renderer/client'
import type {} from '@aeven/client-ui-settings/client'
import { ReadAloud, type ReadAloudSnapshot } from './engine.ts'
import { en, es, NS, zh, type ReadAloudKey } from './locales.ts'
import { MessageReadAloud, UserReadAloud, type MessageReadAloudInjected } from './MessageReadAloud.tsx'
import { AgentReadAloud, type AgentReadAloudInjected } from './AgentReadAloud.tsx'
import {
  SystemVoice, type SystemVoiceInjected, type VoiceCatalogInjected, type VoicePickerLabels,
} from './SystemVoice.tsx'
import { VoiceSettingsRow } from './VoiceSettingsRow.tsx'
import { DEFAULT_ROW, languageRows, readPreferences, voiceRows, writePreference } from './voices.ts'
import type { TtsVoiceId } from '@aeven/text-to-speech/types'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Read-aloud action and voice picker copy. */
    'read-aloud': ReadAloudKey
  }
}

export type { AgentReadAloudInjected, AgentReadAloudProps } from './AgentReadAloud.tsx'

/** Command name the voice picker's popupSelect card carries in its labels and logs. */
const VOICE_COMMAND = 'voice'

/** Required services: the synthesis Remote, the slot registry, and dictionaries. */
export const inject = ['remote', 'remote.tts', 'slots', 'locale']

/**
 * Register the dictionaries, the agent-switched reading follower, the voice picker in the composer and in
 * Settings, and the message action.
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
  const face: AgentReadAloudInjected = {
    hooks: { readAloud },
    setEnabled: (sessionId, enabled, key, shown) => { engine.setEnabled(sessionId, enabled, key, shown) },
    sync: (sessionId, key, text) => { engine.sync(sessionId, key, text) },
    finish: (sessionId) => { engine.finish(sessionId) },
  }
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: 'read-aloud', order: 200, inject: () => face,
  }, AgentReadAloud))
  const catalogFace: VoiceCatalogInjected = {
    loadCatalog: async () => {
      const result = await ctx.remote.tts.catalog()
      if (!result.ok) throw result.error
      return result.value
    },
  }
  ctx.slots.inject('settings.voice.item', () => ctx.slots.register({
    name: 'settings.voice.item', id: 'read-aloud-voices', order: 100, locale: NS, inject: () => catalogFace,
  }, VoiceSettingsRow))
  // The composer row opens the shared popupSelect card, so it is offered only while that card's
  // service is composed.
  ctx.inject(['commandUi'], (pickerCtx: Context) => {
    const commandUi = pickerCtx.get('commandUi') as CommandUiContract
    const openVoices = (sessionId: SessionIdOf, anchor: Element, labels: VoicePickerLabels, language: string): void => {
      commandUi.openSelect(sessionId, VOICE_COMMAND, {
        kind: 'popupSelect',
        options: async () => voiceRows(await catalogFace.loadCatalog(), language, readPreferences(), labels.default),
        onSelect: (option) => { writePreference(language, option.id === DEFAULT_ROW ? null : option.id) },
      }, anchor, 'beside')
    }
    const voiceFace: SystemVoiceInjected = {
      openPicker: (sessionId, anchor, labels) => {
        commandUi.openSelect(sessionId, VOICE_COMMAND, {
          kind: 'popupSelect',
          options: async () => languageRows(await catalogFace.loadCatalog(), labels.count),
          // Reopening the card on the language's voices replaces this card's binding, so the settled
          // language pick does not close it.
          onSelect: (option) => { openVoices(sessionId, anchor, labels, option.id) },
        }, anchor, 'beside')
      },
    }
    pickerCtx.slots.inject('conversation.input.options', () => pickerCtx.slots.register({
      name: 'conversation.input.options', id: 'read-aloud-voice', locale: NS, inject: () => voiceFace,
    }, SystemVoice))
  })
  const messageFace: MessageReadAloudInjected = {
    hooks: { readAloud },
    read: (channel, text) => { engine.speakOnce(channel, text) },
    stop: (channel) => { engine.stopChannel(channel) },
    pause: (channel) => { engine.pause(channel) },
    resume: (channel) => { engine.resume(channel) },
  }
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions', id: 'read-aloud-message', order: 20, locale: NS,
    inject: (): MessageReadAloudInjected => messageFace,
  }, MessageReadAloud))
  ctx.slots.inject('conversation.chat.user-actions', () => ctx.slots.register({
    name: 'conversation.chat.user-actions', id: 'read-aloud-prompt', order: 20, locale: NS,
    inject: (): MessageReadAloudInjected => messageFace,
  }, UserReadAloud))
}
