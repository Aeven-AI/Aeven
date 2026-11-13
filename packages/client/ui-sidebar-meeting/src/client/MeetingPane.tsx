/**
 * The Recorder pane. Idle, it offers one large record control inside soft rings. Recording, it
 * shows the elapsed time, the transcript as phrases arrive, and a control row: add to chat, stop,
 * discard, with a live level meter per source. Done, the transcript stays with actions to add it to
 * the chat, copy it, or start again.
 *
 * A finished recording with speech is saved automatically; the idle view's bottom button opens the
 * saved recordings in a modal.
 *
 * Opening the pane downloads the Host's speaker diarization models when they are missing, with a
 * progress bar at the top until they are ready.
 */
import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, IconLucideCheck, IconLucideCopy, IconLucideMic, IconLucideX, Spinner, TextShimmer, Tooltip } from '@aeven/client-ui-primitives'
import type { DiarizationState } from '@aeven/api-speech-to-text/types'
import type { ObservableSnapshot } from '@aeven/client-store'
import type { SidebarContentPaneProps } from '@aeven/client-ui-sidebar-select/client'
import { formatDuration, groupTurns, speakerLabel, transcriptText, type MeetingTranslate, type TranscriptLine } from './format.ts'
import { List, MessageSquarePlus, StopSquare } from './icons.tsx'
import type { RecordingLibrary } from './library.ts'
import type { MeetingRecorder, RecorderError, RecorderSnapshot, Speaker } from './recorder.ts'
import { RecordingsModal } from './RecordingsModal.tsx'
import css from './MeetingPane.module.css'

export type { MeetingTranslate } from './format.ts'

/** What the plugin hands each Recorder pane besides the column's props. */
export interface MeetingPaneProps extends SidebarContentPaneProps {
  readonly t: MeetingTranslate
  readonly recorder: MeetingRecorder
  /** The account's saved recordings. */
  readonly library: RecordingLibrary
  /** The Host speaker diarizer's state; null until first observed. */
  readonly diarization: ObservableSnapshot<DiarizationState | null>
  /** Start or join the diarizer's model download. */
  readonly prepareDiarization: () => void
  /**
   * Append text to a session's composer draft.
   * @returns false when the session has no composer to receive it.
   */
  readonly addToChat: (sessionId: string, text: string) => boolean
  /** Open Settings on the voice input section. */
  readonly openVoiceSettings: () => void
}

/** Scroll-edge slack below which a pixel of overflow is not worth a fade. */
const EDGE_TOLERANCE = 1

/**
 * The live recording's phrases, timed from its start.
 * @param state - the recording.
 * @returns its transcript lines.
 */
function linesOf(state: RecorderSnapshot): TranscriptLine[] {
  const origin = state.startedAt ?? 0
  return state.segments.map(segment => ({
    speaker: segment.speaker, voice: segment.voice, offsetMs: segment.startedAt - origin, text: segment.text,
  }))
}

/**
 * Render the Recorder for one pill.
 * @param props - column props, dictionary, the shared recorder, and the diarizer state.
 * @returns the pane.
 */
