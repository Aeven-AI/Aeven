/** Local sentences for bot recurrences, triggers, placement, and the place chooser. */
import {
  IconLucideCloud, IconLucideLaptopMinimal, relativeTime, type PlaceListItem,
} from '@aeven/client-ui-primitives'
import type { PropsLocale } from '@aeven/client-ui-slots'
import { NEED_LABELS, type AutomationList, type Desktop, type Need, type Task, type TaskSchedule, type TaskTrigger } from './model.ts'

/** The automations dictionary's translate function. */
export type Translate = PropsLocale<'automations'>['t']

/** Row id of Aeven Cloud in the place chooser; desktop rows use their vault device id. */
export const CLOUD_PLACE = 'cloud'

/** Locale key of each overlap policy's sentence. */
export const OVERLAP_TEXT = { skip: 'overlapSkip', queue: 'overlapQueue', parallel: 'overlapParallel' } as const

/** Locale key of each handoff status. */
export const HANDOFF_STATUS = { open: 'handoffOpen', claimed: 'handoffClaimed', done: 'handoffDone', failed: 'handoffFailed', released: 'handoffReleased', refused: 'handoffRefused' } as const

/**
 * Bind the page's sentence builders to the active locale and the last list.
 * @param t - the automations dictionary.
 * @param data - the last management projection, or null before the first read.
 * @returns the formatters the bot pages share.
 */
