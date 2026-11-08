/** General Settings row letting the agent use the reader's everyday Chrome. */
import type { SnapshotStore } from '@aeven/client-store'
import { SettingsRow, Switch } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-settings/client'

/** Registration-side face. */
export interface UserChromeRowInjected {
  hooks: {
    /** Persisted opt-in, bound as useUserChrome. */
    userChrome: SnapshotStore<boolean>
  }
  /** Store the choice in the Host settings document. */
  setUserChrome: (allowed: boolean) => void
}

/** Full Settings-row props. */
export type UserChromeRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'sidebarBrowser'>
  & InjectFace<UserChromeRowInjected>

/**
 * Render the opt-in switch.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function UserChromeRow({ useUserChrome, setUserChrome, t }: UserChromeRowProps) {
  const allowed = useUserChrome(value => value)
  return (
    <SettingsRow
      title={t('browser.userChrome')}
      description={t('browser.userChrome.description')}
      info={{ title: t('browser.userChrome'), body: t('browser.userChrome.info'), closeLabel: t('handoff.close') }}
      control={<Switch checked={allowed} onChange={setUserChrome} label={t('browser.userChrome')} />}
    />
  )
}
