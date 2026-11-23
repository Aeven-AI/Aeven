/**
 * Calendar-relative triggers: which events a trigger's filter matches, when each one fires, and the event text a run
 * reads. Reading the events is a calendar source's job; nothing here starts a model turn.
 */
import type { BotTrigger, CalendarEvent } from './types.ts'

/** A calendar trigger as the definition stores it. */
type CalendarTrigger = Extract<BotTrigger, { kind: 'calendar' }>

/** The domain of an address, lower-cased; empty for a value without one. */
function domainOf(address: string): string {
  const at = address.lastIndexOf('@')
  return at === -1 ? '' : address.slice(at + 1).toLowerCase()
}

/**
 * Whether an event has an attendee outside the owner's own domains: some attendee's address domain differs from the
 * domain of every address marked as the owner's. An event without the owner's address among its attendees has none.
 * @param event - the event.
 * @returns true when an outside attendee is present.
 */
export function hasExternalAttendee(event: CalendarEvent): boolean {
  const own = new Set(event.attendees.filter(attendee => attendee.self).map(attendee => domainOf(attendee.address)))
  return own.size > 0 && event.attendees.some(attendee => !attendee.self && !own.has(domainOf(attendee.address)))
}

/**
 * Whether one event matches a calendar trigger: its calendar, and every field the filter sets.
 * @param trigger - the trigger.
 * @param event - the event.
 * @returns true when the trigger should fire for it.
 */
export function matchesCalendar(trigger: CalendarTrigger, event: CalendarEvent): boolean {
  const { title, attendee, hasExternalAttendee: external, accepted } = trigger.filter
  if (trigger.calendar !== undefined && trigger.calendar !== event.provider) return false
  if (title !== undefined && !event.title.toLowerCase().includes(title.toLowerCase())) return false
  if (attendee !== undefined && !event.attendees.some(entry => entry.address.toLowerCase().includes(attendee.toLowerCase()))) return false
  if (external !== undefined && hasExternalAttendee(event) !== external) return false
  return accepted === undefined || event.accepted === accepted
}

/**
 * The instant a calendar trigger fires for one event.
 * @param trigger - the trigger.
 * @param event - a matching event.
 * @returns the event's start moved by the trigger's offset, as an ISO instant.
 */
export function firingOf(trigger: CalendarTrigger, event: CalendarEvent): string {
  return new Date(Date.parse(event.start) + trigger.offsetMinutes * 60_000).toISOString()
}

/**
 * The event text a calendar run reads in its notice; the first line is the run's event summary.
 * @param event - the event that woke the run.
 * @returns title, times, link, and attendee addresses, one per line.
 */
export function describeCalendar(event: CalendarEvent): string {
  return [
    `Calendar event: ${event.title}`,
    `Starts: ${event.start}`,
    `Ends: ${event.end}`,
    ...event.link === undefined ? [] : [`Link: ${event.link}`],
    ...event.attendees.length === 0 ? [] : [`Attendees: ${event.attendees.map(attendee => attendee.address).join(', ')}`],
  ].join('\n')
}
