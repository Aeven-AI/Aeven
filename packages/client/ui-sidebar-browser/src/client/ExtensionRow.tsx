/**
 * General Settings row showing which browsers the Aeven extension is connected in.
 * In the desktop app it also turns the extension's connection to the app on or off.
 */
import { useEffect, useState } from 'react'
import { Button, SettingsRow, Switch } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-settings/client'

/** The desktop app's choice to let the extension connect. */
export interface ExtensionIntegrationChoice {
  /** The stored choice. */
  read: () => Promise<boolean>
  /** Store the choice; off removes the app's registration from every browser. */
  write: (enabled: boolean) => Promise<void>
}

/** Registration-side face. */
export interface ExtensionRowInjected {
  /** The browsers the extension is connected in now; empty when none is. */
  extensionStatus: () => Promise<ReadonlyArray<{ readonly browser: string }>>
  /** The extension's store page, offered while it is not connected; absent offers none. */
  installUrl: string | undefined
  /** The desktop app's on/off choice; absent in the web app, where the extension connects to the page itself. */
  integration: ExtensionIntegrationChoice | undefined
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
export function ExtensionRow({ extensionStatus, installUrl, integration, t }: ExtensionRowProps) {
  const [browsers, setBrowsers] = useState<readonly string[]>([])
  const [enabled, setEnabled] = useState(true)
  useEffect(() => {
    let live = true
    const read = (): void => {
      void extensionStatus().then(
        (connected) => { if (live) setBrowsers(connected.map(entry => entry.browser)) },
        () => { if (live) setBrowsers([]) },
      )
      // A choice that cannot be read leaves the switch as it was.
      void integration?.read().then((stored) => { if (live) setEnabled(stored) }, () => undefined)
    }
    read()
    window.addEventListener('focus', read)
    return () => {
      live = false
      window.removeEventListener('focus', read)
    }
  }, [extensionStatus, integration])
  const change = (next: boolean): void => {
    if (integration === undefined) return
    setEnabled(next)
    if (!next) setBrowsers([])
    // A choice the app could not apply shows as the choice it still holds.
    void integration.write(next).catch(() => { setEnabled(!next) })
  }
  const description = !enabled
    ? t('browser.extension.off')
    : browsers.length === 0 ? t('browser.extension.disconnected') : t('browser.extension.connected', { browsers: browsers.join(', ') })
  return (
    <SettingsRow
      title={t('browser.extension')}
      description={description}
      info={{ title: t('browser.extension'), body: t('browser.extension.info'), closeLabel: t('handoff.close') }}
      control={integration !== undefined
        ? <Switch checked={enabled} onChange={change} label={t('browser.extension')} />
        : browsers.length === 0 && installUrl !== undefined
          ? <Button variant="outline" onClick={() => { window.open(installUrl, '_blank', 'noopener') }}>{t('browser.extension.add')}</Button>
          : undefined}
    />
  )
}
