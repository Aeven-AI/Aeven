/** Composer dictation: a mic button that turns the control row into a recorder pill, then appends the transcript. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type { HostObservable } from '@aeven/client-ui-slots'
import type { TranscriptionRequest } from '@aeven/api-speech-to-text/types'
import type { SpeechProviderId, Transcript } from '@aeven/speech-to-text/types'
import type { RemoteResult } from '@aeven/typert-protocol'
import type {} from '@aeven/client-ui-conversation/client'
import { IconLucideCheck, IconLucideMic, IconLucideX, Tooltip } from '@aeven/client-ui-primitives'
import { audioBase64, CaptureError, type Capture } from './capture.ts'
import type { SpeechReadiness } from './readiness.ts'
import { Waveform } from './Waveform.tsx'
import { NS } from './locales.ts'
import css from './VoiceInput.module.css'

/** Host calls injected without exposing a Cordis Context to React. */
export interface VoiceInputActions {
  /** Open Settings on the voice section, where the local model is prepared. */
  openSettings: () => void
  /**
   * Start preparing the local model the mic needs; outcome and retry stay in Settings.
   * @param providerId - recognizer to prepare.
   */
  prepareModel: (providerId: SpeechProviderId) => void
  /**
   * @param maxSamples - speech samples after which `onLimit` fires once.
   * @param onLimit - called when the kept speech reaches the Host's duration limit.
   * @returns one microphone capture owned by the plugin lifecycle.
   */
  createCapture: (maxSamples: number, onLimit: () => void) => Capture
  transcribe: (request: TranscriptionRequest, signal: AbortSignal) => Promise<RemoteResult<Transcript>>
}

/** Entry-injected Host readiness, microphone operations, and outside dictation requests. */
export interface VoiceInputInjected extends VoiceInputActions {
  hooks: {
    speechReadiness: HostObservable<SpeechReadiness>
    /** Advances once per dictation request made outside the composer, such as from a menu. */
    dictationRequest: HostObservable<number>
  }
}

/** Composer-owned row claim and draft actions. */
export type VoiceInputProps = Pick<PropsRuntime<'conversation.input.activity'>, 'sessionId' | 'inputActions' | 'locked' | 'onActiveChange'>
  & PropsLocale<typeof NS> & InjectFace<VoiceInputInjected>

type Phase = 'idle' | 'starting' | 'recording' | 'transcribing'

// The loader glyph of the Aeven web client's icon buttons.
const LOADER = <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M16 16L19 19M18 12H22M8 8L5 5M16 8L19 5M8 16L5 19M2 12H6M12 2V6M12 18V22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>

/**
 * Render the idle mic button, or the recorder pill while recording or transcribing.
 * @param props - composer row claim, draft actions, readiness, and capture operations.
 * @returns the dictation control.
 */