export function MeetingPane(props: MeetingPaneProps): ReactNode {
  const { t, recorder, library, sessionId, visible, addToChat, openVoiceSettings, diarization, prepareDiarization } = props
  const [libraryOpen, setLibraryOpen] = useState(false)
  const state = useSyncExternalStore(recorder.subscribe, recorder.getSnapshot)
  const diarizer = useSyncExternalStore(listener => diarization.subscribe(listener), () => diarization.getSnapshot())
  const recording = state.phase === 'recording'
  const now = useTicker(recording)
  const elapsed = state.startedAt === null ? 0 : (state.stoppedAt ?? now) - state.startedAt
  const time = formatDuration(elapsed)


  // Opening the Recorder fetches the speaker models it will need.
  useEffect(() => {
    if (visible && diarizer?.phase === 'unprepared') prepareDiarization()
  }, [visible, diarizer?.phase, prepareDiarization])

  const rootRef = useRef<HTMLDivElement>(null)
  useLevels(rootRef, recorder, recording && visible)
  const idle = state.phase === 'idle' || state.phase === 'starting'
  const transcript = (): string => transcriptText(t, state.startedAt ?? Date.now(), elapsed, linesOf(state))

  return (
    <div ref={rootRef} className={css.root} data-meeting-phase={state.phase}>
      <DiarizerProgress t={t} state={diarizer} onRetry={prepareDiarization} />
      {idle
        ? (
          <>
            <Idle t={t} state={state} onStart={() => { void recorder.start() }} openVoiceSettings={openVoiceSettings} />
            <footer className={css.actions}>
              <Tooltip label={t('recordings.open')} side="top">
                <button type="button" className={css.iconButton} aria-label={t('recordings.open')} onClick={() => { setLibraryOpen(true) }}>
                  <List />
                </button>
              </Tooltip>
            </footer>
          </>
        )
        : (
          <>
            <header className={css.header}>
              <div className={css.headerRow}>
                <span className={css.status} data-live={recording || undefined}>
                  {t(recording ? 'status.recording' : state.phase === 'finishing' ? 'status.finishing' : 'status.done')}
                  {state.phase !== 'done' && <span className={css.statusDot} aria-hidden />}
                </span>
                <span className={css.headerEnd}>
                  {state.saved !== null && <span className={css.saved} data-saved={state.saved}>{t(`saved.${state.saved}`)}</span>}
                  <span className={css.timer}>{time}</span>
                </span>
              </div>
              {recording && (
                <div className={css.meters}>
                  <Meter label={t('speaker.me')} speaker="me" />
                  {state.system === 'on' && <Meter label={t('speaker.them')} speaker="them" />}
                </div>
              )}
              {state.system !== null && state.system !== 'on' && (
                <p className={css.notice}>{t(state.system === 'denied' ? 'source.systemDenied' : 'source.systemUnavailable')}</p>
              )}
            </header>

            <Transcript t={t} state={state} />

            {state.error !== null && <p className={css.error} role="alert">{errorText(t, state.error)}</p>}

            {recording
              ? (
                <footer className={css.controls}>
                  <Tooltip label={t('addToChat')} side="top">
                    <button type="button" className={css.side} aria-label={t('addToChat')}
                      disabled={state.segments.length === 0} onClick={() => { addToChat(sessionId, transcript()) }}>
                      <MessageSquarePlus />
                    </button>
                  </Tooltip>
                  <Tooltip label={t('stop')} side="top">
                    <button type="button" className={css.stop} aria-label={t('stop')} onClick={() => { recorder.stop() }}>
                      <StopSquare />
                    </button>
                  </Tooltip>
                  <Tooltip label={t('discard')} side="top">
                    <button type="button" className={css.side} aria-label={t('discard')} onClick={() => { recorder.discard() }}>
                      <IconLucideX />
                    </button>
                  </Tooltip>
                </footer>
              )
              : <DoneActions t={t} state={state} transcript={transcript} onAdd={(text) => { addToChat(sessionId, text) }}
                onNew={() => { recorder.discard() }} />}
          </>
        )}
      <RecordingsModal t={t} library={library} open={libraryOpen} onClose={() => { setLibraryOpen(false) }}
        addToChat={(text) => { addToChat(sessionId, text) }} />
    </div>
  )
}

