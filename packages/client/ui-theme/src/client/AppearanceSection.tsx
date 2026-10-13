/** The Appearance section: theme, text size, and how conversations look. */
import { SectionHeader } from '@aeven/client-ui-primitives'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-settings/client'
import css from './AppearanceSection.module.css'

/** Full component props: section owner share, item render share, and the theme locale seat. */
export type AppearanceSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.appearance.item'> & PropsLocale<'settings.theme'>

/**
 * Render the Appearance section content column.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function AppearanceSection({ renderSlot, t }: AppearanceSectionComponentProps) {
  return (
    <div className={css.section}>
      <SectionHeader title={t('appearance.title')} description={t('appearance.intro')} />
      <div className={css.items}>
        {renderSlot('settings.appearance.item', {})}
      </div>
    </div>
  )
}
