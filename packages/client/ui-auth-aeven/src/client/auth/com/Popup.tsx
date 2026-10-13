/**
 * The popup the authentication screens raise through `show:modal`.
 *
 * The popup is the ui-primitives `Modal` the application uses. These screens
 * render before the plugin tree exists, so neither that module nor the ui-theme
 * sheets its tokens come from are on the page yet: both are loaded on the first
 * popup rather than with the gate, which keeps sign-in working on a page whose
 * application chunks fail to load. The shell already requests the primitives
 * early, so the first popup normally finds them ready.
 * @module
 */

import { useEffect, useState } from 'react'
import type React from 'react'

import * as events from '../services/events.ts'
import * as utility from '../services/utility.ts'
import { t } from '../../locales.ts'

/** What a screen dispatches with `show:modal`. */
export interface PopupRequest {
  readonly header: string
  /** Plain text; the popup renders it as its description. */
  readonly content: string
  readonly buttonText: string
}

/** The two ui-primitives components the popup is built from. */
type Primitives = Pick<typeof import('@aeven/client-ui-primitives'), 'Modal' | 'Button'>

/**
 * The popup layer, mounted once beside the screens.
 * @returns the open popup, or nothing while none is open or its module is loading.
 */
export function Popup(): React.JSX.Element | null {
  const [request, setRequest] = useState<PopupRequest | null>(null)
  const [primitives, setPrimitives] = useState<Primitives | null>(null)

  useEffect(() => {
    const guid = utility.guid()
    let disposed = false
    let loading: Promise<void> | undefined
    let removeSheets: (() => void) | undefined

    const load = (): Promise<void> => {
      loading ??= Promise.all([
        import('@aeven/client-ui-primitives'),
        import('@aeven/client-ui-theme/src/client/styles.ts'),
      ]).then(([module, theme]) => {
        if (disposed) return
        removeSheets = theme.mountThemeStyles()
        setPrimitives({ Modal: module.Modal, Button: module.Button })
      })
      return loading
    }

    events.on('show:modal', guid, (detail) => {
      const next = detail as PopupRequest
      setRequest(next)
      load().catch(() => {
        // The application chunks did not load, so the popup cannot render; the
        // reader still has to learn why their submission stopped.
        loading = undefined
        window.alert(`${next.header}\n\n${next.content}`)
        setRequest(null)
      })
    })
    events.on('hide:modal', guid, () => { setRequest(null) })
    // A route change dismisses whatever is open; a popup raised right after the
    // change arrives after this.
    const dismiss = (): void => { setRequest(null) }
    window.addEventListener('popstate', dismiss)

    return () => {
      disposed = true
      events.off('show:modal', guid)
      events.off('hide:modal', guid)
      window.removeEventListener('popstate', dismiss)
      removeSheets?.()
    }
  }, [])

  if (request === null || primitives === null) return null
  const { Modal, Button } = primitives
  const close = (): void => { setRequest(null) }

  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('action.close')}
      title={request.header}
      description={request.content}
      footer={<Button variant="primary" onClick={close}>{request.buttonText}</Button>}
    />
  )
}

export default Popup