/** The diarizer model download: a progress bar while it runs, a retry after a failure. */
function DiarizerProgress({ t, state, onRetry }: {
  t: MeetingTranslate
  state: DiarizationState | null
  onRetry: () => void
}): ReactNode {
  if (state?.phase === 'downloading') {
    const fraction = state.totalBytes === 0 ? 0 : state.completedBytes / state.totalBytes
    const mb = (bytes: number): string => (bytes / 1_000_000).toFixed(1)
    return (
      <div className={css.download} role="status">
        <div className={css.downloadRow}>
          <span>{t('diarization.downloading')}</span>
          <span className={css.downloadBytes}>{t('diarization.progress', { done: mb(state.completedBytes), total: mb(state.totalBytes) })}</span>
        </div>
        <div className={css.downloadTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
          <span className={css.downloadFill} style={{ transform: `scaleX(${String(fraction)})` }} />
        </div>
      </div>
    )
  }
  if (state?.phase === 'failed') {
    return (
      <div className={css.download} role="alert">
        <p className={css.downloadError}>{t('diarization.failed', { message: state.message })}</p>
        <Button variant="outline" size="sm" className={css.button} onClick={onRetry}>{t('diarization.retry')}</Button>
      </div>
    )
  }
  return null
}

/** The idle hero: record control, sources, and a start failure with its remedy. */
function Idle({ t, state, onStart, openVoiceSettings }: {
  t: MeetingTranslate
  state: RecorderSnapshot
  onStart: () => void
  openVoiceSettings: () => void
}): ReactNode {
  const starting = state.phase === 'starting'
  const settingsRemedy = state.error?.kind === 'voiceOff' || state.error?.kind === 'voiceNotReady'
  return (
    <div className={css.hero}>
      <div className={css.stage}>
        <span className={css.ring} data-ring="outer" aria-hidden />
        <span className={css.ring} data-ring="middle" aria-hidden />
        <span className={css.ring} data-ring="inner" aria-hidden />
        <button type="button" className={css.record} aria-label={t('start')} disabled={starting} onClick={onStart}>
          {starting ? <Spinner /> : <IconLucideMic />}
        </button>
      </div>
      <h2 className={css.title}>{t(starting ? 'status.starting' : 'start')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      {state.error !== null && (
        <div className={css.startError} role="alert">
          <p>{errorText(t, state.error)}</p>
          {settingsRemedy && <Button variant="outline" size="sm" className={css.button} onClick={openVoiceSettings}>{t('openSettings')}</Button>}
        </div>
      )}
    </div>
  )
}

/**
 * The transcript list, following new phrases while the reader is at its end. It scrolls without a
 * scrollbar; its top and bottom edges fade while more of the transcript lies beyond them.
 */
function Transcript({ t, state }: { t: MeetingTranslate; state: RecorderSnapshot }): ReactNode {
  const listRef = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const [fade, setFade] = useState({ top: false, bottom: false })
  const turns = groupTurns(linesOf(state))

  const measure = (): void => {
    const list = listRef.current
    if (list === null) return
    const top = list.scrollTop > EDGE_TOLERANCE
    const bottom = list.scrollTop + list.clientHeight < list.scrollHeight - EDGE_TOLERANCE
    setFade(current => current.top === top && current.bottom === bottom ? current : { top, bottom })
  }

  useLayoutEffect(() => {
    const list = listRef.current
    if (list !== null && pinned.current) list.scrollTop = list.scrollHeight
    measure()
  }, [state.segments, state.pending])

  useEffect(() => {
    const list = listRef.current
    if (list === null) return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => { observer.disconnect() }
  }, [])

  return (
    <div ref={listRef} className={css.transcript} data-fade-top={fade.top || undefined} data-fade-bottom={fade.bottom || undefined}
      onScroll={(event) => {
        const list = event.currentTarget
        pinned.current = list.scrollTop + list.clientHeight >= list.scrollHeight - 24
        measure()
      }}>
      {turns.map(turn => (
        <article key={turn.key} className={css.turn} data-speaker={turn.speaker} data-voice={turn.voice}>
          <div className={css.turnHead}>
            <span className={css.speaker}>{speakerLabel(t, turn.speaker, turn.voice)}</span>
            <span className={css.offset}>{formatDuration(turn.offsetMs)}</span>
          </div>
          <p className={css.turnText}>{turn.text}</p>
        </article>
      ))}
      {state.pending > 0 && <TextShimmer active className={css.pending}>{t('transcribing')}</TextShimmer>}
      {turns.length === 0 && state.pending === 0 && (
        <p className={css.placeholder}>{t(state.phase === 'recording' ? 'listening' : state.phase === 'done' ? 'empty' : 'transcribing')}</p>
      )}
    </div>
  )
}

/**
 * Actions under a finished (or finishing) transcript, as round icon buttons: copy, a new recording,
 * and add to chat.
 */
function DoneActions({ t, state, transcript, onAdd, onNew }: {
  t: MeetingTranslate
  state: RecorderSnapshot
  transcript: () => string
  onAdd: (text: string) => void
  onNew: () => void
}): ReactNode {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => { setCopied(false) }, 1500)
    return () => { clearTimeout(timer) }
  }, [copied])
  const hasText = state.segments.length > 0
  return (
    <footer className={css.actions}>
      <Tooltip label={t(copied ? 'copied' : 'copy')} side="top">
        <button type="button" className={css.iconButton} aria-label={t(copied ? 'copied' : 'copy')} disabled={!hasText}
          onClick={() => { void navigator.clipboard.writeText(transcript()).then(() => { setCopied(true) }, () => undefined) }}>
          {copied ? <IconLucideCheck /> : <IconLucideCopy />}
        </button>
      </Tooltip>
      <Tooltip label={t('newRecording')} side="top">
        <button type="button" className={css.iconButton} aria-label={t('newRecording')} onClick={onNew}>
          <IconLucideMic />
        </button>
      </Tooltip>
      <Tooltip label={t('addToChat')} side="top">
        <button type="button" className={css.iconButton} aria-label={t('addToChat')} disabled={!hasText} onClick={() => { onAdd(transcript()) }}>
          <MessageSquarePlus />
        </button>
      </Tooltip>
    </footer>
  )
}

