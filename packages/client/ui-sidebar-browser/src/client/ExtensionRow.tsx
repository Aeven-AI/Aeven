/** General Settings row showing which browsers the Aeven extension is connected in. */
import { useEffect, useState } from 'react'
import { Button, SettingsRow } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-settings/client'

/** Registration-side face. */
export interface ExtensionRowInjected {
  /** The browsers the extension is connected in now; empty when none is. */
  extensionStatus: () => Promise<ReadonlyArray<{ readonly browser: string }>>
  /** The extension's store page, offered while it is not connected; absent offers none. */
  installUrl: string | undefined
}

/** Full Settings-row props. */
export type ExtensionRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'sidebarBrowser'>
  & InjectFace<ExtensionRowInjected>

/**
 * Render the connection status, read when the row mounts and whenever the window regains focus,
 * which is when the reader returns from installing or turning on the extension.
 * @param props - composed Settings slot props.
 * @returns the status row.
 */
export function ExtensionRow({ extensionStatus, installUrl, t }: ExtensionRowProps) {
  const [browsers, setBrowsers] = useState<readonly string[]>([])
  useEffect(() => {
    let live = true
    const read = (): void => {
      void extensionStatus().then(
        (connected) => { if (live) setBrowsers(connected.map(entry => entry.browser)) },
        () => { if (live) setBrowsers([]) },
      )
    }
    read()
    window.addEventListener('focus', read)
    return () => {
      live = false
      window.removeEventListener('focus', read)
    }
  }, [extensionStatus])
  return (
    <SettingsRow
      title={t('browser.extension')}
      description={browsers.length === 0 ? t('browser.extension.disconnected') : t('browser.extension.connected', { browsers: browsers.join(', ') })}
      info={{ title: t('browser.extension'), body: t('browser.extension.info'), closeLabel: t('handoff.close') }}
      control={browsers.length === 0 && installUrl !== undefined
        ? <Button variant="outline" onClick={() => { window.open(installUrl, '_blank', 'noopener') }}>{t('browser.extension.add')}</Button>
        : undefined}
    />
  )
}
