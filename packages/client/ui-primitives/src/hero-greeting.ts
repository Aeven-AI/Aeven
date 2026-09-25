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

import { useEffect, useState } from 'react'

/** The four hour-bounded greetings, in the Aeven client's own order. */
export type HeroGreetingKey =
  | 'hero.greetingMorning' | 'hero.greetingAfternoon' | 'hero.greetingEvening' | 'hero.greetingNight'

/** Every key the hero reads: the product name and the greeting templates. */
export type HeroCopyKey = 'brand.localBuild' | 'hero.greeting' | 'hero.greetingNamed' | HeroGreetingKey

/**
 * The hero's copy seat. The keys live in the chat's `conversation` namespace
 * (and `common` for the product name); a caller passes a translate function
 * bound there, such as its own `t` seat or `ctx.locale.bind('conversation')`.
 */
export type HeroTranslate = (key: HeroCopyKey, params?: Record<string, unknown>) => string

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
 * @param t - the hero's copy seat.
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

/** How often a mounted hero re-reads the reader's clock — finer than the
 * hourly wording it decides, coarse enough to cost nothing while it waits. */
const GREETING_TICK_MS = 60_000

/**
 * The hero's greeting, level with the reader's own clock.
 *
 * The hour is always the browser's: a render reads the clock, a minute tick
 * carries a page left open across a boundary to its next wording, and coming
 * back to the tab re-reads it — so a machine woken from sleep or moved to
 * another timezone greets by the hour the reader is in, not the one the page
 * opened with.
 * @param t - the hero's copy seat.
 * @returns the greeting, naming the reader when the page states one.
 */
export function useHeroGreeting(t: HeroTranslate): string {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    // Only a changed hour is news; handing back the previous Date leaves the
    // render untouched (React bails out of an unchanged state reference).
    const sync = (): void => {
      const current = new Date()
      setNow(previous => (
        greetingKeyOf(previous.getHours()) === greetingKeyOf(current.getHours()) ? previous : current
      ))
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') sync()
    }
    const timer = window.setInterval(sync, GREETING_TICK_MS)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
  return heroGreeting(t, now)
}