/** One source's level bar; its fill reads the `--level-<speaker>` variable set by `useLevels`. */
function Meter({ label, speaker }: { label: string; speaker: Speaker }): ReactNode {
  return (
    <div className={css.meter} data-speaker={speaker}>
      <span className={css.meterLabel}>{label}</span>
      <span className={css.meterTrack}><span className={css.meterFill} /></span>
    </div>
  )
}

/**
 * Drive the level meters and the stop control's halo from the live analysers by writing
 * CSS variables, so levels never re-render React.
 * @param rootRef - the pane root receiving `--level-me`, `--level-them`, `--level`.
 * @param recorder - the recorder whose analysers are read.
 * @param running - whether to sample (recording and on screen).
 */
function useLevels(rootRef: { readonly current: HTMLDivElement | null }, recorder: MeetingRecorder, running: boolean): void {
  useEffect(() => {
    if (!running) return undefined
    const buffer = new Float32Array(512)
    let frame = 0
    const levelOf = (speaker: Speaker): number => {
      const analyser = recorder.analyser(speaker)
      if (analyser === undefined) return 0
      const samples = buffer.subarray(0, analyser.fftSize)
      analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (const sample of samples) sum += sample * sample
      // RMS of speech sits around 0.02–0.2; the square root spreads it over the bar.
      return Math.min(1, Math.sqrt(Math.sqrt(sum / samples.length) * 6))
    }
    const tick = (): void => {
      const root = rootRef.current
      if (root !== null) {
        const me = levelOf('me'), them = levelOf('them')
        root.style.setProperty('--level-me', me.toFixed(3))
        root.style.setProperty('--level-them', them.toFixed(3))
        root.style.setProperty('--level', Math.max(me, them).toFixed(3))
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame) }
  }, [recorder, rootRef, running])
}

/**
 * The current time, refreshed every second while `running`.
 * @param running - whether to tick.
 * @returns epoch milliseconds.
 */
function useTicker(running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return undefined
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [running])
  return now
}

/**
 * Localize a recorder failure.
 * @param t - the Recorder dictionary.
 * @param error - the failure.
 * @returns the message.
 */
function errorText(t: MeetingTranslate, error: RecorderError): string {
  switch (error.kind) {
    case 'permission': return t('error.permission')
    case 'unavailable': return t('error.unavailable')
    case 'voiceOff': return t('error.voiceOff')
    case 'voiceNotReady': return t('error.voiceNotReady')
    case 'failed': return t('error.failed', { message: error.message })
    case 'transcription': return t('error.transcription', { message: error.message })
  }
}
