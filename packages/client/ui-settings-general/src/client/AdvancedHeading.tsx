/** General Settings heading opening the Advanced rows that follow it in the section. */

import type { PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import { SettingsGroup } from '@aeven/client-ui-primitives'

/** Full Settings-row props. */
export type AdvancedHeadingProps = PropsRuntime<'settings.general.item'> & PropsLocale<'settings'>

/**
 * Render the Advanced heading; the rows registered after it, such as Browser extension and Developer mode, read as
 * its group.
 * @param props - composed Settings slot props.
 * @returns the heading.
 */
export function AdvancedHeading({ t }: AdvancedHeadingProps) {
  return <SettingsGroup title={t('general.advanced')} />
}
