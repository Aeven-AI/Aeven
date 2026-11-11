/**
 * The sign-in screens' header menu: a vertical ellipsis at the header's far
 * end that opens Install (on a phone, outside the installed app) and Language,
 * whose list is the account menu's language list.
 *
 * The screens run before the plugin graph, so a language pick is kept by
 * `chooseAuthLocale` for this browser and read by the screens' own `t`, and the
 * install steps open in the screens' own popup.
 * @module
 */

import { useEffect, useRef, useState } from 'react'
import type React from 'react'

import * as events from '../services/events.ts'
import { installApp, installOffer } from '../services/install.ts'
import { AUTH_LANGUAGES, authLocale, chooseAuthLocale, t } from '../../locales.ts'

/** The SVG attributes every glyph here shares, as Lucide draws them. */
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"'
  + ' stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'

/** Lucide `ellipsis-vertical`, the header button. */
const MORE_ICON = `${SVG}<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>`

/** Lucide `cloud-download`, the Install item. */
const INSTALL_ICON = `${SVG}<path d="M12 13v8l-4-4"/><path d="m12 21 4-4"/>`
  + '<path d="M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284"/></svg>'

/** Lucide `globe`, the Language item. */
const LANGUAGE_ICON = `${SVG}<circle cx="12" cy="12" r="10"/>`
  + '<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>'

/** Props of {@link HeaderMenu}. */
export interface HeaderMenuProps {
  /** Called after a language pick, so the screen renders its copy again in the new language. */
  readonly onLocaleChange: () => void
}

/** The ui-primitives language list the account menu uses, loaded on first open. */
type Primitives = Pick<typeof import('@aeven/client-ui-primitives'), 'Menu'>

/**
 * The ellipsis button and its card, drawn with the account menu's markup so the
 * two popups share one design.
 * @param props - the language change callback.
 * @returns the control.
 */
export function HeaderMenu(props: HeaderMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [languageOpen, setLanguageOpen] = useState(false)
  const [primitives, setPrimitives] = useState<Primitives | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const removeSheets = useRef<(() => void) | undefined>(undefined)
  const active = authLocale()
  const offer = open ? installOffer() : undefined

  useEffect(() => () => { removeSheets.current?.() }, [])

  useEffect(() => {
    if (!open || languageOpen) return
    const onPointer = (event: PointerEvent): void => {
      if (event.target instanceof Node && root.current?.contains(event.target) !== true) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, languageOpen])

  // The language list is the account menu's ui-primitives Menu. These screens
  // render before the plugin tree, so it and the theme sheets it reads load on
  // first use, as the screens' popup does.
  const openLanguages = (): void => {
    if (primitives !== null) {
      setLanguageOpen(current => !current)
      return
    }
    void Promise.all([
      import('@aeven/client-ui-primitives'),
      import('@aeven/client-ui-theme/src/client/styles.ts'),
    ]).then(([module, theme]) => {
      removeSheets.current = theme.mountThemeStyles()
      setPrimitives({ Menu: module.Menu })
      setLanguageOpen(true)
    })
  }

  const install = (): void => {
    setOpen(false)
    void installApp().then((outcome) => {
      if (outcome !== 'ios' && outcome !== 'android') return
      events.dispatchObjectEvent('show:modal', {
        header: t('install.title'),
        content: t(outcome === 'ios' ? 'install.ios' : 'install.android'),
        buttonText: t('install.ok'),
      })
    })
  }

  const languageRow = (
    <button
      type="button"
      className="menu-button"
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={languageOpen}
      onClick={openLanguages}
    >
      <span className="icon" dangerouslySetInnerHTML={{ __html: LANGUAGE_ICON }} />
      <span className="txt">{t('action.language')}</span>
    </button>
  )

  return (
    <div className="auth-menu" ref={root}>
      <button
        type="button"
        className="auth-menu-button"
        aria-label={t('action.more')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setOpen(current => !current) }}
        dangerouslySetInnerHTML={{ __html: MORE_ICON }}
      />
      {open && (
        <div className="auth-menu-popover">
          <div
            className="tippy-box"
            data-theme="menu"
            data-state="visible"
            data-animation="tippy-show"
            data-placement="bottom-end"
            role="menu"
          >
            <div className="tippy-content no-scrollbar" data-state="visible">
              <div className="menu-container">
                {offer !== undefined && (
                  <button type="button" className="menu-button" role="menuitem" onClick={install}>
                    <span className="icon" dangerouslySetInnerHTML={{ __html: INSTALL_ICON }} />
                    <span className="txt">{t('install.app')}</span>
                  </button>
                )}
                {primitives === null
                  ? languageRow
                  : (
                    <primitives.Menu
                      open={languageOpen}
                      onClose={() => { setLanguageOpen(false) }}
                      items={AUTH_LANGUAGES.map(language => ({ id: language.id, label: language.label }))}
                      selectedId={active}
                      onSelect={(id: string) => {
                        setLanguageOpen(false)
                        setOpen(false)
                        chooseAuthLocale(id)
                        props.onLocaleChange()
                      }}
                      align="end"
                      portal
                      anchor={languageRow}
                    />
                  )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
