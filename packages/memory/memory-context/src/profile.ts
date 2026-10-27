/**
 * The person-profile block: today's date in the person's zone, the yearly dates memory records that fall today or
 * soon with the ages they make, and the profile distilled from all of the person's memories.
 * @module @aeven/memory-context/profile
 */
import type { UserMessage } from '@aeven/llm'
import { MEMORY_TOOL, type MemoryDate, type MemoryProfile } from '@aeven/memory'

/** Opening tag of the block; a session's earlier block is found by its first line. */
export const PROFILE_OPEN = '<memory_profile>\n'
const PROFILE_CLOSE = '\n</memory_profile>'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** A calendar day in the person's zone. */
export interface LocalDay {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly weekday: string
}

/**
 * The calendar day of an instant in a zone.
 * @param now - epoch milliseconds.
 * @param timeZone - IANA zone, or undefined for the host's own.
 * @returns the day.
 */
export function localDay(now: number, timeZone: string | undefined): LocalDay {
  const parts = new Intl.DateTimeFormat('en-US', {
    ...timeZone === undefined ? {} : { timeZone },
    year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'long',
  }).formatToParts(new Date(now))
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find(entry => entry.type === type)?.value ?? ''
  return { year: Number(part('year')), month: Number(part('month')), day: Number(part('day')), weekday: part('weekday') }
}

/**
 * The browser zone a turn's direct-user message carries, when it is one this runtime knows.
 * @param messages - the turn's entered messages.
 * @returns the IANA zone, or undefined.
 */
export function turnTimeZone(messages: readonly UserMessage[]): string | undefined {
  for (const message of messages) {
    const source = message.source
    if (source.kind !== 'user' || !('clientTimeZone' in source) || typeof source.clientTimeZone !== 'string') continue
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: source.clientTimeZone }).resolvedOptions().timeZone
    } catch {
      // RangeError: an unknown zone; the host's own zone is used instead.
      return undefined
    }
  }
  return undefined
}

/** Days from `today` to the next occurrence of a yearly date; 29 February falls on 1 March in other years. */
function daysUntil(date: MemoryDate, today: LocalDay): number {
  const start = Date.UTC(today.year, today.month - 1, today.day)
  const on = (year: number): number => Date.UTC(year, date.month - 1, date.day)
  const next = on(today.year) >= start ? on(today.year) : on(today.year + 1)
  return Math.round((next - start) / 86_400_000)
}

/** An English ordinal such as `49th` or `21st`. */
function ordinal(count: number): string {
  const tens = count % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : count % 10 === 1 ? 'st' : count % 10 === 2 ? 'nd' : count % 10 === 3 ? 'rd' : 'th'
  return `${count}${suffix}`
}

/** One date line: the date, when it falls, what it amounts to, the memory that states it, and its id. */
function dateLine(date: MemoryDate, today: LocalDay, days: number, upcomingDays: number, marked: boolean): string {
  const soon = days <= upcomingDays
  const when = days === 0 ? marked ? 'TODAY, already marked in an earlier conversation today' : 'TODAY' : days === 1 ? 'tomorrow' : soon ? `in ${days} days` : ''
  const nextYear = today.year + (date.month < today.month || (date.month === today.month && date.day < today.day) ? 1 : 0)
  let span = ''
  if (date.year !== undefined) {
    // Years at the next occurrence; until then a person is one year younger.
    const years = nextYear - date.year
    // A birth date may belong to someone who has died, so the span is stated as a birthday count, never as an age.
    if (date.birth) span = days === 0 ? `${ordinal(years)} birthday today` : soon ? `${ordinal(years)} birthday` : `born ${years - 1} years ago`
    else span = days === 0 ? `${years} years ago today` : `${years} years on that day`
  }
  const label = [when, span].filter(Boolean).join(', ')
  const written = `${date.day} ${MONTH_NAMES[date.month - 1] ?? ''}${date.year === undefined ? '' : ` ${date.year}`}`
  return `- ${written}${label ? ` (${label})` : ''}: ${date.text} [trace:${date.id}]`
}

/**
 * Render the block, or nothing when memory holds neither a profile nor a date worth stating.
 * @param profile - the provider's profile.
 * @param today - the person's calendar day.
 * @param upcomingDays - days ahead whose dates are listed.
 * @param marked - whether an earlier conversation of the same person already received today's dates today.
 * @returns the framed block, or empty.
 */
export function renderProfile(profile: MemoryProfile, today: LocalDay, upcomingDays: number, marked = false): string {
  const dated = profile.dates.map(date => ({ date, days: daysUntil(date, today) }))
  const soon = dated.filter(({ days }) => days <= upcomingDays).sort((a, b) => a.days - b.days)
  // A birth date with its year gives a current age every day, not only around the birthday.
  const ages = dated.filter(({ date, days }) => date.birth && date.year !== undefined && days > upcomingDays)
  const sections = [
    ...soon.length === 0 ? [] : [`Dates today and in the next ${upcomingDays} days:\n${soon.map(({ date, days }) => dateLine(date, today, days, upcomingDays, marked)).join('\n')}`],
    ...ages.length === 0 ? [] : [`Other birth dates:\n${ages.map(({ date, days }) => dateLine(date, today, days, upcomingDays, marked)).join('\n')}`],
    ...profile.text === undefined ? [] : [`Profile from all memories${profile.updatedAt === undefined ? '' : `, updated ${isoDay(profile.updatedAt)}`}:\n${profile.text.replaceAll('</memory_profile>', '&lt;/memory_profile>')}`],
  ]
  if (sections.length === 0) return ''
  const heading = `Today is ${today.weekday} ${today.day} ${MONTH_NAMES[today.month - 1] ?? ''} ${today.year}.`
  return `${PROFILE_OPEN}${heading}\n\n${sections.join('\n\n')}\n\nUse ${MEMORY_TOOL.get} with an id to read a memory in full.${PROFILE_CLOSE}`
}

/**
 * Whether the block states a date that falls today.
 * @param text - a rendered block.
 * @returns true when a line is marked TODAY.
 */
export function profileHasToday(text: string): boolean {
  return text.includes(' (TODAY')
}

/** The host's local calendar day of an instant, as YYYY-MM-DD. */
function isoDay(time: number): string {
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * The first line of a rendered block, which names the day it was rendered for.
 * @param text - a rendered block.
 * @returns its day line.
 */
export function profileDayLine(text: string): string {
  return text.slice(PROFILE_OPEN.length).split('\n', 1)[0] ?? ''
}
