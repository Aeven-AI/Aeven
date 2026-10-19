/** A clip played in place, wearing the product's own playback chrome. @module */
import { useEffect, useState } from 'react'
import { VideoControls } from './VideoControls.tsx'
import { toggleClip } from './video-playback.ts'
import css from './VideoPlayer.module.css'

/** How long a playing clip is left alone before its chrome clears, in ms. */
const IDLE_MS = 2500

/** The chrome's sentences, supplied by the owning feature's dictionary. */
export interface VideoPlayerLabels {
  /** Start playback. */
  readonly play: string
  /** Hold playback. */
  readonly pause: string
  /** Silence the clip. */
  readonly mute: string
  /** Restore the clip's sound. */
  readonly unmute: string
  /** Playback position, the scrubber's accessible name. */
  readonly seek: string
  /** Volume, the level slider's accessible name. */
  readonly volume: string
  /** Take the clip to the full-screen surface. */
  readonly fullscreen: string
  /** Leave the full-screen surface. */
  readonly exitFullscreen: string
  /** Open the save options. */
  readonly save: string
  /** Save the clip to the reader's downloads. */
  readonly download: string
}

/** Props of one clip's player. */
export interface VideoPlayerProps {
  /** Same-origin URL of the clip. */
  src: string
  /** Accessible name of the video element. */
  label: string
  /** File name the clip is saved under. */
  saveName: string
  /** The owning feature's chrome sentences. */
  labels: VideoPlayerLabels
  /** Reports the clip's own width-to-height ratio once its metadata loads. */
  onRatio?: (ratio: number) => void
  /** Mirrors the picture only, leaving the chrome in its reading direction. */
  mirrored?: boolean
  /** How the picture meets its frame: the whole clip, or the frame filled. */
  fit?: 'contain' | 'cover'
}

/**
 * Play the stored clip under the product's own controls. The element's events
 * drive every face, so a keyboard or media-key playback keeps the bar honest.
 * @param props - clip URL, accessible name, save name, translator, and ratio report.
 * @returns the clip with its playback chrome over the lower edge.
 */
export function VideoPlayer({ src, label, saveName, labels, onRatio, mirrored = false, fit = 'contain' }: VideoPlayerProps) {
  // The elements are state, not refs: the controls mount with both in hand, so
  // no gesture can run against a missing element.
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [player, setPlayer] = useState<HTMLDivElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(Number.NaN)
  const [idle, setIdle] = useState(false)
  const [gestures, setGestures] = useState(0)

  // A playing clip clears its own chrome once the pointer has left it alone.
  // Any movement over the clip, and any hold or end, brings it straight back;
  // a held clip keeps the chrome at all times.
  useEffect(() => {
    if (!playing) {
      setIdle(false)
      return
    }
    setIdle(false)
    const timer = setTimeout(() => { setIdle(true) }, IDLE_MS)
    return () => { clearTimeout(timer) }
  }, [playing, gestures])
  return (
    <div
      className={css.player}
      ref={setPlayer}
      data-video-player=""
      onPointerEnter={() => { setGestures(count => count + 1) }}
      onPointerMove={() => { setGestures(count => count + 1) }}
      onPointerLeave={() => { if (playing) setIdle(true) }}
    >
      <video
        ref={setVideo}
        className={css.video}
        data-mirrored={mirrored ? '' : undefined}
        data-fit={fit}
        src={src}
        playsInline
        preload="metadata"
        aria-label={label}
        onClick={(event) => { toggleClip(event.currentTarget) }}
        onLoadedMetadata={(event) => {
          const clip = event.currentTarget
          setDuration(clip.duration)
          const ratio = clip.videoWidth / clip.videoHeight
          if (Number.isFinite(ratio) && ratio > 0) onRatio?.(ratio)
        }}
        onTimeUpdate={(event) => { setCurrent(event.currentTarget.currentTime) }}
        onPlay={() => { setPlaying(true) }}
        onPause={() => { setPlaying(false) }}
        onEnded={(event) => {
          setPlaying(false)
          setCurrent(event.currentTarget.duration)
        }}
      />
      {video !== null && player !== null && (
        <VideoControls
          video={video}
          player={player}
          playing={playing}
          idle={idle}
          current={current}
          duration={duration}
          saveName={saveName}
          onSeek={setCurrent}
          labels={labels}
        />
      )}
    </div>
  )
}
