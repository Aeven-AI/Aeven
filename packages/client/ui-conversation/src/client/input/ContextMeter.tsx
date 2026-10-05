/** Composer context occupancy, drawn for the Options popup: the ring glyph its
 * row shows, and the panel of heuristic `contextBreakdown` composition (system
 * prompt, tools, conversation) that row opens. The popup owns both the row and
 * the placement, so this module carries only the reading. */

import type { ReactNode } from 'react'
import { IconChevronRightOutline14 } from '@aeven/client-ui-primitives'
import type { ContextBreakdownProjection } from '@aeven/token-meter/client'
// Type-only: the `contextPressure` / `contextBreakdown` projection key merges.
import type {} from '@aeven/token-meter/client'
import type { ComposerBarProps } from '../contract/slots.ts'
import type { ContextOccupancy } from '../context-occupancy.ts'
import css from './ContextMeter.module.css'

/** Ring geometry: 14px viewBox, 2px stroke. */
const RADIUS = 5.5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * Marker the localized occupancy sentence is split on, so the panel headline
 * keeps the reading in its own tone while each locale still owns the word
 * order (`45% of context used` / `上下文已用 45%`).
 */
const READING_SLOT = '\u0000'

/** Panel legend rows, in bar-segment order; each color class carries the shared swatch/segment tint. */
const ROWS = [
  { key: 'systemTokens', label: 'context.system', color: css.colorSystem },
  { key: 'toolsTokens', label: 'context.tools', color: css.colorTools },
  { key: 'messageTokens', label: 'context.messages', color: css.colorMessages },
] as const

/**
 * Format a token count for the compact context panel.
 * @param value - token count.
 * @param t - Conversation locale seat with shared compact-number templates.
 * @returns Compact localized count using K or M when needed.
 */
function formatTokens(value: number, t: ComposerBarProps['t']): string {
  const scaled = (candidate: number): string => candidate >= 100
    ? String(Math.round(candidate))
    : String(Math.round(candidate * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return t('number.thousand', { value: scaled(value / 1_000) })
  return t('number.million', { value: scaled(value / 1_000_000) })
}

/**
 * The occupancy ring the Options row leads with.
 * @param props.percent - occupancy as a whole percentage.
 * @returns the ring glyph.
 */
export function ContextRing({ percent }: { percent: number }): ReactNode {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
      <circle className={css.track} cx="7" cy="7" r={RADIUS} />
      <circle
        className={css.fill}
        cx="7"
        cy="7"
        r={RADIUS}
        strokeDasharray={`${CIRCUMFERENCE * percent / 100} ${CIRCUMFERENCE}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  )
}

export interface ContextActionsProps {
  /** The owning bar's locale seat, passed down as a plain prop. */
  t: ComposerBarProps['t']
  /** Compact the conversation, the `/compact` command behind the reading. */
  onCompact: () => void
  /** Show the breakdown this card's second action opens. */
  onDetails: () => void
}

/**
 * Render the two actions the context row's card offers, ahead of the reading.
 * @param props - the locale seat and the two actions.
 * @returns the action rows.
 */
export function ContextActions({ t, onCompact, onDetails }: ContextActionsProps) {
  return (
    <>
      <button type="button" role="menuitem" className={css.action} onClick={onCompact}>
        <span className={css.actionLabel}>{t('options.compact')}</span>
      </button>
      <button type="button" role="menuitem" className={css.action} onClick={onDetails}>
        <span className={css.actionLabel}>{t('options.details')}</span>
        <span className={css.actionChevron} aria-hidden>
          <IconChevronRightOutline14 />
        </span>
      </button>
    </>
  )
}

export interface ContextPanelProps {
  /** The occupancy reading (`contextOccupancy` over the pressure projection). */
  context: ContextOccupancy
  /** Heuristic composition shares; absent while no provider reports them. */
  breakdown: ContextBreakdownProjection | undefined
  /** The owning bar's locale seat, passed down as a plain prop. */
  t: ComposerBarProps['t']
}

/**
 * Render the context breakdown: the occupancy headline, its bar, and the
 * composition rows.
 * @param props - the reading, the composition shares, and the locale seat.
 * @returns the panel content of the context row's card.
 */
export function ContextPanel({ context, breakdown, t }: ContextPanelProps) {
  const percent = context.percent
  const reading = `${percent}%`
  const [headBefore = '', headAfter = ''] = t('context.aria', { percent: READING_SLOT })
    .split(READING_SLOT)
    .map(part => part.trim())

  // The bar's overall length stays the provider-exact percent; the heuristic
  // breakdown only proportions its colored parts. A zero-width part is dropped
  // instead of rendered: `.segment`'s min-width keeps a hairline part visible,
  // which at 0% occupancy would draw a filled bar over an empty context.
  const breakdownTotal = breakdown === undefined
    ? 0
    : breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens
  const parts = breakdown === undefined || breakdownTotal === 0
    ? [{ key: 'total', color: undefined, width: percent }]
    : ROWS.map(row => ({ key: row.key, color: row.color, width: percent * breakdown[row.key] / breakdownTotal }))
  const segments = parts.filter(part => part.width > 0)

  return (
    <div className={css.panel}>
      <div className={css.header}>
        {/* Empty sides collapse through `.headline:empty` so the locale that
            needs no leading (or trailing) text spends no header gap. */}
        <span className={css.headline}>{headBefore}</span>
        <span className={css.percent}>{reading}</span>
        <span className={css.headline}>{headAfter}</span>
        <span className={css.figures}>
          {`~${formatTokens(context.usedTokens, t)} / ${formatTokens(context.contextWindow, t)}`}
        </span>
      </div>
      <div className={css.bar}>
        {segments.map(segment => (
          <div
            key={segment.key}
            className={segment.color === undefined ? css.segment : `${css.segment} ${segment.color}`}
            style={{ width: `${segment.width}%` }}
          />
        ))}
      </div>
      {breakdown !== undefined && (
        <dl className={css.rows}>
          {ROWS.map(row => (
            <div key={row.key} className={css.row}>
              <dt>
                <span className={`${css.swatch} ${row.color}`} aria-hidden />
                {t(row.label)}
              </dt>
              <dd>{`~${formatTokens(breakdown[row.key], t)}`}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
