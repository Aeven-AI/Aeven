/** General Settings row turning the desktop application's background mode on or off. */

import type { ObservableSnapshot } from '@aeven/client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import { OnOffRow } from './OnOffRow.tsx'

/** Registration-side background mode face. */
export interface BackgroundModeRowInjected {
  hooks: {
    /** The desktop shell's stored choice, bound as useBackgroundMode. */
    backgroundMode: ObservableSnapshot<boolean>
  }
  /** Turn background mode on or off. */
  setBackgroundMode: (enabled: boolean) => void
}

/** Full Settings-row props. */
export type BackgroundModeRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings'>
  & InjectFace<BackgroundModeRowInjected>

/**
 * Render the background mode selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function BackgroundModeRow({ useBackgroundMode, setBackgroundMode, t }: BackgroundModeRowProps) {
  const enabled = useBackgroundMode(value => value)
  return (
    <OnOffRow
      title={t('background.title')}
      description={t('background.description')}
      enabled={enabled}
      onChange={setBackgroundMode}
      t={t}
    />
  )
}
