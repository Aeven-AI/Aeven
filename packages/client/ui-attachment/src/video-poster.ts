/** Video attachments: which files the trays show as videos, and the still each one's tile shows. */

import { useEffect, useState } from 'react'

/** Extensions of videos a browser plays, for an upload whose browser declared no media type. */
const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm', 'ogv'])

/** Longer edge of a poster, in pixels: two tile heights, sharp on a 2x screen. */
const POSTER_EDGE = 320

/** How long a poster may take before the tile gives up on it and shows its play mark alone. */
const POSTER_TIMEOUT_MS = 15_000

/**
 * Whether one attachment is a video the trays show as a playable tile.
 * @param name - display name including its extension, or undefined.
 * @param mediaType - browser-declared or stored media type, possibly empty.
 * @returns true for a video.
 */
export function isVideoAttachment(name: string | undefined, mediaType: string | undefined): boolean {
  if ((mediaType ?? '').trim().toLowerCase().startsWith('video/')) return true
  const lower = (name ?? '').toLowerCase()
  const dot = lower.lastIndexOf('.')
  return dot > 0 && VIDEO_EXTENSIONS.has(lower.slice(dot + 1))
}

/** Posters already made or in progress, by video URL. */
const posters = new Map<string, Promise<string>>()

/**
 * The first frame of a video as a JPEG data URL, made once per URL.
 * @param src - an object URL or a same-origin URL of the video.
 * @returns the poster; rejects when the browser cannot decode the video or the frame cannot be read.
 */
export function videoPoster(src: string): Promise<string> {
  const known = posters.get(src)
  if (known !== undefined) return known
  const made = new Promise<string>((resolve, reject) => {
    const video = document.createElement('video')
    const timer = window.setTimeout(() => { finish(new Error('video poster timed out')) }, POSTER_TIMEOUT_MS)
    function finish(error: Error | null, poster?: string): void {
      window.clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      if (error === null && poster !== undefined) resolve(poster)
      else reject(error ?? new Error('video poster failed'))
    }
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    // A frame a moment in avoids the black first frame many encoders start with.
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = Number.isFinite(video.duration) ? Math.min(0.1, video.duration / 2) : 0
    }, { once: true })
    video.addEventListener('seeked', () => {
      const scale = Math.min(1, POSTER_EDGE / Math.max(video.videoWidth, video.videoHeight, 1))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
      try {
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
        finish(null, canvas.toDataURL('image/jpeg', 0.82))
      } catch (error) {
        // A video served without CORS taints the canvas; the tile keeps its play mark alone.
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    }, { once: true })
    video.addEventListener('error', () => { finish(new Error('video could not be decoded')) }, { once: true })
    video.src = src
  })
  posters.set(src, made)
  made.catch(() => { posters.delete(src) })
  return made
}

/**
 * Posters for the given video URLs, made in the background as the URLs appear.
 * @param sources - video URLs; null entries are skipped.
 * @returns each finished URL's poster, or null when the browser could not make it; a URL still in progress is absent.
 */
export function useVideoPosters(sources: readonly (string | null)[]): ReadonlyMap<string, string | null> {
  const [states, setStates] = useState<ReadonlyMap<string, string | null>>(() => new Map())
  const key = sources.filter((src): src is string => src !== null).join('\n')
  useEffect(() => {
    const wanted = key === '' ? [] : key.split('\n')
    // Cleared when the URLs change or the tray unmounts, so a late poster sets no state.
    const run = { live: true }
    for (const src of wanted) {
      videoPoster(src).then(
        (poster) => { if (run.live) setStates(previous => new Map(previous).set(src, poster)) },
        () => { if (run.live) setStates(previous => new Map(previous).set(src, null)) },
      )
    }
    return () => { run.live = false }
  }, [key])
  return states
}
