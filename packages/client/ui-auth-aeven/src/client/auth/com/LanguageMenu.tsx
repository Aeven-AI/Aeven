/**
 * The sign-in screens' language control: a globe at the header's far end that
 * opens the languages these screens ship.
 *
 * The screens run before the plugin graph, so the pick is kept by
 * `chooseAuthLocale` for this browser and read by the screens' own `t`.
 * @module
 */

import { useEffect, useRef, useState } from 'react'
import type React from 'react'

import { AUTH_LANGUAGES, authLocale, chooseAuthLocale, t } from '../../locales.ts'

/** Lucide `globe`, the glyph the account menu's language row carries. */
const LANGUAGE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"'
  + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"'
  + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<circle cx="12" cy="12" r="10"/>'
  + '<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>'
  + '<path d="M2 12h20"/></svg>'

/** Props of {@link LanguageMenu}. */
export interface LanguageMenuProps {
  /** Called after a pick, so the screen renders its copy again in the new language. */
  readonly onChange: () => void
}

/**
 * The globe button and its list of languages.
 * @param props - the change callback.
 * @returns the control.
 */
export function LanguageMenu(props: LanguageMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const active = authLocale()

  useEffect(() => {
    if (!open) return
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
  }, [open])

  return (
    <div className="auth-language" ref={root}>
      <button
        type="button"
        className="auth-language-button"
        aria-label={t('action.language')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
        dangerouslySetInnerHTML={{ __html: LANGUAGE_ICON }}
      />
      {open && (
        <ul className="auth-language-menu" role="menu" aria-label={t('action.language')}>
          {AUTH_LANGUAGES.map(language => (
            <li key={language.id} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={language.id === active}
                lang={language.id}
                className="auth-language-option"
                onClick={() => {
                  setOpen(false)
                  chooseAuthLocale(language.id)
                  props.onChange()
                }}
              >
                {language.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
