/** The generated clip's playback chrome: flat faces with dark glyphs over the clip's lower edge. @module */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  IconLucideDownload, IconLucideEllipsisVertical, IconLucideMaximize2, IconLucideMinimize2,
  IconLucidePause, IconLucidePlay, IconLucideVolume2, IconLucideVolumeX, Tooltip,
} from '@aeven/client-ui-primitives'
import type { PropsLocale } from '@aeven/client-ui-slots'
import { saveClip, seekClip, toggleClip, toggleFullscreen } from './playback.ts'
import css from './VideoControls.module.css'

/** A run of seconds as `m:ss`; a clip whose metadata has not loaded shows none. */
function clockTime(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Props of one clip's playback chrome. */
export interface VideoControlsProps {
  /** The clip's own element. */
  video: HTMLVideoElement
  /** The element the clip plays in, which takes the full-screen request. */
  player: HTMLDivElement
  /** Whether the element is playing, from its own events. */
  playing: boolean
  /** Whether playback has left the pointer alone long enough to clear the chrome. */
  idle: boolean
  /** Playback position in seconds, from the element's own events and seeks. */
  current: number
  /** Clip length in seconds, `NaN` until its metadata loads. */
  duration: number
  /** File name the clip is saved under. */
  saveName: string
  /** Reports a seek, so the readout and scrubber follow the same position. */
  onSeek: (seconds: number) => void
  /** The Imagine translator. */
  t: PropsLocale<'imagine'>['t']
}

/**
 * The controls over a generated clip: the play disc, the elapsed readout, the
 * scrubber, the volume disc with its level, the save popup, and the full-screen
 * disc. The clip's own events drive every face, and the bar clears itself while
 * a playing clip is left alone.
 * @param props - the clip and its player, element-driven playback state, the save name, the seek report, and translator.
 * @returns the clip's playback chrome.
 */
export function VideoControls({
  video, player, playing, idle, current, duration, saveName, onSeek, t,
}: VideoControlsProps) {
  const [muted, setMuted] = useState(video.muted)
  const [volume, setVolume] = useState(video.volume)
  const [fullscreen, setFullscreen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveCard, setSaveCard] = useState<CSSProperties | null>(null)
  const saveRef = useRef<HTMLButtonElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  // The last level the clip had sound at, so leaving silence restores the sound
  // the disc took away rather than leaving the clip quiet at zero.
  const audible = useRef(video.volume === 0 ? 1 : video.volume)
  // Full screen is a document-level state: the browser's own escape key and
  // gesture leave it without this component running anything.
  useEffect(() => {
    const sync = (): void => { setFullscreen(document.fullscreenElement === player) }
    document.addEventListener('fullscreenchange', sync)
    return () => { document.removeEventListener('fullscreenchange', sync) }
  }, [player])

  // One level for one sound: a muted clip and a clip at zero are the same
  // silence to every face of this bar.
  const silent = muted || volume === 0

  const toggleMute = (): void => {
    const next = !silent
    video.muted = next
    if (!next && video.volume === 0) video.volume = audible.current
    setMuted(video.muted)
    setVolume(video.volume)
  }

  const setLevel = (level: number): void => {
    video.volume = level
    video.muted = level === 0
    if (level > 0) audible.current = level
    setVolume(level)
    setMuted(video.muted)
  }

  // The save card is the composer's own popup, placed like one: fixed above the
  // disc it belongs to, because the clip's frame clips every child it holds.
  useEffect(() => {
    if (!saveOpen) return
    const place = (): void => {
      const rect = saveRef.current?.getBoundingClientRect()
      if (rect === undefined) return
      setSaveCard({ right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.top + 8 })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSaveOpen(false)
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (saveRef.current?.contains(target) === true) return
      if (cardRef.current?.contains(target) === true) return
      setSaveOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [saveOpen])

  // A clip that cleared its own chrome takes the card with it: the disc the card
  // belongs to is no longer on the clip.
  useEffect(() => {
    if (idle) setSaveOpen(false)
  }, [idle])

  const download = (): void => {
    setSaveOpen(false)
    saveClip(video.currentSrc === '' ? video.src : video.currentSrc, saveName)
  }

  const playLabel = playing ? t('video.pause') : t('video.play')
  const muteLabel = silent ? t('video.unmute') : t('video.mute')
  const fullscreenLabel = fullscreen ? t('video.exitFullscreen') : t('video.fullscreen')
  const total = Number.isFinite(duration) ? duration : 0
  const level = silent ? 0 : volume
  return (
    <div className={css.controls} data-video-controls="" data-idle={idle ? 'true' : undefined}>
      <Tooltip label={playLabel} side="top">
        <button
          type="button"
          className={css.play}
          data-video-toggle-play=""
          aria-label={playLabel}
          onClick={() => { toggleClip(video) }}
        >
          {playing ? <IconLucidePause /> : <IconLucidePlay />}
        </button>
      </Tooltip>
      <span className={css.time} data-video-time="">{clockTime(current)} / {clockTime(duration)}</span>
      <span className={css.seekBox}>
        <span className={css.trackRail} />
        <span
          className={css.trackFill}
          data-video-progress=""
          style={{ '--track-progress': `${total > 0 ? Math.min(100, (current / total) * 100) : 0}%` } as CSSProperties}
        />
        <input
          type="range"
          className={css.slider}
          data-video-seek=""
          min={0}
          max={total}
          step="any"
          value={current}
          aria-label={t('video.seek')}
          onChange={(event) => {
            const seconds = Number(event.currentTarget.value)
            seekClip(video, seconds)
            onSeek(seconds)
          }}
        />
      </span>
      <Tooltip label={muteLabel} side="top">
        <button
          type="button"
          className={css.control}
          data-video-toggle-mute=""
          aria-label={muteLabel}
          onClick={toggleMute}
        >
          {silent ? <IconLucideVolumeX /> : <IconLucideVolume2 />}
        </button>
      </Tooltip>
      <span className={css.volumeBox}>
        <span className={css.trackRail} />
        <span
          className={css.trackFill}
          data-video-volume-level=""
          style={{ '--track-progress': `${level * 100}%` } as CSSProperties}
        />
        <input
          type="range"
          className={css.slider}
          data-video-volume=""
          min={0}
          max={1}
          step={0.05}
          value={level}
          aria-label={t('video.volume')}
          onChange={(event) => { setLevel(Number(event.currentTarget.value)) }}
        />
      </span>
      <Tooltip label={t('video.save')} side="top">
        <button
          ref={saveRef}
          type="button"
          className={css.control}
          data-video-save=""
          aria-label={t('video.save')}
          aria-haspopup="menu"
          aria-expanded={saveOpen}
          onClick={() => { setSaveOpen(!saveOpen) }}
        >
          <IconLucideEllipsisVertical />
        </button>
      </Tooltip>
      {saveOpen && saveCard !== null && createPortal(
        <div
          className={css.saveCard}
          ref={cardRef}
          role="menu" aria-label={t('video.save')} style={saveCard}>
          <button
            type="button"
            role="menuitem"
            className={css.saveRow}
            data-video-download=""
            onClick={download}
          >
            <span className={css.saveRowIcon} aria-hidden>
              <IconLucideDownload className={css.saveRowGlyph} />
            </span>
            <span className={css.saveRowLabel}>{t('video.download')}</span>
          </button>
        </div>,
        document.body,
      )}
      <Tooltip label={fullscreenLabel} side="top">
        <button
          type="button"
          className={css.control}
          data-video-toggle-fullscreen=""
          aria-label={fullscreenLabel}
          onClick={() => { toggleFullscreen(player) }}
        >
          {fullscreen ? <IconLucideMinimize2 /> : <IconLucideMaximize2 />}
        </button>
      </Tooltip>
    </div>
  )
}