export function formatters(t: Translate, data: AutomationList | null) {
  const date = (at: string): string => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const number = (value: number): string => new Intl.NumberFormat().format(value)
  /** A time of day for an instant today, otherwise its short date and time. */
  const moment = (at: string): string => {
    const value = new Date(at)
    return value.toDateString() === new Date().toDateString()
      ? value.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : value.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
  }
  const clock = (wall: string): string => {
    const [hour = 0, minute = 0] = wall.split(':').map(Number)
    return new Date(2023, 0, 1, hour, minute).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  const needs = (list: readonly Need[]): string => list.map(need => t(NEED_LABELS[need])).join(', ')
  /** Local sentence for one stored recurrence. */
  const describe = (schedule: TaskSchedule): string => {
    const span = (value: number, unit: 'minute' | 'hour'): string =>
      new Intl.NumberFormat(undefined, { style: 'unit', unit, unitDisplay: 'long' }).format(value)
    // 2023-01-02 is a Monday, so MO, the first entry, names it.
    const weekday = (day: string): string =>
      new Date(2023, 0, 2 + Math.max(0, ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].indexOf(day))).toLocaleDateString(undefined, { weekday: 'long' })
    const until = (schedule.jitterMinutes === undefined ? '' : t('scheduleJitter', { duration: span(schedule.jitterMinutes, 'minute') }))
      + (schedule.until === undefined ? '' : t('scheduleUntil', { date: date(schedule.until) }))
    switch (schedule.kind) {
      case 'once': return `${t('scheduleOnce', { when: date(schedule.at) })}${until}`
      case 'interval': return `${t('scheduleInterval', { duration: span(schedule.everyMinutes, 'minute') })}${until}`
      case 'hours': return `${t('scheduleHours', { duration: span(schedule.everyHours, 'hour'), minute: String(schedule.atMinute) })}${until}`
      case 'daily': return `${t('scheduleDaily', { time: clock(schedule.time) })}${until}`
      case 'weekly': return `${t('scheduleWeekly', { day: schedule.weekdays.map(weekday).join(', '), time: clock(schedule.time) })}${until}`
      case 'monthly': return `${t('scheduleMonthly', { days: schedule.days.join(', '), time: clock(schedule.time) })}${until}`
      case 'nth-weekday': return `${t('scheduleNthWeekday', {
        week: t(`week${schedule.week}`),
        day: weekday(schedule.weekday), time: clock(schedule.time),
      })}${until}`
      case 'yearly': return `${t('scheduleYearly', {
        date: new Date(2023, schedule.month - 1, schedule.day).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }),
        time: clock(schedule.time),
      })}${until}`
      case 'cron': return `${t('scheduleCron', { expression: schedule.expression })}${until}`
    }
  }
  /** Local sentence for one trigger of a bot. */
  const describeTrigger = (trigger: TaskTrigger): string => {
    switch (trigger.kind) {
      case 'schedule': return describe(trigger.schedule)
      case 'webhook': return t('triggerWebhook')
      case 'bot': {
        const names = trigger.from.map(id => data?.definitions.find(task => task.id === id)?.name ?? t('triggerRemovedBot'))
        const [name] = names
        if (names.length === 1 && name !== undefined) return t(trigger.mode === 'wait' ? 'triggerBotWait' : 'triggerBotDispatch', { name })
        const list = new Intl.ListFormat(undefined, { type: trigger.join === 'all' ? 'conjunction' : 'disjunction' }).format(names)
        return t(trigger.join === 'all' ? 'triggerBotJoinAll' : 'triggerBotJoinAny', { names: list }) + (trigger.mode === 'wait' ? t('triggerBotJoinReplies') : '')
      }
      case 'calendar': {
        const { title, attendee, hasExternalAttendee, accepted } = trigger.filter
        const minutes = Math.abs(trigger.offsetMinutes)
        const duration = new Intl.NumberFormat(undefined, { style: 'unit', unit: minutes % 60 === 0 ? 'hour' : 'minute', unitDisplay: 'long' })
          .format(minutes % 60 === 0 ? minutes / 60 : minutes)
        return [
          trigger.offsetMinutes < 0 ? t('triggerCalendarBefore', { duration }) : trigger.offsetMinutes > 0 ? t('triggerCalendarAfter', { duration }) : t('triggerCalendarAt'),
          trigger.calendar === undefined ? '' : t(trigger.calendar === 'google-calendar' ? 'triggerCalendarGoogle' : 'triggerCalendarOutlook'),
          title === undefined ? '' : t('triggerCalendarTitle', { title }),
          attendee === undefined ? '' : t('triggerCalendarAttendee', { attendee }),
          hasExternalAttendee === undefined ? '' : t(hasExternalAttendee ? 'triggerCalendarExternal' : 'triggerCalendarInternal'),
          accepted === undefined ? '' : t(accepted ? 'triggerCalendarAccepted' : 'triggerCalendarUnaccepted'),
        ].filter(part => part !== '').join(' ')
      }
      case 'event':
        if (trigger.source === 'mail') {
          const { account, from, subject } = trigger.filter
          return [t('triggerMail'), from === undefined ? '' : t('triggerMailFrom', { from }), subject === undefined ? '' : t('triggerMailSubject', { subject }), account === undefined ? '' : t('triggerMailAccount', { account })].filter(part => part !== '').join(' ')
        }
        return [t('triggerGithub'), trigger.filter.repository === undefined ? '' : t('triggerGithubRepo', { repository: trigger.filter.repository }), trigger.filter.events === undefined || trigger.filter.events.length === 0 ? '' : t('triggerGithubEvents', { events: trigger.filter.events.join(', ') }), trigger.filter.actions === undefined || trigger.filter.actions.length === 0 ? '' : t('triggerGithubActions', { actions: trigger.filter.actions.join(', ') })].filter(part => part !== '').join(' ')
    }
  }
  /** When a bot next runs: paused, a date, on an event, or finished. */
  const next = (task: Task): string => task.status === 'paused' ? t('paused') : task.nextRunAt !== null ? date(task.nextRunAt)
    : task.triggers.some(trigger => trigger.kind !== 'schedule') ? t('onEvent') : t('noNext')
  /** The desktop a bot is placed on, and its display name; undefined for a bot not placed on one desktop. */
  const chosenDesktop = (task: Task): { desktop: Desktop | undefined; name: string } | undefined => {
    if (task.runOn !== 'device' || task.desktop === undefined) return undefined
    const desktop = data?.hosts?.desktops.find(candidate => candidate.device === task.desktop)
    return { desktop, name: desktop === undefined || desktop.name === '' ? t('placeUnnamed') : desktop.name }
  }
  /** Short name of where a bot runs. */
  const runsOn = (task: Task): string => chosenDesktop(task)?.name
    ?? t(!task.placement.available ? 'runsOnMissing' : task.placement.runsOn === 'cloud' ? 'runsOnCloud' : 'runsOnDevice')
  /** Why a bot runs where it does. */
  const placementDetail = (task: Task): string => {
    const chosen = chosenDesktop(task)
    if (chosen !== undefined) return chosen.desktop === undefined ? t('placementDesktopGone') : t('placementDesktopChosen', { name: chosen.name })
    if (!task.placement.available) return t('placementUnavailable')
    if (task.placement.runsOn === 'cloud') return t('placementCloud')
    if (task.runOn === 'device') return t('placementDeviceChosen')
    const required = task.requires ?? []
    return required.length === 0 ? t('placementDeviceNoCloud') : t('placementDeviceNeeds', { needs: needs(required) })
  }
  /** The status line under one desktop's name in the place chooser. */
  const seen = (desktop: Desktop, now: number): string => {
    if (desktop.self) return t('placeSelf')
    if (desktop.present) return t('placeOnline')
    if (desktop.seenAt === undefined) return t('placeOffline')
    const { unit, n } = relativeTime(desktop.seenAt, now)
    const count = { n: String(n) }
    switch (unit) {
      case 'now': return t('placeSeen', { when: t('placeTimeNow') })
      case 'minutes': return t('placeSeen', { when: t('placeTimeMinutes', count) })
      case 'hours': return t('placeSeen', { when: t('placeTimeHours', count) })
      case 'days': return t('placeSeen', { when: t('placeTimeDays', count) })
      case 'months': return t('placeSeen', { when: t('placeTimeMonths', count) })
      case 'years': return t('placeSeen', { when: t('placeTimeYears', count) })
    }
  }
  /**
   * The place chooser's rows for one bot: Aeven Cloud first when the account has it, then each desktop. A place
   * that cannot give the bot what it uses stays listed with the reason; an offline desktop can be chosen.
   */
  const placeItems = (task: Task, hosts: NonNullable<AutomationList['hosts']>): PlaceListItem[] => {
    const required = task.requires ?? []
    const now = Date.now()
    const cloud: PlaceListItem[] = !hosts.cloud ? [] : [{
      id: CLOUD_PLACE, icon: IconLucideCloud, name: t('runsOnCloud'),
      status: required.length > 0 ? t('placeNeeds', { needs: needs(required) }) : t('placeCloudStatus'),
      current: task.placement.runsOn === 'cloud', disabled: required.length > 0,
    }]
    return [...cloud, ...hosts.desktops.map((desktop): PlaceListItem => {
      const missing = desktop.provides === undefined ? [] : required.filter(need => desktop.provides?.includes(need) !== true)
      return {
        id: desktop.device, icon: IconLucideLaptopMinimal,
        name: desktop.name === '' ? t('placeUnnamed') : desktop.name,
        status: desktop.provides === undefined ? t('placeUpdate') : missing.length > 0 ? t('placeNeeds', { needs: needs(missing) }) : seen(desktop, now),
        present: desktop.present && !desktop.self && desktop.provides !== undefined && missing.length === 0,
        current: task.runOn === 'device' && task.desktop === desktop.device,
        disabled: desktop.provides === undefined || missing.length > 0,
      }
    })]
  }
  return { date, number, moment, clock, describe, describeTrigger, next, runsOn, placementDetail, placeItems }
}

/** The bound sentence builders. */
export type Formatters = ReturnType<typeof formatters>
