/** General Settings row for the Composer's busy-state Enter preference. */
import type { SnapshotStore } from '@aeven/client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import { SettingsRow, SettingsSelect } from '@aeven/client-ui-primitives'
import type { BusyEnterBehavior } from '../contract/composer-submission.ts'
import type { ConversationKey } from '../locales.ts'

/** Registration-side preference face. */
export interface EnterBehaviorRowInjected {
  hooks: {
    /** Persisted busy-state preference bound as useBusyEnter. */
    busyEnter: SnapshotStore<BusyEnterBehavior>
  }
  /** Change the busy-state plain-Enter behavior. */
  setBusyEnter: (behavior: BusyEnterBehavior) => void
}

/** Full Settings-row props. */
export type EnterBehaviorRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'conversation'>
  & InjectFace<EnterBehaviorRowInjected>

const OPTIONS: readonly {
  id: BusyEnterBehavior
  label: ConversationKey
}[] = [
  { id: 'queue', label: 'settings.enter.queue' },
  { id: 'steer', label: 'settings.enter.steer' },
]

/**
 * Render the busy-state Enter behavior selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function EnterBehaviorRow({ useBusyEnter, setBusyEnter, t }: EnterBehaviorRowProps) {
  const behavior = useBusyEnter(value => value)

  return (
    <SettingsRow
      title={t('settings.enter.title')}
      description={t('settings.enter.description')}
      control={(
        <SettingsSelect
          items={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
          selectedId={behavior}
          onSelect={(id) => { setBusyEnter(id as BusyEnterBehavior) }}
        />
      )}
    />
  )
}
