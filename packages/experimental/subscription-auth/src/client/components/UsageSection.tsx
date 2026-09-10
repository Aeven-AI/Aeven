/**
 * Subscription usage panel, rendered for every signed-in provider.
 *
 * Usage is not a capability toggle, so this panel always says something. A
 * plan with no metered quota and a plan the provider refuses are different
 * answers to "why did my model call fail", so each gets its own state instead
 * of collapsing into one empty line.
 */

import type { GrokBuildSettingsKey } from '../locales.ts'
import { formatEpoch } from '../parsers.ts'
import { bodyStyle, hintStyle, linkStyle, METER_TRACK, PRODUCT_FILLS } from '../styles.ts'
import type { UsageBreakdownView, UsageCreditsView, UsageView, UsageWindowView } from '../types.ts'
import { ProgressBar } from './ProgressBar.tsx'

export interface UsageSectionProps {
  usage: UsageView | undefined
  error: string | undefined
  loading: boolean
  t: (key: GrokBuildSettingsKey, params?: Record<string, unknown>) => string
  style: React.CSSProperties
  /** Re-read the provider, bypassing the Host's cached answer. */
  onRefresh?: () => void
}

const WINDOW_LABEL_KEYS: Readonly<Record<UsageWindowView['label'], GrokBuildSettingsKey>> = {
  fiveHour: 'usageWindowFiveHour',
  weekly: 'usageWindowWeekly',
  weeklyOpus: 'usageWindowWeeklyOpus',
  monthly: 'usageWindowMonthly',
  session: 'usageWindowSession',
  codeReview: 'usageWindowCodeReview',
  usage: 'usageWindowGeneric',
  custom: 'usageWindowGeneric',
}

const PRODUCT_LABEL_KEYS: Readonly<Record<UsageBreakdownView['label'], GrokBuildSettingsKey>> = {
  grokBuild: 'usageProductGrokBuild',
  chat: 'usageProductChat',
  imagine: 'usageProductImagine',
  custom: 'usageProductGrokBuild',
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: '20px',
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
}

const blockStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 }

const blockLabelStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-secondary)',
}

const figureRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
}

const figureStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 22,
  lineHeight: '28px',
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
}

const figureUnitStyle: React.CSSProperties = {
  marginLeft: 6,
  fontSize: 13,
  fontWeight: 400,
  color: 'var(--dsw-alias-label-secondary)',
}

const metaStyle: React.CSSProperties = { ...hintStyle, margin: 0, color: 'var(--dsw-alias-label-tertiary)' }

const legendStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 13, lineHeight: '20px' }

const refreshButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--dsw-alias-label-tertiary)',
  cursor: 'pointer',
}

/** Format a credit balance in the unit its provider actually reports; whole amounts drop their fraction. */
function formatCredits(credits: UsageCreditsView, t: UsageSectionProps['t']): string {
  if (credits.unlimited === true) return t('usageCreditsUnlimited')
  if (credits.kind === 'count') return String(credits.remaining)
  const style = { style: 'currency', currency: credits.currency } as const
  const digits = new Intl.NumberFormat(undefined, style).resolvedOptions().maximumFractionDigits ?? 2
  const amount = credits.remaining / 10 ** digits
  const whole = Number.isInteger(amount)
  return new Intl.NumberFormat(undefined, { ...style, ...(whole ? { minimumFractionDigits: 0 } : {}) }).format(amount)
}

function productName(entry: UsageBreakdownView, t: UsageSectionProps['t']): string {
  return entry.label === 'custom' && entry.labelText !== undefined ? entry.labelText : t(PRODUCT_LABEL_KEYS[entry.label])
}

/** What is left of a window and when it resets, on one line. */
function WindowFigures({ window, t }: { window: UsageWindowView; t: UsageSectionProps['t'] }) {
  const resets = formatEpoch(window.resetsAt)
  return (
    <div style={figureRowStyle}>
      <p style={figureStyle}>
        {`${String(window.remainingPercent)}%`}
        <span style={figureUnitStyle}>{t('usageRemaining')}</span>
      </p>
      {resets === undefined ? null : <p style={metaStyle}>{t('usageResets', { time: resets })}</p>}
    </div>
  )
}

/**
 * A pooled allowance split by product: one bar whose segments are each
 * product's share of the pool, with the unused remainder left as track.
 */
