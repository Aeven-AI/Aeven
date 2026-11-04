/**
 * The settings layout family: a titled group of rows, and the row itself
 * (label, description, trailing control). Every settings section composes
 * these, so pages contributed by different packages share one type scale and
 * one rhythm.
 */
import type { ReactNode } from 'react'
import css from './SettingsRow.module.css'

/** Props of {@link SettingsGroup}. */
export interface SettingsGroupProps {
  /** Group heading, rendered as an `h3`; absent renders none. */
  title?: ReactNode
  /** Supporting text under the heading; absent renders none. */
  description?: ReactNode
  /** Trailing content on the heading line, such as a count or an action; absent renders none. */
  aside?: ReactNode
  children?: ReactNode
}

/**
 * Render a group of settings rows under an optional heading. Consecutive
 * groups, and a group after loose rows, are spaced apart by the group itself.
 * @param props - see {@link SettingsGroupProps}.
 * @returns the `section` element.
 */
export function SettingsGroup({ title, description, aside, children }: SettingsGroupProps) {
  const hasHead = title !== undefined || aside !== undefined
  return (
    <section className={css.group}>
      {hasHead && (
        <div className={css.groupHead}>
          {title !== undefined && <h3 className={css.groupTitle}>{title}</h3>}
          {aside !== undefined && <span className={css.groupAside}>{aside}</span>}
        </div>
      )}
      {description !== undefined && <p className={css.groupDescription}>{description}</p>}
      {children}
    </section>
  )
}

/** Props of {@link SettingsRow}. */
export interface SettingsRowProps {
  /** The setting's name. */
  title: ReactNode
  /** Supporting text under the name; absent renders none. */
  description?: ReactNode
  /** Trailing control: a select, switch, or button; absent renders none. */
  control?: ReactNode
  /** Content under the row, such as an inline form or a progress line; absent renders none. */
  children?: ReactNode
}

/**
 * Render one settings row.
 * @param props - see {@link SettingsRowProps}.
 * @returns the row element.
 */
export function SettingsRow({ title, description, control, children }: SettingsRowProps) {
  return (
    <div className={css.row}>
      <div className={css.rowHead}>
        <div className={css.rowText}>
          <div className={css.rowTitle}>{title}</div>
          {description !== undefined && <div className={css.rowDescription}>{description}</div>}
        </div>
        {control !== undefined && <div className={css.rowControl}>{control}</div>}
      </div>
      {children}
    </div>
  )
}

/** Props of {@link SettingsMeter}. */
export interface SettingsMeterProps {
  /** What the bar measures, such as "Up to date" or "Syncing"; leads the line above the bar. */
  label: ReactNode
  /** Trailing figure on the line, such as "42%"; absent renders none. */
  value?: ReactNode
  /** Filled share from 0 to 100, or `null` for work whose size is not known yet, which animates the bar. */
  percent: number | null
  /** `muted` greys the fill for work that does not move, such as a pause; `error` marks a failure. */
  tone?: 'success' | 'muted' | 'error' | undefined
  /** The bar's accessible name. */
  ariaLabel: string
}

/**
 * Render a status line over a full-width progress bar, the way Settings shows how far something has come.
 * @param props - see {@link SettingsMeterProps}.
 * @returns the meter element.
 */
export function SettingsMeter({ label, value, percent, tone = 'success', ariaLabel }: SettingsMeterProps) {
  const known = percent !== null
  const filled = known ? Math.min(100, Math.max(0, percent)) : 0
  return (
    <div className={css.meter}>
      <div className={css.meterLine}>
        <span className={css.meterLabel}>{label}</span>
        {value !== undefined && <span className={css.meterValue}>{value}</span>}
      </div>
      <span
        className={css.meterTrack} data-tone={tone} data-indeterminate={known ? undefined : 'true'}
        role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={known ? Math.round(filled) : undefined}
        aria-label={ariaLabel}
      >
        <span style={known ? { width: `${String(filled === 0 ? 0 : Math.max(filled, 2))}%` } : undefined} />
      </span>
    </div>
  )
}
