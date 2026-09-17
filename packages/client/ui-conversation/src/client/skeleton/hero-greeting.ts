/**
 * The hero's greeting: Aeven's own time-of-day wording, addressed to the
 * reader the authentication gate stated on the page.
 *
 * The gate publishes that reader before the plugin graph boots, and reading it
 * back off the page is the one way a plugin bundle may know who is signed in.
 * A deployment that mounts no Aeven authority publishes nobody, so the line
 * drops the name rather than printing a gap where one would be — the hero is
 * the one surface that must read well to a reader nobody has identified.
 * @module
 */

import type { ConversationSlotProps } from '../contract/slots.ts'

/** The owner's locale seat, which the greeting copy is read through. */
type HeroTranslate = ConversationSlotProps['t']

/** The four hour-bounded greetings, in the Aeven client's own order. */
export type HeroGreetingKey =
  | 'hero.greetingMorning' | 'hero.greetingAfternoon' | 'hero.greetingEvening' | 'hero.greetingNight'

/** The part of the page-stated reader the greeting reads. */
interface ReaderScope {
  __AVN_AEVEN_READER__?: { displayName?: string }
}

/**
 * The greeting an hour falls in: morning reaches to noon, afternoon to 17:00,
 * evening to 22:00, and every other hour is night.
 * @param hour - the local hour, 0 through 23.
 * @returns the dictionary key for that hour.
 */
export function greetingKeyOf(hour: number): HeroGreetingKey {
  if (hour >= 5 && hour < 12) return 'hero.greetingMorning'
  if (hour >= 12 && hour < 17) return 'hero.greetingAfternoon'
  if (hour >= 17 && hour < 22) return 'hero.greetingEvening'
  return 'hero.greetingNight'
}

/**
 * The name to greet the reader by.
 * @returns their chosen name, or undefined when nobody is stated or named.
 */
export function readerDisplayName(): string | undefined {
  const name = (globalThis as ReaderScope).__AVN_AEVEN_READER__?.displayName
  return name === undefined || name === '' ? undefined : name
}

/**
 * Compose the hero's greeting line.
 * @param t - the owner's locale seat.
 * @param now - the clock to read; a test pins the boundaries with it.
 * @returns the greeting, naming the reader when the page states one.
 */
export function heroGreeting(t: HeroTranslate, now: Date = new Date()): string {
  const greeting = t(greetingKeyOf(now.getHours()))
  const name = readerDisplayName()
  return name === undefined
    ? t('hero.greeting', { greeting })
    : t('hero.greetingNamed', { greeting, name })
}
