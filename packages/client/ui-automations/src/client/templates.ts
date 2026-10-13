/** Localized starter tasks; each requires a trigger explicitly advertised by the execution target. */
import type { ComponentType } from 'react'
import { IconChecklistOutline14, IconLucideGlobe } from '@aeven/client-ui-primitives'
import {
  IconBinoculars, IconBookOpen, IconBriefcase, IconCalendarClock, IconCalendarRange, IconGitPullRequest, IconInbox,
  IconLanguages, IconLightbulb, IconNewspaper, IconReceipt, IconReply, IconSun, IconTag, IconTicket, IconTrendingUp, IconUtensils,
} from './icons.tsx'
import type { AutomationKey } from './locales.ts'

/** A starter's mark: the product icon set, sized by the tile that carries it. */
type TemplateIcon = ComponentType<{ className?: string }>

/** Days a starter runs: every day, Monday to Friday, or one weekday (0 = Sunday). */
export type TemplateDays = 'daily' | 'weekdays' | 0 | 1 | 2 | 3 | 4 | 5 | 6

/** Account services a starter reads; any one connected provider of the group satisfies it. */
export const SERVICE_NEEDS = {
  mail: ['gmail', 'outlook', 'email'],
  calendar: ['google-calendar', 'outlook-calendar'],
  github: ['github'],
} as const
/** One account service group a starter depends on. */
export type ServiceNeed = keyof typeof SERVICE_NEEDS

/** One starter: its copy keys, its schedule, and the account services it reads. */
export interface AutomationTemplate {
  readonly id: string
  readonly icon: TemplateIcon
  readonly days: TemplateDays
  /** 24-hour local wall time inserted into the draft and formatted for the schedule line. */
  readonly time: string
  readonly needs: readonly ServiceNeed[]
  readonly title: AutomationKey
  readonly description: AutomationKey
  readonly draft: AutomationKey
}
/** A titled group of starters. */
export interface TemplateCategory {
  readonly title: AutomationKey
  readonly templates: readonly AutomationTemplate[]
}

/** Starter selections fill the ordinary composer and grant no execution permission. */
export const TEMPLATE_CATEGORIES: readonly TemplateCategory[] = [
  {
    title: 'categoryDay',
    templates: [
      { id: 'morning', icon: IconSun, days: 'weekdays', time: '07:30', needs: ['calendar', 'mail'], title: 'morningTitle', description: 'morningDescription', draft: 'morningDraft' },
      { id: 'inbox', icon: IconInbox, days: 'weekdays', time: '08:00', needs: ['mail'], title: 'inboxTitle', description: 'inboxDescription', draft: 'inboxDraft' },
      { id: 'meetings', icon: IconCalendarClock, days: 'weekdays', time: '07:45', needs: ['calendar'], title: 'meetingsTitle', description: 'meetingsDescription', draft: 'meetingsDraft' },
      { id: 'followups', icon: IconReply, days: 'weekdays', time: '16:30', needs: ['mail'], title: 'followupsTitle', description: 'followupsDescription', draft: 'followupsDraft' },
    ],
  },
  {
    title: 'categoryWeek',
    templates: [
      { id: 'week-ahead', icon: IconCalendarRange, days: 0, time: '18:00', needs: ['calendar'], title: 'weekAheadTitle', description: 'weekAheadDescription', draft: 'weekAheadDraft' },
      { id: 'weekly', icon: IconChecklistOutline14, days: 5, time: '16:00', needs: [], title: 'weeklyTitle', description: 'weeklyDescription', draft: 'weeklyDraft' },
      { id: 'bills', icon: IconReceipt, days: 1, time: '09:00', needs: ['mail'], title: 'billsTitle', description: 'billsDescription', draft: 'billsDraft' },
    ],
  },
  {
    title: 'categoryResearch',
    templates: [
      { id: 'briefing', icon: IconNewspaper, days: 'daily', time: '09:00', needs: [], title: 'briefingTitle', description: 'briefingDescription', draft: 'briefingDraft' },
      { id: 'competitors', icon: IconBinoculars, days: 1, time: '09:00', needs: [], title: 'competitorsTitle', description: 'competitorsDescription', draft: 'competitorsDraft' },
      { id: 'research', icon: IconBookOpen, days: 6, time: '10:00', needs: [], title: 'researchTitle', description: 'researchDescription', draft: 'researchDraft' },
      { id: 'mentions', icon: IconLucideGlobe, days: 'daily', time: '12:00', needs: [], title: 'mentionsTitle', description: 'mentionsDescription', draft: 'mentionsDraft' },
    ],
  },
  {
    title: 'categoryWork',
    templates: [
      { id: 'jobs', icon: IconBriefcase, days: 'weekdays', time: '10:00', needs: [], title: 'jobsTitle', description: 'jobsDescription', draft: 'jobsDraft' },
      { id: 'content', icon: IconLightbulb, days: 1, time: '08:30', needs: [], title: 'contentTitle', description: 'contentDescription', draft: 'contentDraft' },
      { id: 'github', icon: IconGitPullRequest, days: 'weekdays', time: '09:00', needs: ['github'], title: 'githubTitle', description: 'githubDescription', draft: 'githubDraft' },
      { id: 'markets', icon: IconTrendingUp, days: 'weekdays', time: '18:00', needs: [], title: 'marketsTitle', description: 'marketsDescription', draft: 'marketsDraft' },
    ],
  },
  {
    title: 'categoryLife',
    templates: [
      { id: 'meals', icon: IconUtensils, days: 0, time: '10:00', needs: [], title: 'mealsTitle', description: 'mealsDescription', draft: 'mealsDraft' },
      { id: 'weekend', icon: IconTicket, days: 4, time: '17:00', needs: [], title: 'weekendTitle', description: 'weekendDescription', draft: 'weekendDraft' },
      { id: 'prices', icon: IconTag, days: 'daily', time: '08:00', needs: [], title: 'pricesTitle', description: 'pricesDescription', draft: 'pricesDraft' },
      { id: 'language', icon: IconLanguages, days: 'daily', time: '07:00', needs: [], title: 'languageTitle', description: 'languageDescription', draft: 'languageDraft' },
    ],
  },
]

/** Recurrence kind the execution target must advertise for a starter's days.
 * @param days - the starter's run days.
 * @returns `daily` for every day; selected-weekday schedules otherwise.
 */
export function templateTrigger(days: TemplateDays): 'daily' | 'weekly' {
  return days === 'daily' ? 'daily' : 'weekly'
}