export function VoiceInput({ sessionId, inputActions, locked, onActiveChange, createCapture, transcribe, openSettings,
  prepareModel, useSpeechReadiness, useDictationRequest, t }: VoiceInputProps) {
  const readiness = useSpeechReadiness(value => value), catalog = readiness.catalog
  const provider = catalog?.providers.find(item => item.id === catalog.selection.providerId)
  const preparation = provider?.preparation.phase
  const usable = readiness.connected && (preparation === 'ready' || preparation === 'standby' || preparation === 'waking')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const capture = useRef<Capture>(), request = useRef<AbortController>(), generation = useRef(0)
  const expanded = phase === 'recording' || phase === 'transcribing'
  useLayoutEffect(() => { onActiveChange(expanded); return () => { onActiveChange(false) } }, [expanded, onActiveChange])

  const reset = (): void => {
    generation.current++
    request.current?.abort()
    request.current = undefined
    void capture.current?.release()
    capture.current = undefined
    setPhase('idle')
  }
  useEffect(() => { reset(); return reset }, [sessionId])

  const finish = async (): Promise<void> => {
    const active = capture.current
    if (!active || !catalog) return
    const run = generation.current
    setPhase('transcribing')
    const audio = active.finish()
    try {
      if (audio === undefined) return
      const abort = new AbortController()
      request.current = abort
      const result = await transcribe({ audioBase64: audioBase64(audio), ...catalog.selection }, abort.signal)
      if (run !== generation.current) return
      if (!result.ok) { setError(t('failed', { message: result.error.message })); return }
      if (result.value.text !== '') inputActions.appendText(result.value.text)
    } catch (failure) {
      if (run === generation.current) setError(t('failed', { message: failure instanceof Error ? failure.message : String(failure) }))
    } finally {
      if (run === generation.current) {
        request.current = undefined
        void active.release()
        capture.current = undefined
        setPhase('idle')
      }
    }
  }

  const start = async (): Promise<void> => {
    if (!usable) {
      // The mic is where dictation is asked for, so it starts a missing model itself;
      // Settings keeps its explicit Download for starting one without recording.
      if (readiness.connected && catalog && preparation === 'unprepared') prepareModel(catalog.selection.providerId)
      openSettings()
      return
    }
    if (!catalog || locked || phase !== 'idle') return
    const run = ++generation.current
    setError('')
    setPhase('starting')
    const active = createCapture(Math.floor(catalog.maxDurationSeconds * 16000), () => { void finish() })
    capture.current = active
    try {
      await active.start()
      if (run === generation.current) setPhase('recording')
    } catch (failure) {
      await active.release()
      if (run !== generation.current) return
      capture.current = undefined
      setPhase('idle')
      setError(failure instanceof CaptureError ? t(failure.kind) : t('failed', { message: String(failure) }))
    }
  }

  // A request from outside the composer (the shell's dictation menu item) does
  // what the mic button does: start when idle, finish when already recording.
  // The first snapshot only marks where this component mounted.
  const dictationRequest = useDictationRequest(value => value)
  const seenRequest = useRef(dictationRequest)
  const phaseRef = useRef<Phase>(phase)
  phaseRef.current = phase
  useEffect(() => {
    if (dictationRequest === seenRequest.current) return
    seenRequest.current = dictationRequest
    if (phaseRef.current === 'idle') void start()
    else if (phaseRef.current === 'recording') void finish()
  }, [dictationRequest])

  if (!expanded) {
    return <Tooltip label={error === '' ? t('dictate') : error} side="top">
      <button type="button" className={css.mic} data-loading={phase === 'starting' ? '' : undefined} aria-label={t('dictate')}
        disabled={locked} onMouseDown={(event) => { event.preventDefault() }} onClick={() => { void start() }}>
        <span className={css.micIcon}><IconLucideMic /></span>
        <span className={css.micLoader}>{LOADER}</span>
      </button>
    </Tooltip>
  }
  const transcribing = phase === 'transcribing'
  return <div className={css.recorder} data-voice-phase={phase}>
    <Waveform analyser={capture.current?.analyser} className={css.canvas} />
    <div className={css.buttons}>
      <Tooltip label={t(transcribing ? 'cancelTranscription' : 'cancelRecording')} side="top">
        <button type="button" className={css.cancel} aria-label={t(transcribing ? 'cancelTranscription' : 'cancelRecording')}
          onClick={reset}><span className={css.icon}><IconLucideX /></span></button>
      </Tooltip>
      {transcribing
        ? <span className={css.save} role="status" aria-label={t('transcribing')}>
          <span className={css.circle}><span className={css.loader}>{LOADER}</span></span>
        </span>
        : <Tooltip label={t('transcribe')} side="top">
          <button type="button" className={css.save} aria-label={t('transcribe')} onClick={() => { void finish() }}>
            <span className={css.circle}><span className={css.icon}><IconLucideCheck /></span></span>
          </button>
        </Tooltip>}
    </div>
  </div>
}
