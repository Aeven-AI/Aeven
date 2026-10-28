/** Appearance Settings row for the streamed-text word fade-in. */

import type { SnapshotStore } from '@aeven/client-store'
import { SettingsRow, Switch } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'

/** Registration-side fade-in preference face. */
export interface TextAnimationRowInjected {
  hooks: {
    /** Persisted fade-in preference bound as useTextAnimationSetting. */
    textAnimationSetting: SnapshotStore<boolean>
  }
  /** Turn the word fade-in on or off. */
  setTextAnimation: (enabled: boolean) => void
}

/** Full Settings-row props. */
export type TextAnimationRowProps =
  PropsRuntime<'settings.appearance.item'>
  & PropsLocale<'chat'>
  & InjectFace<TextAnimationRowInjected>

/**
 * Render the word fade-in switch.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function TextAnimationRow({ useTextAnimationSetting, setTextAnimation, t }: TextAnimationRowProps) {
  const enabled = useTextAnimationSetting(value => value)

  return (
    <SettingsRow
      title={t('settings.textAnimation.title')}
      description={t('settings.textAnimation.description')}
      control={(
        <Switch checked={enabled} onChange={setTextAnimation} label={t('settings.textAnimation.title')} />
      )}
    />
  )
}
