/** A sound file played in place: play, elapsed and total time, a scrubber, and mute, in one grey bar. @module */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconLucidePause, IconLucidePlay, IconLucideVolume2, IconLucideVolumeX } from './icons/index.tsx'
import { Spinner } from './Spinner.tsx'
import type { VideoPlayerLabels } from './VideoPlayer.tsx'
import css from './AudioPlayer.module.css'

/** The player's sentences: the clip player's play, pause, mute, unmute, and position names. */
export type AudioPlayerLabels = Pick<VideoPlayerLabels, 'play' | 'pause' | 'mute' | 'unmute' | 'seek'>

/**
 * Minutes and seconds of a position.
 * @param seconds - the position, or NaN while unknown.
 * @returns `m:ss`.
 */
function clock(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`
}

/** Props of one sound file's player. */
export interface AudioPlayerProps {
  /** URL of the sound, or null while it is not yet available; the bar then shows a spinner in place of play. */
  src: string | null
  /** Accessible name of the player, usually the file name. */
  label: string
  /** The owning feature's sentences. */
  labels: AudioPlayerLabels
  /** Content after the controls, such as a remove button. */
  trailing?: ReactNode
}

/**
 * Play a sound file under simple controls in a grey bar.
 * @param props - the sound, its name, sentences, and trailing content.
 * @returns the player bar.
 */
export function AudioPlayer({ src, label, labels, trailing }: AudioPlayerProps) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(Number.NaN)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    setPlaying(false)
    setCurrent(0)
    setDuration(Number.NaN)
  }, [src])

  const toggle = (): void => {
    const element = audio.current
    if (element === null) return
    if (element.paused) void element.play()
    else element.pause()
  }

  const toggleMute = (): void => {
    const element = audio.current
    if (element === null) return
    element.muted = !element.muted
    setMuted(element.muted)
  }

  const known = Number.isFinite(duration) && duration > 0
  const progress = known ? Math.min(1, current / duration) : 0
  return (
    <div className={css.player} role="group" aria-label={label}>
      {src !== null && (
        <audio
          ref={audio}
          src={src}
          preload="metadata"
          onLoadedMetadata={(event) => { setDuration(event.currentTarget.duration) }}
          onDurationChange={(event) => { setDuration(event.currentTarget.duration) }}
          onTimeUpdate={(event) => { setCurrent(event.currentTarget.currentTime) }}
          onPlay={() => { setPlaying(true) }}
          onPause={() => { setPlaying(false) }}
          onEnded={() => { setPlaying(false) }}
        />
      )}
      <button
        type="button"
        className={css.button}
        aria-label={playing ? labels.pause : labels.play}
        disabled={src === null}
        onClick={toggle}
      >
        {src === null ? <Spinner /> : playing ? <IconLucidePause /> : <IconLucidePlay />}
      </button>
      <span className={css.time}>{clock(current)} / {clock(duration)}</span>
      <input
        type="range"
        className={css.seek}
        aria-label={labels.seek}
        min={0}
        max={known ? duration : 1}
        step="any"
        value={known ? current : 0}
        disabled={!known}
        style={{ '--avn-audio-progress': `${String(progress * 100)}%` } as React.CSSProperties}
        onChange={(event) => {
          const element = audio.current
          const position = Number(event.currentTarget.value)
          if (element === null || !Number.isFinite(position)) return
          element.currentTime = position
          setCurrent(position)
        }}
      />
      <button
        type="button"
        className={css.button}
        aria-label={muted ? labels.unmute : labels.mute}
        disabled={src === null}
        onClick={toggleMute}
      >
        {muted ? <IconLucideVolumeX /> : <IconLucideVolume2 />}
      </button>
      {trailing}
    </div>
  )
}
