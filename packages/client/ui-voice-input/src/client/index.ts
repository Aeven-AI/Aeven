/**
 * Dictation plugin, browser half: the composer mic and recorder pill, and the Settings voice section,
 * over one shared readiness mirror of the Host `speech` Remote.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@aeven/api-remotes/client'
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/client-ui-renderer/client'
import type {} from '@aeven/client-ui-conversation/client'
import type {} from '@aeven/client-ui-settings/client'
import { Capture, DEFAULT_VOICE_DETECTION } from './capture.ts'
import { en, NS, zh, type VoiceKey } from './locales.ts'
import { observeReadiness } from './readiness.ts'
import { VoiceInput, type VoiceInputInjected } from './VoiceInput.tsx'
import { VoiceSection, type VoiceSectionInjected } from './VoiceSection.tsx'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Dictation controls and voice settings copy. */
    'voice-input': VoiceKey
  }
}

export type { VoiceInputInjected, VoiceInputProps } from './VoiceInput.tsx'
export type { VoiceSectionInjected, VoiceSectionProps } from './VoiceSection.tsx'

/** Settings section id; the composer opens it when the local model still needs preparing. */
export const VOICE_SECTION = 'voice'

/** Required services: the speech Remote, the slot registry, and dictionaries. */
export const inject = ['remote', 'remote.speech', 'slots', 'locale']

/**
 * Register the dictionaries, the composer activity, and the voice settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-voice-input: dictionaries')
  const readiness = observeReadiness(ctx)
  ctx.effect(() => readiness.dispose, 'ui-voice-input: readiness')
  const captures = new Set<Capture>()
  ctx.effect(() => async () => { await Promise.all([...captures].map(capture => capture.release())) }, 'ui-voice-input: captures')
  const t = ctx.locale.bind(NS)

  const composer: VoiceInputInjected = {
    hooks: { speechReadiness: readiness.state },
    openSettings: () => { ctx.emit('settings/open', VOICE_SECTION) },
    createCapture: (maxSamples, onLimit) => {
      const capture = new Capture(DEFAULT_VOICE_DETECTION, maxSamples, onLimit)
      captures.add(capture)
      const release = capture.release.bind(capture)
      capture.release = async () => { captures.delete(capture); await release() }
      return capture
    },
    transcribe: async (request, signal) => await ctx.remote.speech.transcribe(request, signal),
  }
  const settings: VoiceSectionInjected = {
    hooks: { speechReadiness: readiness.state },
    prepare: async (providerId, options) => {
      const result = await ctx.remote.speech.prepare(providerId, options)
      if (!result.ok) throw result.error
    },
    cancelPreparation: async (providerId) => {
      const result = await ctx.remote.speech.cancelPreparation(providerId)
      if (!result.ok) throw result.error
    },
  }
  ctx.slots.inject('conversation.input.activity', () => ctx.slots.register({
    name: 'conversation.input.activity', locale: NS, inject: () => composer,
  }, VoiceInput))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: VOICE_SECTION, order: 40, label: () => t('nav'), locale: NS, inject: () => settings,
  }, VoiceSection))
}
