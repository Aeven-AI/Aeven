/**
 * The signed-in reader's avatar and account menu, ported from Aeven's
 * `Navigation` profile menu so both clients present the same one.
 *
 * Aeven positions the panel with tippy; this positions it against the trigger
 * in CSS, which is all a menu anchored to one corner needs.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Menu, useDismissOnOutsidePointer } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
// Type-only: pulls the ui-layout SlotMap merge (the frame's corner seat).
import type {} from '@aeven/client-ui-layout/client'
import { Avatar } from './Avatar.tsx'
import { LANGUAGE_ICON, LOGOUT_ICON, SETTINGS_ICON } from './icons.ts'
import { NS } from './locales.ts'
import css from './AccountMenu.module.css'
import '../vendor/aeven-account.css'

/** The signed-in reader, as the menu needs them. */
export interface AccountReader {
  /** Aeven user id. */
  userId: string
  /** Chosen display name, absent until the reader sets one. */
  displayName?: string
  /** Account email address, the avatar initial's source when there is no display name. */
  email?: string
  /** Absolute URL of the uploaded picture, absent until the reader sets one. */
  imageUrl?: string
}

/** The plan the account is on, as the menu names it. */
export interface AccountType {
  /** Plan id, such as `free` or `pro`. */
  readonly plan: string
  /** The plan's name, absent when the account route did not state one. */
  readonly name?: string
}

/** One selectable language, as the menu's popover lists it. */
export interface AccountLanguage {
  /** Stable locale id the preference is stored under. */
  readonly id: string
  /** The language's own name; it is never translated. */
  readonly label: string
}

/** The locale facts the Language row shows. */
export interface AccountLocale {
  /** Id of the language currently in use. */
  readonly active: string
  /** Every selectable language in display order. */
  readonly locales: readonly AccountLanguage[]
}

/** Registration-side business face for the account menu. */
export interface AccountMenuInjected {
  /** The signed-in reader, or undefined when nobody is. */
  reader: () => AccountReader | undefined
  /**
   * Open the app's settings panel.
   * @param section - the settings section to open, or nothing for its landing page.
   */
  openSettings: (section?: string) => void
  /** The plan the account is on, or undefined when it could not be read. */
  accountType: () => Promise<AccountType | undefined>
  /** End the Aeven session and return the reader to the sign-in screen. */
  signOut: () => void
  hooks: {
    /** The locale catalog and active language, bound by the renderer as `useLocale`. */
    locale: {
      getSnapshot(): AccountLocale
      subscribe(listener: () => void): () => void
    }
  }
  /**
   * Switch the active language.
   * @param id - a selectable locale id.
   */
  setLocale: (id: string) => void
}

/** Full component props. */
export type AccountMenuProps =
  PropsRuntime<'shell.corner'>
  & PropsLocale<typeof NS>
  & InjectFace<AccountMenuInjected>

/** The plan every account without a subscription is on. */
const FREE_PLAN = 'free'

/** Settings section the account's own page is registered under. */
const ACCOUNT_SECTION = 'account'

/**
 * Render the avatar and, while open, the account menu.
 * @param props - composed slot props.
 * @returns the menu, or null when nobody is signed in.
 */
