/**
 * Composer camera popup: the live preview, an icon mode switch, the shutter
 * with its countdown, and a recorded clip's review. Captured media leaves
 * through `onCapture` (one still, into the composer's image intake) or
 * `onCaptureClip` (one video file, into the composer's file intake); this
 * component owns only the stream, the countdown, and the recording.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Button, IconCloseOutline16, IconLucideCamera, IconLucideSwitchCamera, IconLucideTimer, IconLucideVideo, Modal, Tooltip,
  VideoPlayer,
} from '@aeven/client-ui-primitives'
import type { ComposerBarProps } from '../../contract/slots.ts'
import {
  COUNTDOWN_SECONDS, CameraError, MAX_CLIP_MS, clipMediaType, elapsedLabel, grabFrame, openCamera,
  startClipRecorder, type CameraFacing, type CameraFailure, type ClipRecorder,
} from './capture.ts'
import css from './CameraDialog.module.css'

/** Capture mode: one still, or a recorded clip. */
type CameraMode = 'photo' | 'video'

/** Sentence shown in the stage: a refused camera, or a capture that failed. */
type StageFailure = CameraFailure | 'capture'

export interface CameraDialogProps {
  /** Whether the popup is showing; closing releases the camera. */
  open: boolean
  /** Close without adding anything to the draft. */
  onClose: () => void
  /** Hand one encoded still to the composer's image intake. */
  onCapture: (files: readonly File[]) => void
  /** Hand one recorded clip to the composer's file intake. */
  onCaptureClip: (file: File) => void
  /** Whether this deployment's draft intake accepts a video file. */
  canRecordClip: boolean
  /** Composer dictionary lookup. */
  t: ComposerBarProps['t']
}

/**
 * The stage sentence for one failure kind.
 * @param kind - which stage failure occurred.
 * @param t - composer dictionary lookup.
 * @returns the localized explanation under the retry control.
 */
function failureText(kind: StageFailure, t: ComposerBarProps['t']): string {
  if (kind === 'permission') return t('camera.permission')
  if (kind === 'capture') return t('camera.captureFailed')
  return t('camera.unavailable')
}

