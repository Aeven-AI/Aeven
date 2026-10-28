/** The Appearance group inside General: theme, text size, and how conversations look. */
import { SettingsGroup } from '@aeven/client-ui-primitives'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-settings/client'

/** Full component props: General item owner share, item render share, and the theme locale seat. */
export type AppearanceSectionComponentProps =
  PropsRuntime<'settings.general.item'> & PropsRenderSlots<'settings.appearance.item'> & PropsLocale<'settings.theme'>

/**
 * Render the Appearance group with its contributed rows.
 * @param props - composed slot props.
 * @returns the group element tree.
 */
export function AppearanceSection({ renderSlot, t }: AppearanceSectionComponentProps) {
  return (
    <SettingsGroup title={t('appearance.title')}>
      {renderSlot('settings.appearance.item', {})}
    </SettingsGroup>
  )
}
