/** A clip played in place, wearing the product's own playback chrome. @module */
import { useEffect, useState, type ReactNode } from 'react'
import { VideoControls } from './VideoControls.tsx'
import { saveClip, toggleClip } from './video-playback.ts'
import type { ClipMedia } from './video-playback.ts'
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

/** The dictionary keys the clip player's chrome reads. */
export type VideoPlayerLabelKey =
  | 'video.play'
  | 'video.pause'
  | 'video.mute'
  | 'video.unmute'
  | 'video.seek'
  | 'video.volume'
  | 'video.fullscreen'
  | 'video.exitFullscreen'
  | 'video.save'
  | 'video.download'

/**
 * Read the clip player's chrome sentences from a surface's own dictionary.
 * @param t - the owning surface's translator, which carries every `video.*` key.
 * @returns the labels the player and its controls read.
 */
export function videoPlayerLabels(t: (key: VideoPlayerLabelKey) => string): VideoPlayerLabels {
  return {
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
  }
}

/** Props of the shared player frame. */
export interface MediaPlayerProps {
  /** The playing element once mounted; the frame reads its state from the element's own events. */
  media: (HTMLElement & ClipMedia) | null
  /** The playing element's markup, whose ref hands the element back as `media`. */
  children: ReactNode
  /** Runs the save menu's row. */
  onDownload: () => void
  /** Whether that save is still running. */
  busy?: boolean
  /** The owning feature's chrome sentences. */
  labels: VideoPlayerLabels
}

/** Events after which the frame re-reads position, length, and playback from the element. */
const MEDIA_EVENTS = ['play', 'pause', 'timeupdate', 'loadedmetadata', 'durationchange', 'ready', 'seeked'] as const

/**
 * The product's player frame: the playback chrome over the lower edge of any element with the playback
 * members of {@link ClipMedia}, clearing itself while a playing clip is left alone.
 * @param props - the element and its markup, the save action, and translator.
 * @returns the element with its playback chrome.
 */
export function MediaPlayer({ media, children, onDownload, busy = false, labels }: MediaPlayerProps) {
  // The frame is state, not a ref: the controls mount with it in hand, so no
  // gesture can run against a missing element.
  const [player, setPlayer] = useState<HTMLDivElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(Number.NaN)
  const [idle, setIdle] = useState(false)
  const [gestures, setGestures] = useState(0)

  // The element's own events drive every face, so a keyboard or media-key
  // playback keeps the bar honest.
  useEffect(() => {
    if (media === null) return
    const read = (): void => {
      setPlaying(!media.paused)
      setCurrent(media.currentTime)
      setDuration(media.duration)
    }
    const ended = (): void => {
      setPlaying(false)
      setCurrent(media.duration)
    }
    read()
    for (const name of MEDIA_EVENTS) media.addEventListener(name, read)
    media.addEventListener('ended', ended)
    return () => {
      for (const name of MEDIA_EVENTS) media.removeEventListener(name, read)
      media.removeEventListener('ended', ended)
    }
  }, [media])

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
      {children}
      {media !== null && player !== null && (
        <VideoControls
          video={media}
          player={player}
          playing={playing}
          idle={idle}
          current={current}
          duration={duration}
          onDownload={onDownload}
          busy={busy}
          onSeek={setCurrent}
          labels={labels}
        />
      )}
    </div>
  )
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
 * Play the stored clip under the product's own controls.
 * @param props - clip URL, accessible name, save name, translator, and ratio report.
 * @returns the clip with its playback chrome over the lower edge.
 */
export function VideoPlayer({ src, label, saveName, labels, onRatio, mirrored = false, fit = 'contain' }: VideoPlayerProps) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  return (
    <MediaPlayer
      media={video}
      onDownload={() => { if (video !== null) saveClip(video.currentSrc === '' ? video.src : video.currentSrc, saveName) }}
      labels={labels}
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
          const ratio = clip.videoWidth / clip.videoHeight
          if (Number.isFinite(ratio) && ratio > 0) onRatio?.(ratio)
        }}
      />
    </MediaPlayer>
  )
}
