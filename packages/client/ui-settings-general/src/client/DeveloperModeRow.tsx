/** General Settings row turning Developer mode on or off. */

import type { SnapshotStore } from '@aeven/client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import { OnOffRow } from './OnOffRow.tsx'

/** Registration-side Developer mode face. */
export interface DeveloperModeRowInjected {
  hooks: {
    /** Persisted Developer mode, bound as useDeveloperMode. */
    developerMode: SnapshotStore<boolean>
  }
  /** Turn Developer mode on or off. */
  setDeveloperMode: (enabled: boolean) => void
}

/** Full Settings-row props. */
export type DeveloperModeRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings'>
  & InjectFace<DeveloperModeRowInjected>

/**
 * Render the Developer mode selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function DeveloperModeRow({ useDeveloperMode, setDeveloperMode, t }: DeveloperModeRowProps) {
  const enabled = useDeveloperMode(value => value)
  return (
    <OnOffRow
      title={t('developer.title')}
      description={t('developer.description')}
      enabled={enabled}
      onChange={setDeveloperMode}
      divider
      t={t}
    />
  )
}
