/** Usage quota progress bar with threshold-based color. */

import { hintStyle, METER_FILL, METER_TRACK } from '../styles.ts'

export interface ProgressBarProps {
  /** 0–100 used percentage. */
  value: number
  label?: string
  meta?: string
}

function barColor(percent: number): string {
  if (percent >= 90) return METER_FILL.critical
  if (percent >= 75) return METER_FILL.warning
  return METER_FILL.normal
}

export function ProgressBar({ value, label, meta }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label === undefined ? null : (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ ...hintStyle, color: 'var(--dsw-alias-label-primary)' }}>{label}</span>
          {meta === undefined ? null : <span style={hintStyle}>{meta}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          height: 8,
          borderRadius: 4,
          background: METER_TRACK,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${String(clamped)}%`,
            height: '100%',
            borderRadius: 4,
            background: barColor(clamped),
            transition: 'width 0.3s ease, background 0.3s ease',
          }}
        />
      </div>
    </div>
  )
}
