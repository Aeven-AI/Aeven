/**
 * A voice note player: a play button, the recording's waveform, which fills as it plays and seeks where pressed, and
 * the time left.
 * @module
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { PropsLocale } from '@aeven/client-ui-slots'
import type { WhatsAppCardMessage } from './whatsapp-messages.ts'
import type { LoadedMedia, MessageMediaSource } from './message-media.ts'
import css from './WhatsAppMessagesCard.module.css'

/** Bars the waveform is drawn with. */
const BARS = 40

/** Bar heights while the recording is still loading or cannot be decoded: a flat, quiet line. */
const FLAT: readonly number[] = Array.from({ length: BARS }, () => 0.15)

/**
 * The loudness of a recording in {@link BARS} equal slices, scaled so the loudest slice is 1.
 * @param data - the encoded recording.
 * @returns one height per bar, between 0.08 and 1.
 */
async function waveformOf(data: Uint8Array): Promise<readonly number[]> {
  const context = new OfflineAudioContext(1, 1, 44_100)
  const audio = await context.decodeAudioData(Uint8Array.from(data).buffer)
  const samples = audio.getChannelData(0)
  const slice = Math.max(1, Math.floor(samples.length / BARS))
  const peaks: number[] = []
  for (let bar = 0; bar < BARS; bar += 1) {
    let sum = 0
    const end = Math.min(samples.length, (bar + 1) * slice)
    for (let index = bar * slice; index < end; index += 1) sum += (samples[index] ?? 0) ** 2
    peaks.push(Math.sqrt(sum / Math.max(1, end - bar * slice)))
  }
  const loudest = Math.max(...peaks, 1e-6)
  return peaks.map(peak => Math.max(0.08, peak / loudest))
}

/**
 * Minutes and seconds.
 * @param seconds - a duration.
 * @returns `m:ss`.
 */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`
}

/** One voice note, loaded once it nears the viewport so its waveform is ready before it is played. */
export function VoiceNote({ source, message, t }: {
  source: MessageMediaSource
  message: WhatsAppCardMessage
  t: PropsLocale<'connector-cards'>['t']
}) {
  const root = useRef<HTMLDivElement>(null)
  const player = useRef<HTMLAudioElement>(null)
  const [media, setMedia] = useState<LoadedMedia | null | undefined>(undefined)
  const [bars, setBars] = useState<readonly number[]>(FLAT)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    const element = root.current
    if (element === null) return
    // Cleared on unmount or a new message, so a late read or decode sets no state.
    const run = { live: true }
    const load = (): void => {
      source.load(message.chatJid, message.id).then((loaded) => {
        if (!run.live) return
        setMedia(loaded ?? null)
        if (loaded === undefined) return
        waveformOf(loaded.data).then((heights) => { if (run.live) setBars(heights) }, () => {
          // A recording the browser cannot decode keeps the flat line; the player may still play it.
        })
      }, () => { if (run.live) setMedia(null) })
    }
    if (typeof IntersectionObserver === 'undefined') {
      load()
      return () => { run.live = false }
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      load()
    }, { rootMargin: '400px 0px' })
    observer.observe(element)
    return () => { run.live = false; observer.disconnect() }
  }, [source, message.chatJid, message.id])

  const toggle = (): void => {
    const audio = player.current
    if (audio === null) return
    if (audio.paused) void audio.play()
    else audio.pause()
  }

  const seekTo = (fraction: number): void => {
    const audio = player.current
    if (audio === null || !Number.isFinite(audio.duration)) return
    audio.currentTime = Math.min(1, Math.max(0, fraction)) * audio.duration
    setPosition(audio.currentTime)
  }

  const seek = (event: PointerEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect()
    seekTo((event.clientX - box.left) / box.width)
  }

  const step = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (duration <= 0) return
    if (event.key === 'ArrowRight') { event.preventDefault(); seekTo((position + 5) / duration) }
    if (event.key === 'ArrowLeft') { event.preventDefault(); seekTo((position - 5) / duration) }
  }

  const progress = duration > 0 ? position / duration : 0
  const ready = media !== undefined && media !== null
  return (
    <div ref={root} className={css.voice} data-loading={media === undefined || undefined}>
      <button type="button" className={css.voicePlay} onClick={toggle} disabled={!ready}
        aria-label={media === null ? t('unavailable') : t(playing ? 'pause' : 'play')} data-playing={playing || undefined}>
        <span className={playing ? css.pauseMark : css.playMark} aria-hidden="true" />
      </button>
      <div className={css.wave} role="slider" tabIndex={ready ? 0 : -1} aria-label={t('voiceNote')}
        aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(position)}
        aria-valuetext={`${clock(position)} / ${clock(duration)}`}
        onPointerDown={ready ? seek : undefined} onKeyDown={step}>
        {bars.map((height, index) => (
          <span key={index} className={css.bar} style={{ height: `${String(Math.round(height * 100))}%` }}
            data-played={(index + 0.5) / BARS <= progress || undefined} />
        ))}
      </div>
      <span className={css.voiceTime}>{media === null ? t('unavailable') : clock(playing || position > 0 ? position : duration)}</span>
      {ready && (
        <audio ref={player} src={media.url} preload="metadata"
          onLoadedMetadata={(event) => { setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0) }}
          onTimeUpdate={(event) => { setPosition(event.currentTarget.currentTime) }}
          onPlay={() => { setPlaying(true) }}
          onPause={() => { setPlaying(false) }}
          onEnded={(event) => { setPlaying(false); setPosition(0); event.currentTarget.currentTime = 0 }} />
      )}
    </div>
  )
}
