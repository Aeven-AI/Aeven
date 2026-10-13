/**
 * The YouTube and Vimeo addresses the renderer plays inline, and the player and
 * poster addresses it builds for them.
 *
 * Only the video's identity is read from an authored link; every address the
 * renderer loads is rebuilt here from that identity, so a link never chooses
 * what a frame on the page points at.
 */

/** One video a link names. */
export interface VideoRef {
  readonly provider: 'youtube' | 'vimeo'
  /** The provider's id: 11 characters for YouTube, digits for Vimeo. */
  readonly id: string
  /** Vimeo's privacy hash for an unlisted video, which the player requires. */
  readonly hash?: string | undefined
  /** Second the player starts at, when the link names one. */
  readonly start?: number | undefined
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const VIMEO_ID = /^\d{6,12}$/
const VIMEO_HASH = /^[0-9a-f]{6,20}$/i

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'])
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'])

/**
 * A start offset as YouTube and Vimeo write it: `90`, `90s`, or `1h2m3s`.
 * @param value - The `t` or `start` value, if any.
 * @returns Whole seconds, or undefined for a missing or unreadable value.
 */
function startSeconds(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (/^\d+s?$/.test(value)) return Number.parseInt(value, 10) || undefined

  const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value)
  if (parts === null) return undefined

  const seconds = Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0)
  return seconds > 0 ? seconds : undefined
}

/**
 * The YouTube video a URL names.
 * @param url - A parsed link on a YouTube host.
 * @returns The video, or undefined for a channel, playlist or other page.
 */
function youtube(url: URL): VideoRef | undefined {
  const start = startSeconds(url.searchParams.get('t') ?? url.searchParams.get('start'))

  if (url.hostname === 'youtu.be') {
    const id = url.pathname.slice(1)
    return YOUTUBE_ID.test(id) ? { provider: 'youtube', id, start } : undefined
  }

  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v') ?? ''
    return YOUTUBE_ID.test(id) ? { provider: 'youtube', id, start } : undefined
  }

  const [, kind, id = ''] = url.pathname.split('/')

  return YOUTUBE_ID.test(id) && (kind === 'shorts' || kind === 'embed' || kind === 'live' || kind === 'v')
    ? { provider: 'youtube', id, start }
    : undefined
}

/**
 * The Vimeo video a URL names: `vimeo.com/ID`, `vimeo.com/ID/HASH`, a channel
 * or group page ending in the id, or a player address.
 * @param url - A parsed link on a Vimeo host.
 * @returns The video, or undefined for a profile, showcase or other page.
 */
function vimeo(url: URL): VideoRef | undefined {
  const segments = url.pathname.split('/').filter(segment => segment !== '')
  const start = startSeconds(/(?:^|&)t=([^&]+)/.exec(url.hash.slice(1))?.[1])

  if (url.hostname === 'player.vimeo.com') {
    const [video, id = ''] = segments
    const hash = url.searchParams.get('h') ?? undefined
    if (video !== 'video' || !VIMEO_ID.test(id)) return undefined
    return { provider: 'vimeo', id, hash: hash !== undefined && VIMEO_HASH.test(hash) ? hash : undefined, start }
  }

  const idIndex = segments.findIndex(segment => VIMEO_ID.test(segment))
  if (idIndex === -1) return undefined

  const before = segments.slice(0, idIndex)
  const owned = before.length === 0
    || (before.length === 2 && before[0] === 'channels')
    || (before.length === 3 && before[0] === 'groups' && before[2] === 'videos')
  const after = segments.slice(idIndex + 1)

  if (!owned || after.length > 1 || (after.length === 1 && !VIMEO_HASH.test(after[0] ?? ''))) return undefined

  return { provider: 'vimeo', id: segments[idIndex] ?? '', hash: after[0], start }
}

/**
 * The video a link points at, when it points at one this renderer can play.
 * @param href - The link's destination, as authored.
 * @returns The video, or undefined for every other destination.
 */
export function parseVideoUrl(href: string): VideoRef | undefined {
  let url: URL

  try {
    url = new URL(href)
  } catch {
    // A relative or malformed destination names no video.
    return undefined
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined

  const host = url.hostname.toLowerCase()
  if (host === 'youtu.be' || YOUTUBE_HOSTS.has(host)) return youtube(url)
  if (VIMEO_HOSTS.has(host)) return vimeo(url)

  return undefined
}

/**
 * The player a video plays in once the reader starts it. It autoplays, since
 * the reader's click is what loads it.
 * @param video - The video.
 * @returns The embed address, on YouTube's no-cookie host or Vimeo's do-not-track player.
 */
export function videoPlayerUrl(video: VideoRef): string {
  if (video.provider === 'youtube') {
    const params = new URLSearchParams({ autoplay: '1', playsinline: '1', rel: '0' })
    if (video.start !== undefined) params.set('start', String(video.start))
    return `https://www.youtube-nocookie.com/embed/${video.id}?${params.toString()}`
  }

  const params = new URLSearchParams({ autoplay: '1', dnt: '1' })
  if (video.hash !== undefined) params.set('h', video.hash)
  const start = video.start === undefined ? '' : `#t=${String(video.start)}s`
  return `https://player.vimeo.com/video/${video.id}?${params.toString()}${start}`
}

/**
 * The page a video lives on, which is what the oEmbed lookup takes.
 * @param video - The video.
 * @returns The canonical watch address.
 */
export function videoPageUrl(video: VideoRef): string {
  if (video.provider === 'youtube') return `https://www.youtube.com/watch?v=${video.id}`
  return video.hash === undefined ? `https://vimeo.com/${video.id}` : `https://vimeo.com/${video.id}/${video.hash}`
}

/**
 * Vimeo's oEmbed lookup for a video, which names its poster and answers
 * cross-origin reads.
 * @param video - A Vimeo video.
 * @returns The oEmbed JSON address.
 */
export function videoOembedUrl(video: VideoRef): string {
  return `https://vimeo.com/api/oembed.json?width=1280&url=${encodeURIComponent(videoPageUrl(video))}`
}

/**
 * The still a YouTube video is known by. `maxresdefault` is 16:9 and sharp but
 * exists only for videos uploaded in HD; `hqdefault` exists for every video
 * and is 4:3, with black bands above and below a widescreen picture.
 * @param id - The YouTube id.
 * @param size - Which still.
 * @returns The poster image address.
 */
export function youtubePosterUrl(id: string, size: 'maxresdefault' | 'hqdefault'): string {
  return `https://i.ytimg.com/vi/${id}/${size}.jpg`
}
