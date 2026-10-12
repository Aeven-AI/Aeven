/** Localized starter tasks; each requires a trigger explicitly advertised by the execution target. */
import type { ComponentType } from 'react'
import {
  IconChecklistOutline14, IconLucideGlobe, IconLucideMessageCircle, IconLucideSquareArrowOutUpRight,
} from '@aeven/client-ui-primitives'
import type { AutomationKey } from './locales.ts'

/** A starter's mark: the product icon set, sized by the tile that carries it. */
type TemplateIcon = ComponentType<{ className?: string }>

interface AutomationTemplate {
  readonly id: string
  readonly icon: TemplateIcon
  readonly trigger: 'daily' | 'weekly'
  readonly title: AutomationKey
  readonly description: AutomationKey
  readonly draft: AutomationKey
}
/** Starter selections fill the ordinary composer and grant no execution permission. */
export const AUTOMATION_TEMPLATES: readonly AutomationTemplate[] = [
  { id: 'roles', icon: IconLucideSquareArrowOutUpRight, trigger: 'daily', title: 'rolesTitle', description: 'rolesDescription', draft: 'rolesDraft' },
  { id: 'inbox', icon: IconLucideMessageCircle, trigger: 'weekly', title: 'inboxTitle', description: 'inboxDescription', draft: 'inboxDraft' },
  { id: 'briefing', icon: IconLucideGlobe, trigger: 'daily', title: 'briefingTitle', description: 'briefingDescription', draft: 'briefingDraft' },
  { id: 'weekly', icon: IconChecklistOutline14, trigger: 'weekly', title: 'weeklyTitle', description: 'weeklyDescription', draft: 'weeklyDraft' },
]
