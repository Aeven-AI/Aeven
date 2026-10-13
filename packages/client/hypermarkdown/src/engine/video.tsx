import { memo, useEffect, useMemo, useState } from 'react'

import type { RendererHost } from './components.tsx'
import { defaultIcons, defaultTranslations } from './config.ts'
import { videoOembedUrl, videoPlayerUrl, youtubePosterUrl, type VideoRef } from './video-url.ts'

/** The properties `rehypeVideoEmbed` stamps on a video element. */
interface VideoProps {
  'data-provider'?: string | undefined
  'data-video-id'?: string | undefined
  'data-video-hash'?: string | undefined
  'data-video-start'?: string | undefined
  'data-title'?: string | undefined
  renderer?: RendererHost | undefined
  scrollDown?: unknown
}

/** Widest still YouTube serves in place of a `maxresdefault` it does not have, in pixels. */
const YOUTUBE_MISSING_STILL_WIDTH = 120

/** Milliseconds a Vimeo id must hold still before its poster is looked up, so a streaming link does not look up each prefix of its id. */
const POSTER_LOOKUP_DELAY_MS = 300

/**
 * The poster Vimeo's oEmbed endpoint names for a video.
 * @param video - A Vimeo video.
 * @param signal - Cancels the lookup when the video changes.
 * @returns The poster address, or undefined when Vimeo names none.
 */
async function vimeoPoster(video: VideoRef, signal: AbortSignal): Promise<string | undefined> {
  const response = await fetch(videoOembedUrl(video), { signal, credentials: 'omit', referrerPolicy: 'no-referrer' })

  if (!response.ok) return undefined

  const poster: unknown = (await response.json() as { thumbnail_url?: unknown }).thumbnail_url

  return typeof poster === 'string' && poster.startsWith('https://i.vimeocdn.com/') ? poster : undefined
}

/**
 * A YouTube or Vimeo video in a reply, drawn as its poster with a play button
 * until the reader starts it.
 *
 * The provider's player loads only on that click: a reply that lists several
 * videos, and every transcript replayed later, loads stills rather than one
 * player per video. The player address is rebuilt from the video's identity
 * (see `video-url.ts`); YouTube plays from its no-cookie host and Vimeo with
 * do-not-track. The frame sends the page's origin as its referrer, which
 * YouTube's player requires before it will play. The tile keeps one shape
 * whether it shows the poster or the player, and shows the same loading
 * surface an image tile does until its poster arrives, carrying `data-loaded`
 * once it has.
 */
function MarkdownVideo(props: VideoProps) {
  const provider = props['data-provider']
  const id = props['data-video-id'] ?? ''
  const hash = props['data-video-hash']
  const start = props['data-video-start']
  const title = props['data-title']
  const translations = props.renderer?.ui.translations ?? defaultTranslations
  const icons = props.renderer?.ui.icons ?? defaultIcons

  const video = useMemo<VideoRef | undefined>(() => {
    if (provider !== 'youtube' && provider !== 'vimeo') return undefined
    return { provider, id, hash, start: start === undefined ? undefined : Number(start) }
  }, [provider, id, hash, start])

  // Keyed by the video, so a link that changes while streaming never keeps
  // playing the previous one.
  const [playing, setPlaying] = useState<string | undefined>(undefined)
  const key = video === undefined ? undefined : `${video.provider}:${video.id}:${video.hash ?? ''}`
  const [vimeoStill, setVimeoStill] = useState<{ key: string; src: string } | undefined>(undefined)
  const [loadedPoster, setLoadedPoster] = useState<string | undefined>(undefined)
  // A video without an HD still falls back to the one every video has.
  const [smallStill, setSmallStill] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (video?.provider !== 'vimeo' || key === undefined) return

    const controller = new AbortController()
    const timer = setTimeout(() => {
      vimeoPoster(video, controller.signal)
        .then((src) => { if (src !== undefined) setVimeoStill({ key, src }) })
        // A missing poster leaves the tile on its plain background; the video
        // still plays.
        .catch(() => undefined)
    }, POSTER_LOOKUP_DELAY_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [video, key])

  if (video === undefined || key === undefined) return null

  const poster = video.provider === 'youtube'
    ? youtubePosterUrl(video.id, smallStill === key ? 'hqdefault' : 'maxresdefault')
    : vimeoStill?.key === key ? vimeoStill.src : undefined
  const showingLargeStill = video.provider === 'youtube' && smallStill !== key
  const label = title === undefined
    ? translations.playVideoUntitled
    : translations.playVideo.replace('{title}', title)

  return (
    <div
      className="markdown-video"
      data-provider={video.provider}
      data-loaded={poster !== undefined && loadedPoster === poster ? true : undefined}
    >
      {playing === key ? (
        <iframe
          className="markdown-video-player"
          src={videoPlayerUrl(video)}
          title={title ?? label}
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <button
          type="button"
          className="markdown-video-poster"
          aria-label={label}
          title={title}
          onClick={() => { setPlaying(key) }}
        >
          {poster !== undefined && (
            <img
              className="markdown-video-still"
              src={poster}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onLoad={(event) => {
                // YouTube answers a missing HD still with a small grey one.
                if (showingLargeStill && event.currentTarget.naturalWidth <= YOUTUBE_MISSING_STILL_WIDTH) {
                  setSmallStill(key)
                  return
                }
                setLoadedPoster(poster)
              }}
              onError={() => { if (showingLargeStill) setSmallStill(key) }}
            />
          )}
          <span className="image-loader" />
          <span
            className="markdown-video-play"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: icons.play }}
          />
        </button>
      )}
    </div>
  )
}

const MemoMarkdownVideo = memo(
  MarkdownVideo,
  (prev, next) => prev['data-provider'] === next['data-provider']
    && prev['data-video-id'] === next['data-video-id']
    && prev['data-video-hash'] === next['data-video-hash']
    && prev['data-video-start'] === next['data-video-start']
    && prev['data-title'] === next['data-title']
    && prev.renderer === next.renderer,
)

MemoMarkdownVideo.displayName = 'MarkdownVideo'

export default MemoMarkdownVideo
