/**
 * Registers the Recorder as a right sidebar content kind. Opening a Recorder pane downloads the
 * Host's speech recognition model and speaker diarization models when they are missing, so both
 * are ready by the first meeting.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the Client Remote's Context merge (ctx.remote) with the speech namespace.
import type {} from '@aeven/api-remotes/client'
// Type-only: pulls the sessions service merge (ctx.sessions).
import type {} from '@aeven/api-session-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@aeven/client-locale/client'
// Type-only: pulls the per-session conversation service merge (input.for).
import type {} from '@aeven/client-ui-conversation/client'
// Type-only: pulls the content registry's Context merge (ctx.sidebarContent).
import type {} from '@aeven/client-ui-sidebar-select/client'
import type { SidebarContentPaneProps } from '@aeven/client-ui-sidebar-select/client'
import type { SessionId } from '@aeven/session/types'
import { createElement } from 'react'
import type { DiarizationState, RecordingId, SpeechCatalog } from '@aeven/api-speech-to-text/types'
import type { SpeechProviderId } from '@aeven/speech-to-text/types'
import { observeHostState } from './host-state.ts'
import { formatDate } from './format.ts'
import { RecordingLibrary } from './library.ts'
import { en, es, zh } from './locales.ts'
import { MeetingPane } from './MeetingPane.tsx'
import { MeetingRecorder, type RecorderSnapshot } from './recorder.ts'

export type { MeetingPaneProps } from './MeetingPane.tsx'

/**
 * A new recording id: an RFC 4122 version 4 UUID from `crypto.getRandomValues`, which browsers expose
 * outside secure contexts too (unlike `crypto.randomUUID`).
 * @returns the id.
 */
function recordingUuid(): RecordingId {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte, index) =>
    (index === 6 ? (byte & 0x0f) | 0x40 : index === 8 ? (byte & 0x3f) | 0x80 : byte).toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as RecordingId
}

/** Dictionary namespace owned by this plugin. */
const NS = 'sidebarMeeting'

/** Settings section holding the voice input group. */
const VOICE_SECTION = 'general'

/** Services required by the meeting recorder. */
export const inject = ['locale']

/**
 * Registers the meeting pane for the `meeting` kind once the column's registry
 * and the speech Remote are both present. One recorder serves every pane.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-sidebar-meeting: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.inject(['sidebarContent', 'remote', 'remote.speech'], (scoped) => {
    const speech = scoped.remote.speech
    const diarization = observeHostState<DiarizationState>(scoped, {
      name: 'Speaker diarization', open: signal => speech.followDiarization(signal),
      // A Host without a diarizer answers once and ends; there is nothing to reopen for.
      final: value => value.phase === 'unavailable',
    })
    scoped.effect(() => diarization.dispose, 'ui-sidebar-meeting: diarization state')
    const recognition = observeHostState<SpeechCatalog>(scoped, {
      name: 'Speech readiness', open: signal => speech.follow(signal),
    })
    scoped.effect(() => recognition.dispose, 'ui-sidebar-meeting: speech readiness')
    const library = new RecordingLibrary({
      recordingsList: async () => await speech.recordingsList(),
      recordingGet: async request => await speech.recordingGet(request),
      recordingSave: async request => await speech.recordingSave(request),
      recordingAudioAppend: async request => await speech.recordingAudioAppend(request),
      recordingAudioFinish: async request => await speech.recordingAudioFinish(request),
      recordingAudioRead: async request => await speech.recordingAudioRead(request),
      recordingRename: async request => await speech.recordingRename(request),
      recordingDelete: async request => await speech.recordingDelete(request),
    })
    // A finished recording reaches here only with transcribed speech (see MeetingRecorder.stop).
    const persist = async (recording: RecorderSnapshot, audio: Blob | undefined): Promise<void> => {
      const startedAt = recording.startedAt ?? Date.now()
      await library.save({
        id: recordingUuid(),
        title: t('recordings.defaultTitle', { date: formatDate(startedAt) }),
        startedAt,
        durationMs: (recording.stoppedAt ?? Date.now()) - startedAt,
        segments: recording.segments.map(segment => ({
          speaker: segment.speaker, offsetMs: Math.max(0, segment.startedAt - startedAt), text: segment.text,
          ...segment.voice === undefined ? {} : { voice: segment.voice },
        })),
      }, audio)
    }
    const recorder = new MeetingRecorder({
      catalog: async () => await speech.catalog(),
      transcribe: async (request, signal) => await speech.transcribe(request, signal),
      diarize: async (request, signal) => await speech.diarize(request, signal),
    }, () => diarization.state.getSnapshot()?.phase === 'ready', persist)
    scoped.effect(() => () => { recorder.dispose() }, 'ui-sidebar-meeting: recorder')
    const prepareDiarization = (): void => { void speech.prepareDiarization() }
    const prepareSpeech = (providerId: SpeechProviderId): void => { void speech.prepare(providerId) }

    const addToChat = (sessionId: string, text: string): boolean => {
      const sessions = ctx.get('sessions')
      const actx = sessions?.scope(sessionId as SessionId)
      const input = actx?.get('conversation')?.input.for(actx)
      return input?.appendText(text) ?? false
    }
    const openVoiceSettings = (): void => { ctx.emit('settings/open', VOICE_SECTION) }

    const Pane = (props: SidebarContentPaneProps) =>
      createElement(MeetingPane, {
        ...props, t, recorder, library, diarization: diarization.state, prepareDiarization,
        speech: recognition.state, prepareSpeech, addToChat, openVoiceSettings,
      })
    scoped.effect(() => scoped.sidebarContent.register('meeting', Pane), 'ui-sidebar-meeting: meeting content kind')
    // Closing the pill stops the recording rather than leaving the microphone
    // open with nothing on screen; the transcript stays for the next pill.
    scoped.effect(() => scoped.sidebarContent.registerCloseHandler('meeting', () => { recorder.stop() }),
      'ui-sidebar-meeting: stop on close')
  })
}
