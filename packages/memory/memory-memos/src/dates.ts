/**
 * Yearly dates read from person memories: births, birthdays, weddings, deaths, and anniversaries, with the year of
 * the original event when the memory states one. Recall reads them from every memory regardless of its age, so a
 * birthday told months ago is known on the day itself.
 * @module @aeven/memory-memos/dates
 */
import { brandString } from '@aeven/brand'
import type { MemoryDate, MemoryItemId } from '@aeven/memory'

/** One memory the dates are read from. */
export interface DatedText {
  readonly id: string
  readonly text: string
}

const MONTHS: readonly (readonly [RegExp, number])[] = [
  [/^jan/u, 1], [/^feb/u, 2], [/^mar/u, 3], [/^apr/u, 4], [/^may/u, 5], [/^jun/u, 6],
  [/^jul/u, 7], [/^aug/u, 8], [/^sep/u, 9], [/^oct/u, 10], [/^nov/u, 11], [/^dec/u, 12],
]
const MONTH = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
const DAY_FIRST = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})\\.?(?:,?\\s+(\\d{4}))?\\b`, 'giu')
const MONTH_FIRST = new RegExp(`\\b(${MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?`, 'giu')
const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/gu

/** Words that make a nearby date a yearly one. */
const YEARLY_WORDS = 'born|birth|birthday|birthdays|b\\.|married|marriage|wedding|anniversary|died|death|passed away|deceased|'
  + 'geboren|verjaardag|jarig|getrouwd|overleden'
const YEARLY = new RegExp(`\\b(?:${YEARLY_WORDS})`, 'giu')
/** Words that make a yearly date a birth. */
const BIRTH = /^(?:born|birth|birthday|birthdays|b\.|geboren|verjaardag|jarig)$/iu
/** Characters before a date searched for {@link YEARLY}; the nearest such word decides what the date is. */
const LEAD_CHARS = 30
/** A memory text up to this length is shown whole beside its date; a longer one shows the clause around the date. */
const WHOLE_TEXT_CHARS = 140

/** Days in each month, February counted with its leap day so 29 February stays a valid yearly date. */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

interface Found {
  readonly month: number
  readonly day: number
  readonly year?: number
  readonly index: number
  readonly length: number
}

function monthOf(name: string): number | undefined {
  const lower = name.toLocaleLowerCase('en')
  return MONTHS.find(([pattern]) => pattern.test(lower))?.[1]
}

/** Every calendar date written in a text, with its position. */
function datesIn(text: string): Found[] {
  const found: Found[] = []
  const add = (month: number | undefined, day: number, year: string | undefined, index: number, length: number): void => {
    if (month === undefined || day < 1 || day > (MONTH_DAYS[month - 1] ?? 0)) return
    if (found.some(other => index < other.index + other.length && other.index < index + length)) return
    found.push({ month, day, ...year === undefined ? {} : { year: Number(year) }, index, length })
  }
  for (const match of text.matchAll(ISO)) add(Number(match[2]), Number(match[3]), match[1], match.index, match[0].length)
  for (const match of text.matchAll(DAY_FIRST)) add(monthOf(match[2] ?? ''), Number(match[1]), match[3], match.index, match[0].length)
  for (const match of text.matchAll(MONTH_FIRST)) add(monthOf(match[1] ?? ''), Number(match[2]), match[3], match.index, match[0].length)
  return found
}

/** The clause of `text` around a date: from the previous `;` or sentence end to the next one. */
function clauseAround(text: string, index: number, length: number): string {
  const before = text.slice(0, index)
  const start = Math.max(before.lastIndexOf(';'), before.lastIndexOf('. ')) + 1
  const rest = text.slice(index + length)
  const ends = [rest.indexOf(';'), rest.indexOf('. ')].filter(at => at >= 0)
  const end = ends.length === 0 ? text.length : index + length + Math.min(...ends)
  return text.slice(start, end).trim()
}

/**
 * One entry of a birthday list such as `family birthdays: Elly 21 Nov, Sebas 3 Jan`: the list's heading before its
 * colon, followed by the comma-separated entry around the date.
 */
function listEntry(text: string, index: number, length: number): string {
  const colon = text.indexOf(':')
  const heading = colon >= 0 && colon < index ? text.slice(0, colon).trim() : ''
  const before = text.slice(0, index)
  const start = Math.max(before.lastIndexOf(','), before.lastIndexOf(':'), before.lastIndexOf(';')) + 1
  const rest = text.slice(index + length)
  const ends = [rest.indexOf(','), rest.indexOf(';')].filter(at => at >= 0)
  const end = ends.length === 0 ? text.length : index + length + Math.min(...ends)
  const entry = text.slice(start, end).trim()
  return heading ? `${heading}: ${entry}` : entry
}

/**
 * Read the yearly dates the memories state, one entry per distinct date. A date counts when a word such as born,
 * birthday, married, or died stands shortly before it, or when the memory lists birthdays. A date in `currentYear`
 * or later records an arrangement, not the original event, and is left out. Several memories stating the same date
 * become one entry with the shortest statement; a date without a year is left out when a memory states the same day
 * with its year.
 * @param memories - the memories to read, any order.
 * @param currentYear - the current calendar year.
 * @returns the dates, ordered by month and day.
 */
export function recordedDates(memories: readonly DatedText[], currentYear: number): MemoryDate[] {
  const byKey = new Map<string, MemoryDate>()
  for (const memory of memories) {
    const text = memory.text.replace(/\s+/gu, ' ').trim()
    const listsBirthdays = /\bbirthdays\b/iu.test(text)
    for (const found of datesIn(text)) {
      if (found.year !== undefined && (found.year >= currentYear || found.year < 1900)) continue
      const nearest = [...text.slice(Math.max(0, found.index - LEAD_CHARS), found.index).matchAll(YEARLY)].at(-1)?.[0]
      if (!listsBirthdays && nearest === undefined) continue
      const statement = listsBirthdays
        ? listEntry(text, found.index, found.length)
        : text.length <= WHOLE_TEXT_CHARS ? text : clauseAround(text, found.index, found.length)
      const date: MemoryDate = {
        month: found.month,
        day: found.day,
        ...found.year === undefined ? {} : { year: found.year },
        birth: nearest === undefined ? listsBirthdays : BIRTH.test(nearest),
        text: statement,
        id: brandString<MemoryItemId>(memory.id),
      }
      const key = `${found.month}-${found.day}-${found.year ?? ''}`
      const seen = byKey.get(key)
      if (seen === undefined || statement.length < seen.text.length) byKey.set(key, { ...date, birth: date.birth || seen?.birth === true })
    }
  }
  const dated = new Set([...byKey.values()].flatMap(date => date.year === undefined ? [] : [`${date.month}-${date.day}`]))
  return [...byKey.values()]
    .filter(date => date.year !== undefined || !dated.has(`${date.month}-${date.day}`))
    .sort((a, b) => a.month - b.month || a.day - b.day || (a.year ?? 0) - (b.year ?? 0))
}