export function AccountMenu({
  reader, openSettings, accountType, signOut, useLocale, setLocale, t,
}: AccountMenuProps) {
  const person = reader()
  const signedIn = person !== undefined
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<AccountType | undefined>(undefined)
  const [languageOpen, setLanguageOpen] = useState(false)
  const languages = useLocale(state => state.locales)
  const activeLanguage = useLocale(state => state.active)
  const root = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  // Where the last press landed. The language card is portaled out of this
  // root, so that press is how the card's own close knows whether the reader
  // left the menu entirely or only the card.
  const pressTarget = useRef<EventTarget | null>(null)
  // While the card is open it owns dismissal: Menu closes it on an outside
  // press and `closeLanguage` below carries that press on to this menu.
  useDismissOnOutsidePointer(root, open && !languageOpen, setOpen)

  /**
   * Read the plan and keep it.
   * @returns a function that drops an answer arriving after unmount.
   */
  const read = useCallback((): (() => void) => {
    let live = true
    void accountType().then((answer) => { if (live) setType(answer) })
    return () => { live = false }
  }, [accountType])

  // Read the plan with the page rather than with the panel: the avatar is
  // resident, so the read has landed by the time a reader opens the menu and
  // the plan line is drawn with the panel instead of a moment after it. The
  // panel opens far more often than a plan changes, and a plan changes from
  // the account page this menu leads to.
  useEffect(() => {
    if (!signedIn || type !== undefined) return
    return read()
  }, [signedIn, type, read])

  // An open without a plan means the read above is still settling or failed:
  // ask again. A request already running is shared, so this costs nothing while
  // the page's read is in flight.
  useEffect(() => {
    if (!open || type !== undefined) return
    return read()
  }, [open, type, read])

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

  // A language card left open behind a dismissed menu would still be showing
  // when the reader opens the avatar again.
  useEffect(() => {
    if (!open) setLanguageOpen(false)
  }, [open])

  useEffect(() => {
    const remember = (event: PointerEvent): void => { pressTarget.current = event.target }
    document.addEventListener('pointerdown', remember, true)
    return () => { document.removeEventListener('pointerdown', remember, true) }
  }, [])

  /**
   * Close the card from its own dismissal, taking the menu with it when the
   * press that closed it was outside the menu as well.
   */
  const closeLanguage = useCallback(() => {
    setLanguageOpen(false)
    const target = pressTarget.current
    if (target instanceof Node && root.current?.contains(target) !== true) setOpen(false)
  }, [])

  const pickLanguage = useCallback((id: string) => {
    setLanguageOpen(false)
    setLocale(id)
  }, [setLocale])

  // The picture and the name are the reader, so they lead to the page about
  // them rather than to the settings landing page.
  const account = useCallback(() => {
    setOpen(false)
    openSettings(ACCOUNT_SECTION)
  }, [openSettings])

  // Nobody signed in means no Aeven authority on this page at all; the shell
  // keeps the shape it has without this plugin.
  if (person === undefined) return null

  const avatar = {
    ...person.displayName === undefined ? {} : { name: person.displayName },
    ...person.email === undefined ? {} : { email: person.email },
    ...person.imageUrl === undefined ? {} : { imageUrl: person.imageUrl },
    alt: t('avatar.alt'),
  }
  const plan = type === undefined
    ? undefined
    : t('plan.status', { plan: type.plan === FREE_PLAN ? t('plan.free') : type.name ?? type.plan })
  const profile = (
    <>
      <Avatar {...avatar} />
      <span className="profile-info">
        <span className="profile-name">{person.displayName}</span>
        {plan !== undefined && <span className={css.plan}>{plan}</span>}
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
            <div className="tippy-content no-scrollbar" data-state="visible">
              <div className="menu-container">
                <button
                  type="button"
                  className={`profile-overview ${css.profile}`}
                  role="menuitem"
                  onClick={account}
                >
                  {profile}
                </button>

                <button type="button" className="menu-button" role="menuitem" onClick={settings}>
                  <span className="icon" dangerouslySetInnerHTML={{ __html: SETTINGS_ICON }} />
                  <span className="txt">{t('settings')}</span>
                </button>

                <Menu
                  open={languageOpen}
                  onClose={closeLanguage}
                  items={languages.map(language => ({ id: language.id, label: language.label }))}
                  selectedId={activeLanguage}
                  onSelect={pickLanguage}
                  align="end"
                  portal
                  anchor={(
                    <button
                      type="button"
                      className="menu-button"
                      role="menuitem"
                      aria-haspopup="menu"
                      aria-expanded={languageOpen}
                      onClick={() => { setLanguageOpen(current => !current) }}
                    >
                      <span className="icon" dangerouslySetInnerHTML={{ __html: LANGUAGE_ICON }} />
                      <span className="txt">{t('language')}</span>
                    </button>
                  )}
                />

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