function UsageBreakdown({
  entries,
  pool,
  t,
}: {
  entries: readonly UsageBreakdownView[]
  pool: UsageWindowView | undefined
  t: UsageSectionProps['t']
}) {
  /* v8 ignore next -- the clamp caps the index at the last element, so the lookup is never nullish */
  const fill = (index: number): string => PRODUCT_FILLS[Math.min(index, PRODUCT_FILLS.length - 1)] ?? METER_TRACK
  return (
    <div style={blockStyle}>
      <p style={blockLabelStyle}>{t('usageBreakdownTitle')}</p>
      {pool === undefined ? null : <WindowFigures window={pool} t={t} />}
      <div
        aria-hidden="true"
        style={{ display: 'flex', gap: 2, height: 8, borderRadius: 4, overflow: 'hidden', background: METER_TRACK }}
      >
        {entries.map((entry, index) => (
          <span key={entry.id} style={{ width: `${String(entry.usedPercent)}%`, background: fill(index) }} />
        ))}
      </div>
      <div style={legendStyle}>
        {entries.map((entry, index) => (
          <span key={entry.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 3, background: fill(index) }} />
            <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>{productName(entry, t)}</span>
            <span style={{ color: 'var(--dsw-alias-label-primary)' }}>
              {`${String(entry.usedPercent)}%`}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

function UsageMeter({ window, t }: { window: UsageWindowView; t: UsageSectionProps['t'] }) {
  const name =
    window.label === 'custom' && window.labelText !== undefined ? window.labelText : t(WINDOW_LABEL_KEYS[window.label])
  return (
    <div style={blockStyle}>
      <p style={blockLabelStyle}>{name}</p>
      <WindowFigures window={window} t={t} />
      {/* The bar is coloured by consumption, so it takes the complement. */}
      <ProgressBar value={100 - window.remainingPercent} />
    </div>
  )
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89M13.5 2.5v3.5H10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function UsageSection({ usage, error, loading, t, style, onRefresh }: UsageSectionProps) {
  const fetchedAt = formatEpoch(usage?.fetchedAt)
  const tier = usage?.tier

  const body = (): React.ReactNode => {
    if (loading && usage === undefined) return <p style={hintStyle}>{t('usageLoading')}</p>
    if (usage === undefined) return <p style={hintStyle}>{t('usageUnavailable')}</p>
    if (usage.entitlement === 'redirected') {
      return (
        <div style={blockStyle}>
          <p style={hintStyle}>{t('usageRedirect')}</p>
          {usage.redirectUrl === undefined ? null : (
            <a style={linkStyle} href={usage.redirectUrl} target="_blank" rel="noreferrer noopener">
              {t('usageOpenProvider')}
            </a>
          )}
        </div>
      )
    }
    if (usage.entitlement === 'not-entitled') {
      return (
        <div style={blockStyle}>
          {/* The provider's own wording when it gave one; ours only otherwise. */}
          <p style={bodyStyle}>{usage.gate?.message ?? t('usageNotEntitled')}</p>
          {usage.gate?.url === undefined ? null : (
            <a style={linkStyle} href={usage.gate.url} target="_blank" rel="noreferrer noopener">
              {usage.gate.label ?? t('usageOpenProvider')}
            </a>
          )}
        </div>
      )
    }
    if (usage.entitlement === 'no-subscription') {
      return (
        <div style={blockStyle}>
          <p style={bodyStyle}>{t('usageNoSubscription')}</p>
          <p style={hintStyle}>{t('usageNoSubscriptionHint')}</p>
        </div>
      )
    }
    if (usage.entitlement === 'unknown') return <p style={hintStyle}>{t('usageUnavailable')}</p>
    return (
      <>
        {usage.windows.map(window => (
          <UsageMeter key={window.id} window={window} t={t} />
        ))}
        {usage.breakdown === undefined || usage.breakdown.length === 0 ? null : (
          // A breakdown splits the provider's single pooled window, so it repeats that window's figures.
          <UsageBreakdown entries={usage.breakdown} pool={usage.windows.length === 1 ? usage.windows[0] : undefined} t={t} />
        )}
        {usage.credits === undefined ? null : (
          <div style={blockStyle}>
            <p style={blockLabelStyle}>{t('usageCreditsRemaining')}</p>
            <p style={figureStyle}>{formatCredits(usage.credits, t)}</p>
            <p style={metaStyle}>{t('usageCreditsHint')}</p>
          </div>
        )}
      </>
    )
  }

  return (
    <div style={{ ...style, gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <p style={titleStyle}>{t('usageTitle')}</p>
        {tier === undefined ? null : <span style={metaStyle}>{t('usageTier', { value: tier })}</span>}
      </div>
      {error === undefined ? null : (
        <p style={{ ...bodyStyle, color: 'var(--dsw-alias-state-error-primary)' }} role="alert">
          {error}
        </p>
      )}
      {body()}
      {fetchedAt === undefined && onRefresh === undefined ? null : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <p style={metaStyle}>{fetchedAt === undefined ? null : t('usageFetchedAt', { time: fetchedAt })}</p>
          {onRefresh === undefined ? null : (
            <button
              type="button"
              style={{ ...refreshButtonStyle, opacity: loading ? 0.5 : 1 }}
              aria-label={t('usageRefresh')}
              title={t('usageRefresh')}
              disabled={loading}
              onClick={onRefresh}
            >
              <span
                style={{
                  display: 'inline-flex',
                  animation: loading ? 'dsh-coding-oauth-spin 0.8s linear infinite' : undefined,
                }}
              >
                <RefreshIcon />
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
