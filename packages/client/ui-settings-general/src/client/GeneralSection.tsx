/** The General section: one column rendering feature-owned item contributions. */
import { SectionHeader } from '@aeven/client-ui-primitives'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@aeven/client-ui-slots'
import css from './GeneralSection.module.css'

/** Full component props: section owner share, item render share, and the settings locale seat. */
export type GeneralSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.general.item'> & PropsLocale<'settings'>

/**
 * Render the General section content column.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the section element tree.
 */
export function GeneralSection({ renderSlot, t }: GeneralSectionComponentProps) {
  return (
    <div className={css.section}>
      <SectionHeader title={t('general.nav')} description={t('general.intro')} />
      <div className={css.items}>
        {renderSlot('settings.general.item', {})}
      </div>
    </div>
  )
}
