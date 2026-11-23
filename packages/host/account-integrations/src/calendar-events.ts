/**
 * Read one connected calendar's timed events for calendar triggers, straight from the provider's REST API with the
 * connector's own token: Google Calendar's primary calendar, or the Microsoft account's calendar view. No MCP process
 * and no model turn take part.
 */
import type { CalendarEvent } from '@aeven/automations'
import { z } from 'zod'

/** Most events one read returns; a busier window keeps its earliest events. */
const PAGE_SIZE = 250

const googleTime = z.object({ dateTime: z.string().optional(), date: z.string().optional() })
const googleList = z.object({
  items: z.array(z.object({
    id: z.string(),
    status: z.string().optional(),
    summary: z.string().optional(),
    htmlLink: z.string().optional(),
    start: googleTime,
    end: googleTime,
    organizer: z.object({ email: z.string().optional(), self: z.boolean().optional() }).optional(),
    attendees: z.array(z.object({
      email: z.string().optional(), self: z.boolean().optional(), responseStatus: z.string().optional(),
    })).optional(),
  })).default([]),
})

const graphTime = z.object({ dateTime: z.string() })
const graphAddress = z.object({ emailAddress: z.object({ address: z.string().optional() }).optional() })
const graphList = z.object({
  value: z.array(z.object({
    id: z.string(),
    subject: z.string().nullable().optional(),
    webLink: z.string().nullable().optional(),
    isAllDay: z.boolean().optional(),
    isCancelled: z.boolean().optional(),
    isOrganizer: z.boolean().optional(),
    responseStatus: z.object({ response: z.string().optional() }).nullable().optional(),
    start: graphTime,
    end: graphTime,
    organizer: graphAddress.nullable().optional(),
    attendees: z.array(graphAddress).default([]),
  })).default([]),
})
const graphMe = z.object({ mail: z.string().nullable().optional(), userPrincipalName: z.string().optional() })

/**
 * Fetch one JSON document with a bearer token.
 * @param url - the API address.
 * @param token - the connector's access token.
 * @param signal - aborts the request.
 * @param headers - extra request headers.
 * @returns the parsed body.
 * @throws when the provider answers with an error status.
 */
async function getJson(url: URL, token: string, signal: AbortSignal, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...headers }, signal })
  if (!response.ok) throw new Error(`${url.host} answered ${response.status} to a calendar read`)
  return response.json()
}

/**
 * Read the timed events of a Google account's primary calendar that start inside a window.
 * @param token - the Google Calendar connector's access token.
 * @param from - inclusive ISO start of the window.
 * @param to - exclusive ISO end of the window.
 * @param signal - aborts the read.
 * @returns the events, without cancelled or all-day ones.
 */
export async function readGoogleEvents(token: string, from: string, to: string, signal: AbortSignal): Promise<CalendarEvent[]> {
  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events')
  url.search = new URLSearchParams({
    timeMin: from, timeMax: to, singleEvents: 'true', orderBy: 'startTime', maxResults: String(PAGE_SIZE),
  }).toString()
  const { items } = googleList.parse(await getJson(url, token, signal))
  return items.flatMap((item): CalendarEvent[] => {
    if (item.status === 'cancelled' || item.start.dateTime === undefined || item.end.dateTime === undefined) return []
    const attendees = (item.attendees ?? [])
      .flatMap(attendee => attendee.email === undefined ? [] : [{ address: attendee.email, self: attendee.self === true }])
    const own = item.attendees?.find(attendee => attendee.self === true)
    return [{
      id: item.id, provider: 'google-calendar', title: item.summary ?? '',
      start: new Date(item.start.dateTime).toISOString(), end: new Date(item.end.dateTime).toISOString(),
      ...item.htmlLink === undefined ? {} : { link: item.htmlLink },
      attendees,
      // An event without attendees is the owner's own.
      accepted: item.organizer?.self === true || own === undefined || own.responseStatus === 'accepted',
    }]
  })
}

/**
 * Read the timed events of a Microsoft account's calendar that start inside a window.
 * @param token - the Outlook Calendar connector's access token.
 * @param from - inclusive ISO start of the window.
 * @param to - exclusive ISO end of the window.
 * @param signal - aborts the read.
 * @returns the events, without cancelled or all-day ones; the account's own addresses are marked `self`.
 */
export async function readGraphEvents(token: string, from: string, to: string, signal: AbortSignal): Promise<CalendarEvent[]> {
  const me = graphMe.parse(await getJson(new URL('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName'), token, signal))
  const own = new Set([me.mail, me.userPrincipalName].flatMap(address => address == null ? [] : [address.toLowerCase()]))
  const url = new URL('https://graph.microsoft.com/v1.0/me/calendarView')
  url.search = new URLSearchParams({
    'startDateTime': from, 'endDateTime': to, '$top': String(PAGE_SIZE), '$orderby': 'start/dateTime',
    '$select': 'id,subject,webLink,isAllDay,isCancelled,isOrganizer,responseStatus,start,end,organizer,attendees',
  }).toString()
  // Graph returns local wall times without an offset; this header makes them UTC.
  const { value } = graphList.parse(await getJson(url, token, signal, { prefer: 'outlook.timezone="UTC"' }))
  return value.flatMap((item): CalendarEvent[] => {
    if (item.isCancelled === true || item.isAllDay === true) return []
    const addresses = [item.organizer, ...item.attendees]
      .flatMap(entry => entry?.emailAddress?.address == null ? [] : [entry.emailAddress.address])
    const response = item.responseStatus?.response
    return [{
      id: item.id, provider: 'outlook-calendar', title: item.subject ?? '',
      start: new Date(`${item.start.dateTime}Z`).toISOString(), end: new Date(`${item.end.dateTime}Z`).toISOString(),
      ...item.webLink == null ? {} : { link: item.webLink },
      attendees: [...new Set(addresses)].map(address => ({ address, self: own.has(address.toLowerCase()) })),
      accepted: item.isOrganizer === true || response === 'accepted' || response === 'organizer',
    }]
  })
}
