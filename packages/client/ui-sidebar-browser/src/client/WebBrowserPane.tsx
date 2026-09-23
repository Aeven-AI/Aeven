/**
 * The right sidebar's browser in a browser tab, where no `<webview>` exists:
 * choosing it opens the Host's Chromium (`@aeven/browser-chromium`), which the
 * model drives through chrome-devtools-mcp. The pane keeps a link to bring the
 * browser back.
 */
import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { TranslateNS } from '@aeven/client-locale/client'
import type { ClientRemote, SessionId } from '@aeven/api-remotes/client'
import { ExternalLink } from './icons.tsx'
import css from './BrowserPane.module.css'

/** Props of the web browser pane. */
export interface WebBrowserPaneProps {
  /** Session the request is made for. */
  readonly sessionId: string
  /** Translate function bound to the `sidebarBrowser` dictionary. */
  readonly t: TranslateNS<'sidebarBrowser'>
  /** The Host capabilities this client mounted. */
  readonly remote: ClientRemote
}

/**
 * Open the Host's Chromium when chosen, and offer to bring it back.
 * @param props - see {@link WebBrowserPaneProps}.
 * @returns the pane element tree.
 */
export function WebBrowserPane({ sessionId, t, remote }: WebBrowserPaneProps): ReactNode {
  const [state, setState] = useState<'opening' | 'open' | 'failed'>('opening')

  const open = useCallback(async (): Promise<void> => {
    setState('opening')
    try {
      const result = await remote.browserChromium.open(sessionId as SessionId, '')
      if (!result.ok) console.error('ui-sidebar-browser: opening Chromium failed', result.error)
      setState(result.ok ? 'open' : 'failed')
    } catch (error) {
      console.error('ui-sidebar-browser: opening Chromium failed', error)
      setState('failed')
    }
  }, [remote, sessionId])

  useEffect(() => { void open() }, [open])

  return (
    <div className={css.root} data-sidebar-right-browser-web="">
      <div className={css.row}>
        <button type="button" className={css.webOpen} disabled={state === 'opening'} onClick={() => { void open() }}>
          <ExternalLink />
          {t('web.open')}
        </button>
      </div>
      <p className={css.webNote}>{t(state === 'failed' ? 'web.failed' : state === 'open' ? 'web.opened' : 'web.note')}</p>
    </div>
  )
}
