/**
 * The signed-in reader's avatar and account menu, ported from Aeven's
 * `Navigation` profile menu so both clients present the same one.
 *
 * Aeven positions the panel with tippy; this positions it against the trigger
 * in CSS, which is all a menu anchored to one corner needs.
 */

import { useCallback, useRef, useState, type KeyboardEvent } from 'react'
import { useDismissOnOutsidePointer } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
// Type-only: pulls the ui-layout SlotMap merge (the frame's corner seat).
import type {} from '@aeven/client-ui-layout/client'
import { Avatar } from './Avatar.tsx'
import { ACCOUNT_ICON, LOGOUT_ICON, SETTINGS_ICON } from './icons.ts'
import { NS } from './locales.ts'
import css from './AccountMenu.module.css'
import '../vendor/aeven-account.css'

/** The signed-in reader, as the menu needs them. */
export interface AccountReader {
  /** Aeven user id, which seeds the avatar gradient. */
  userId: string
  /** Chosen display name, absent until the reader sets one. */
  displayName?: string
  /** Absolute URL of the uploaded picture, absent until the reader sets one. */
  imageUrl?: string
}

/** Registration-side business face for the account menu. */
export interface AccountMenuInjected {
  /** The signed-in reader, or undefined when nobody is. */
  reader: () => AccountReader | undefined
  /** The Aeven account page, or undefined when no web client is configured. */
  accountUrl: () => string | undefined
  /** Open the app's settings panel. */
  openSettings: () => void
  /** End the Aeven session and return the reader to the sign-in screen. */
  signOut: () => void
}

/** Full component props. */
export type AccountMenuProps =
  PropsRuntime<'shell.corner'>
  & PropsLocale<typeof NS>
  & InjectFace<AccountMenuInjected>

/**
 * Render the avatar and, while open, the account menu.
 * @param props - composed slot props.
 * @returns the menu, or null when nobody is signed in.
 */
export function AccountMenu({
  reader, accountUrl, openSettings, signOut, t,
}: AccountMenuProps) {
  const person = reader()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  useDismissOnOutsidePointer(root, open, setOpen)

  const close = useCallback(() => {
    setOpen(false)
    trigger.current?.focus()
  }, [])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') close()
  }, [close])

  const settings = useCallback(() => {
    setOpen(false)
    openSettings()
  }, [openSettings])

  // Nobody signed in means no Aeven authority on this page at all; the shell
  // keeps the shape it has without this plugin.
  if (person === undefined) return null

  const account = accountUrl()
  const avatar = {
    userId: person.userId,
    ...person.imageUrl === undefined ? {} : { imageUrl: person.imageUrl },
    alt: t('avatar.alt'),
  }
  const profile = (
    <>
      <Avatar {...avatar} />
      <span className="profile-info">
        <span className="profile-name">{person.displayName}</span>
      </span>
    </>
  )

  return (
    <div ref={root} className={`aeven-account ${css.mount}`} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        className={`tippy-button ${css.trigger}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('trigger.aria')}
        onClick={() => { setOpen(!open) }}
      >
        <Avatar {...avatar} pointer />
      </button>
      {open && (
        <div className={css.popover}>
          <div
            className="tippy-box"
            data-theme="menu"
            data-state="visible"
            data-animation="tippy-show"
            data-placement="bottom-end"
            role="menu"
          >
            <div className="tippy-content" data-state="visible">
              <div className="menu-container">
                {account === undefined
                  ? <span className="profile-overview">{profile}</span>
                  : <a className="profile-overview" href={account}>{profile}</a>}

                {account !== undefined && (
                  <a href={account} className="menu-button" role="menuitem">
                    <span className="icon" dangerouslySetInnerHTML={{ __html: ACCOUNT_ICON }} />
                    <span className="txt">{t('account')}</span>
                  </a>
                )}

                <button type="button" className="menu-button" role="menuitem" onClick={settings}>
                  <span className="icon" dangerouslySetInnerHTML={{ __html: SETTINGS_ICON }} />
                  <span className="txt">{t('settings')}</span>
                </button>

                <button type="button" className="menu-button" role="menuitem" onClick={signOut}>
                  <span className="icon" dangerouslySetInnerHTML={{ __html: LOGOUT_ICON }} />
                  <span className="txt">{t('logout')}</span>
                </button>

              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
