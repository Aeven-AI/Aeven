/**
 * Dictation plugin, browser half: the composer mic and recorder pill, and the Settings voice section,
 * over one shared readiness mirror of the Host `speech` Remote.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { HostObservable } from '@aeven/client-ui-slots'
import type {} from '@aeven/api-remotes/client'
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/client-ui-renderer/client'
import type {} from '@aeven/client-ui-conversation/client'
import type {} from '@aeven/client-ui-settings/client'
import { Capture, DEFAULT_VOICE_DETECTION } from './capture.ts'
import { en, es, NS, zh, type VoiceKey } from './locales.ts'
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

/**
 * The Electron shell's preload carrier, as this plugin needs it. Optional: the
 * browser build has no `window.avnDesktop`, and no menu exists to command it.
 */
interface DesktopShellCarrier {
  /** @param listener - called with each application-menu command. @returns disposer removing the listener. */
  onCommand?(listener: (command: string) => void): () => void
}

/** Command the shell sends when the Edit menu's dictation item is chosen. */
const START_DICTATION_COMMAND = 'start-dictation'

/** Required services: the speech Remote, the slot registry, and dictionaries. */
export const inject = ['remote', 'remote.speech', 'slots', 'locale']

/**
 * Count dictation requests made from outside the composer. The composer's mic is
 * the only code that can start or finish a recording, so a request crosses to it
 * as a counter that the renderer binds to the component's `useDictationRequest`.
 * @returns the observable source and the function that advances it.
 */
function createDictationRequests(): { source: HostObservable<number>; request: () => void } {
  let sequence = 0
  const listeners = new Set<() => void>()
  return {
    source: {
      getSnapshot: () => sequence,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    request: () => {
      sequence += 1
      for (const listener of listeners) listener()
    },
  }
}

/**
 * Register the dictionaries, the composer activity, and the voice settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-voice-input: dictionaries')
  const readiness = observeReadiness(ctx)
  ctx.effect(() => readiness.dispose, 'ui-voice-input: readiness')
  const captures = new Set<Capture>()
  ctx.effect(() => async () => { await Promise.all([...captures].map(capture => capture.release())) }, 'ui-voice-input: captures')
  const t = ctx.locale.bind(NS)
  const dictation = createDictationRequests()
  const carrier = (window as { avnDesktop?: DesktopShellCarrier }).avnDesktop
  const onCommand = carrier?.onCommand?.bind(carrier)
  if (onCommand !== undefined) {
    ctx.effect(
      () => onCommand((command) => { if (command === START_DICTATION_COMMAND) dictation.request() }),
      'ui-voice-input: desktop dictation command',
    )
  }

  const composer: VoiceInputInjected = {
    hooks: { speechReadiness: readiness.state, dictationRequest: dictation.source },
    openSettings: () => { ctx.emit('settings/open', VOICE_SECTION) },
    prepareModel: (providerId) => { void ctx.remote.speech.prepare(providerId) },
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
    prepare: async (providerId) => {
      const result = await ctx.remote.speech.prepare(providerId)
      if (!result.ok) throw result.error
    },
  }
  ctx.slots.inject('conversation.input.activity', () => ctx.slots.register({
    name: 'conversation.input.activity', locale: NS, inject: () => composer,
  }, VoiceInput))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: VOICE_SECTION, order: 60, label: () => t('nav'), locale: NS, inject: () => settings,
  }, VoiceSection))
}
