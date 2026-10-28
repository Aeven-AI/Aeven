/**
 * Font-size preference row registered into the Appearance group item slot:
 * title + body-text-only description + stepper pill (centered value; hover
 * reveals the up/down arrow column anchored to the pill's right edge). Registered by this package — the theme feature
 * owns the content font-size setting the same way it owns the appearance
 * preference. The displayed value follows the persisted setting, never the
 * click echo.
 */
import {
  IconChevronDownOutline14, IconChevronUpOutline14, SettingsRow,
} from '@aeven/client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@aeven/client-ui-slots'
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from '../theme-settings.ts'
import type {} from '@aeven/client-ui-settings/client'
import type { createFontSizeRowStore } from './settings-store.ts'
import css from './FontSizeRow.module.css'

/** Injected business face: the preference write (t rides the standard locale seat). */
export interface FontSizeRowInjected {
  /** Change the content font size (integer px within FONT_SIZE_MIN..FONT_SIZE_MAX). */
  setFontSize: (px: number) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type FontSizeRowComponentProps =
  PropsRuntime<'settings.appearance.item'> & PropsStore<ReturnType<typeof createFontSizeRowStore>>
  & PropsLocale<'settings.theme'> & FontSizeRowInjected

/**
 * Render the font-size row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function FontSizeRow({ t, setFontSize, useStore }: FontSizeRowComponentProps) {
  const fontSize = useStore(s => s.fontSize)
  return (
    <SettingsRow
      title={t('fontSize.title')}
      description={t('fontSize.description')}
      control={(
        <div className={css.stepper}>
          <span className={css.value}>{fontSize}</span>
          <span className={css.arrows}>
            <button
              type="button"
              className={css.arrow}
              aria-label={t('fontSize.increase')}
              disabled={fontSize >= FONT_SIZE_MAX}
              onClick={() => { setFontSize(fontSize + 1) }}
            >
              <IconChevronUpOutline14 size={9} />
            </button>
            <button
              type="button"
              className={css.arrow}
              aria-label={t('fontSize.decrease')}
              disabled={fontSize <= FONT_SIZE_MIN}
              onClick={() => { setFontSize(fontSize - 1) }}
            >
              <IconChevronDownOutline14 size={9} />
            </button>
          </span>
        </div>
      )}
    />
  )
}
