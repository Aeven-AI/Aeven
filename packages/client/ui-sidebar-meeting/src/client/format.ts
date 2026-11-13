/** Formatting shared by the Recorder pane and the saved-recordings modal. */
import type { TranslateNS } from '@aeven/client-ui-slots'

/** The Recorder dictionary's translator. */
export type MeetingTranslate = TranslateNS<'sidebarMeeting'>

/** One transcript phrase as both live and saved recordings hold it. */
export interface TranscriptLine {
  readonly speaker: 'me' | 'them'
  readonly voice?: number | undefined
  /** Start, in milliseconds from the beginning of the recording. */
  readonly offsetMs: number
  readonly text: string
}

/** Consecutive phrases of one speaker, shown and copied as one block. */
export interface TranscriptTurn {
  readonly key: number
  readonly speaker: 'me' | 'them'
  readonly voice: number | undefined
  readonly offsetMs: number
  readonly text: string
}

/**
 * Format milliseconds as m:ss, or h:mm:ss from an hour.
 * @param ms - the duration.
 * @returns the clock text.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${String(hours)}:${String(minutes).padStart(2, '0')}:${seconds}` : `${String(minutes)}:${seconds}`
}

/**
 * A turn's speaker label: "You", "Speaker N" for a recognized voice, or "Others" without one.
 * @param t - the Recorder dictionary.
 * @param speaker - the source.
 * @param voice - the recognized voice number, if any.
 * @returns the label.
 */
export function speakerLabel(t: MeetingTranslate, speaker: 'me' | 'them', voice: number | undefined): string {
  if (speaker === 'me') return t('speaker.me')
  return voice === undefined ? t('speaker.them') : t('speaker.voice', { n: String(voice) })
}

/**
 * Merge consecutive phrases of one speaker.
 * @param lines - phrases in spoken order.
 * @returns the turns.
 */
export function groupTurns(lines: readonly TranscriptLine[]): TranscriptTurn[] {
  const turns: TranscriptTurn[] = []
  for (const [index, line] of lines.entries()) {
    const last = turns.at(-1)
    if (last?.speaker === line.speaker && last.voice === line.voice) turns[turns.length - 1] = { ...last, text: `${last.text} ${line.text}` }
    else turns.push({ key: index, speaker: line.speaker, voice: line.voice, offsetMs: line.offsetMs, text: line.text })
  }
  return turns
}

/**
 * A localized date and time for a recording.
 * @param at - epoch milliseconds.
 * @returns the medium date with a short time.
 */
export function formatDate(at: number): string {
  return new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * A transcript as chat text: a dated heading, then one line per turn.
 * @param t - the Recorder dictionary.
 * @param startedAt - when the recording began.
 * @param durationMs - its length.
 * @param lines - its phrases.
 * @returns plain text for the composer or clipboard.
 */
export function transcriptText(t: MeetingTranslate, startedAt: number, durationMs: number, lines: readonly TranscriptLine[]): string {
  const body = groupTurns(lines).map(turn => `${speakerLabel(t, turn.speaker, turn.voice)} (${formatDuration(turn.offsetMs)}): ${turn.text}`)
  return [t('chat.heading', { date: formatDate(startedAt), duration: formatDuration(durationMs) }), '', ...body].join('\n')
}