export function CameraDialog({ open, onClose, onCapture, onCaptureClip, canRecordClip, t }: CameraDialogProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<ClipRecorder | null>(null)
  const [facing, setFacing] = useState<CameraFacing>('user')
  const [mode, setMode] = useState<CameraMode>('photo')
  const [failure, setFailure] = useState<StageFailure | null>(null)
  const [recording, setRecording] = useState(false)
  /** The stream is playing; until then the frame says that it is waiting. */
  const [playing, setPlaying] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [clip, setClip] = useState<File | null>(null)
  /** A taken still awaiting Use; the popup stays open until it is used. */
  const [still, setStill] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  /** Remaining countdown seconds before a still, or null when not counting. */
  const [countdown, setCountdown] = useState<number | null>(null)
  /** The shutter waits before a still by default, the way a camera app does. */
  const [countdownOn, setCountdownOn] = useState(true)
  // A retry re-runs the open effect without closing the popup.
  const [attempt, setAttempt] = useState(0)
  // The popup offers the clip mode only where a draft can carry a video file.
  const clipMode = useMemo(() => canRecordClip && clipMediaType() !== null, [canRecordClip])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    let live: MediaStream | null = null
    setFailure(null)
    setPlaying(false)
    void openCamera(facing).then((stream) => {
      if (cancelled) {
        for (const track of stream.getTracks()) track.stop()
        return
      }
      live = stream
      streamRef.current = stream
      const video = videoRef.current
      /* v8 ignore next -- the stage renders its video before the stream can resolve. */
      if (video === null) return
      video.srcObject = stream
      // Muted inline autoplay; a refused play leaves the last frame on screen
      // rather than failing an otherwise usable camera.
      void video.play().then(() => { if (!cancelled) setPlaying(true) }).catch(() => {})
    }).catch((error: unknown) => {
      if (!cancelled) setFailure(error instanceof CameraError ? error.kind : 'unavailable')
    })
    return () => {
      cancelled = true
      // A close during recording still finalizes the recorder before the
      // device is released, so no half-written clip outlives the popup.
      void recorderRef.current?.stop().catch(() => {})
      recorderRef.current = null
      streamRef.current = null
      if (live !== null) for (const track of live.getTracks()) track.stop()
      const video = videoRef.current
      if (video !== null) video.srcObject = null
    }
  }, [open, facing, attempt])

  // Every open starts on the photo mode with no clip.
  useEffect(() => {
    if (!open) return
    setMode('photo')
    setClip(null)
    setStill(null)
    setElapsed(0)
    setRecording(false)
    setCountdown(null)
  }, [open])

  /** Stop the running recorder and keep its file for review. */
  const endClip = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder === null) return
    recorderRef.current = null
    setRecording(false)
    void recorder.stop().then((file) => { setClip(file) }).catch(() => { setFailure('capture') })
  }, [])

  // One clock drives the recording pill; the cap stops a clip that runs long.
  useEffect(() => {
    if (!recording) return
    const started = Date.now()
    const tick = window.setInterval(() => { setElapsed(Date.now() - started) }, 250)
    const cap = window.setTimeout(() => { endClip() }, MAX_CLIP_MS)
    return () => {
      window.clearInterval(tick)
      window.clearTimeout(cap)
    }
  }, [recording, endClip])

  // The review shows the captured bytes; each URL dies with its capture.
  const clipUrl = useMemo(() => (clip === null ? null : URL.createObjectURL(clip)), [clip])
  const stillUrl = useMemo(() => (still === null ? null : URL.createObjectURL(still)), [still])
  useEffect(() => () => { if (clipUrl !== null) URL.revokeObjectURL(clipUrl) }, [clipUrl])
  useEffect(() => () => { if (stillUrl !== null) URL.revokeObjectURL(stillUrl) }, [stillUrl])

  const takeStill = useCallback(() => {
    const video = videoRef.current
    /* v8 ignore next -- the shutter stays disabled until the stage has its video. */
    if (video === null || busy) return
    setBusy(true)
    void grabFrame(video, `photo-${Date.now()}.jpg`).then((file) => {
      setBusy(false)
      setStill(file)
    }).catch(() => {
      setBusy(false)
      setFailure('capture')
    })
  }, [busy])

  // One tick per remaining second; the run that reaches zero takes the still.
  useEffect(() => {
    if (countdown === null) return
    if (countdown === 0) {
      setCountdown(null)
      takeStill()
      return
    }
    const id = window.setTimeout(() => {
      setCountdown(current => (current === null ? null : current - 1))
    }, 1000)
    return () => { window.clearTimeout(id) }
  }, [countdown, takeStill])

  const beginClip = useCallback(() => {
    const live = streamRef.current
    /* v8 ignore next -- the clip mode is disabled until the stream is open. */
    if (live === null) return
    try {
      recorderRef.current = startClipRecorder(live, `clip-${Date.now()}`)
    } catch {
      setFailure('capture')
      return
    }
    setClip(null)
    setElapsed(0)
    setRecording(true)
  }, [])

  /** Keep the reviewed capture: the still joins the images, the clip the files. */
  const useCapture = useCallback(() => {
    if (still !== null) onCapture([still])
    else if (clip !== null) onCaptureClip(clip)
    else return
    onClose()
  }, [clip, onCapture, onCaptureClip, onClose, still])

  const onShutter = useCallback(() => {
    if (mode === 'video') {
      if (recording) endClip()
      else beginClip()
      return
    }
    // A press during the count runs it back to zero without capturing.
    if (countdown !== null) {
      setCountdown(null)
      return
    }
    if (countdownOn) {
      setCountdown(COUNTDOWN_SECONDS)
      return
    }
    takeStill()
  }, [beginClip, countdown, countdownOn, endClip, mode, recording, takeStill])

  const reviewing = !recording && (mode === 'video' ? clip !== null : still !== null)
  const live = failure === null
  const shutterLabel = mode === 'photo'
    ? (countdown === null ? t('camera.take') : t('camera.cancelCountdown'))
    : (recording ? t('camera.stop') : t('camera.record'))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('camera.title')}
      headless
      width="min(1200px, calc(100vw - 32px))"
      className={clsx(css.dialog)}
    >
      <div className={css.card}>
        {/* The viewfinder is the card's own top edge, so the close control
            floats on it instead of taking a header row of its own. */}
        <div className={css.stage}>
          {live ? (
            <>
              <video
                ref={videoRef}
                className={css.video}
                data-mirrored={facing === 'user' ? '' : undefined}
                data-covered={reviewing ? '' : undefined}
                muted
                playsInline
                autoPlay
              />
              {reviewing && stillUrl !== null && (
                <img className={css.clip} src={stillUrl} alt={t('camera.review')} data-mirrored={facing === 'user' ? '' : undefined} />
              )}
              {reviewing && clipUrl !== null && clip !== null && (
                <div className={css.clipPlayer}>
                  <VideoPlayer
                    src={clipUrl}
                    label={t('camera.review')}
                    saveName={clip.name}
                    mirrored={facing === 'user'}
                    fit="cover"
                    labels={{
                      play: t('video.play'),
                      pause: t('video.pause'),
                      mute: t('video.mute'),
                      unmute: t('video.unmute'),
                      seek: t('video.seek'),
                      volume: t('video.volume'),
                      fullscreen: t('video.fullscreen'),
                      exitFullscreen: t('video.exitFullscreen'),
                      save: t('video.save'),
                      download: t('video.download'),
                    }}
                  />
                </div>
              )}
              {!playing && !reviewing && (
                <div className={css.pending} role="status">
                  <IconLucideCamera className={css.pendingGlyph} />
                  <p className={css.pendingText}>{t('camera.pending')}</p>
                  <p className={css.pendingHint}>{t('camera.pendingHint')}</p>
                </div>
              )}
              {recording && (
                <div className={css.rec} role="status">
                  <span className={css.recDot} aria-hidden />
                  <span>{elapsedLabel(elapsed)}</span>
                </div>
              )}
              {countdown !== null && (
                <div className={css.countdown}>
                  <span key={countdown} className={css.countdownNumber} aria-live="assertive">{countdown}</span>
                </div>
              )}
              {/* The mode switch rides the viewfinder as one capsule, the way a
                  camera app floats its still/clip pair over the frame. */}
              {!reviewing && (
                <div className={css.modeSwitch} role="group" aria-label={t('camera.mode')}>
                  <button
                    type="button"
                    className={css.modeButton}
                    data-active={mode === 'photo' ? '' : undefined}
                    aria-pressed={mode === 'photo'}
                    aria-label={t('camera.photo')}
                    disabled={recording}
                    // Leaving the clip clears it: the recording belongs to Video.
                    onClick={() => { setMode('photo'); setClip(null); setStill(null); setElapsed(0); setCountdown(null) }}
                  >
                    <IconLucideCamera className={css.modeGlyph} />
                  </button>
                  <button
                    type="button"
                    className={css.modeButton}
                    data-active={mode === 'video' ? '' : undefined}
                    aria-pressed={mode === 'video'}
                    aria-label={t('camera.video')}
                    disabled={recording || !clipMode}
                    onClick={() => { setMode('video'); setStill(null); setCountdown(null) }}
                  >
                    <IconLucideVideo className={css.modeGlyph} />
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className={css.failure} role="alert">
              <p className={css.failureText}>{failureText(failure, t)}</p>
              <Button variant="outline" size="sm" onClick={() => { setAttempt(current => current + 1) }}>
                {t('camera.retry')}
              </Button>
            </div>
          )}
        </div>
        <button type="button" className={css.close} aria-label={t('camera.close')} onClick={onClose}>
          <IconCloseOutline16 size={14} />
        </button>
        <div className={css.controls} data-reviewing={reviewing ? '' : undefined}>
          {reviewing ? (
            <>
              <button type="button" className={css.actionPrimary} onClick={useCapture}>
                {t('camera.use')}
              </button>
              <button
                type="button"
                className={css.action}
                onClick={() => { setClip(null); setStill(null); setElapsed(0) }}
              >
                {t('camera.retake')}
              </button>
            </>
          ) : (
            <>
              {mode === 'photo' ? (
                <Tooltip label={t('camera.countdown')} side="top">
                  <button
                    type="button"
                    className={css.timer}
                    aria-label={t('camera.countdown')}
                    aria-pressed={countdownOn}
                    disabled={!live || recording}
                    onClick={() => { setCountdownOn(enabled => !enabled); setCountdown(null) }}
                  >
                    <IconLucideTimer className={css.timerGlyph} />
                  </button>
                </Tooltip>
              ) : <span aria-hidden />}
              <button
                type="button"
                className={css.shutter}
                data-recording={recording ? '' : undefined}
                aria-label={shutterLabel}
                disabled={!live || busy}
                onClick={onShutter}
              >
                <span className={css.shutterCore} aria-hidden />
              </button>
              <div className={css.flipSeat}>
                <Tooltip label={t('camera.flip')} side="top">
                  <button
                    type="button"
                    className={css.flip}
                    aria-label={t('camera.flip')}
                    disabled={!live || recording}
                    onClick={() => { setFacing(previous => (previous === 'user' ? 'environment' : 'user')) }}
                  >
                    <IconLucideSwitchCamera className={css.flipIcon} />
                  </button>
                </Tooltip>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
