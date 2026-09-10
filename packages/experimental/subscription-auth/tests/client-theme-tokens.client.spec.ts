/** Theme-token contracts for Settings UI (light + dark readable contrast). */

import { describe, expect, it } from 'vitest'
import { badgeStyle, METER_FILL, primaryButtonStyle, statusToneColor, stepNumberActiveStyle } from '../src/client/styles.ts'

describe('Settings theme token contracts', () => {
  it('primary CTAs match the Plugins tab pairing and hardcode no colour', () => {
    expect(String(primaryButtonStyle.background)).toContain('--dsw-alias-label-primary')
    expect(String(primaryButtonStyle.color)).toContain('--dsw-alias-bg-layer-3')
    expect(String(primaryButtonStyle.color)).not.toMatch(/#fff/i)
    expect(String(primaryButtonStyle.background)).not.toContain('--dsw-alias-brand-primary')
  })

  it('active step markers use the same primary fill/foreground pairing', () => {
    expect(String(stepNumberActiveStyle.background)).toContain('--dsw-alias-button-primary-fill')
    expect(String(stepNumberActiveStyle.color)).toContain('--dsw-alias-label-primary-foreground')
    expect(String(stepNumberActiveStyle.color)).not.toMatch(/#fff/i)
  })

  it('uses the real DSH warn token spelling and readable neutral labels', () => {
    expect(statusToneColor('warning')).toContain('--dsw-alias-state-warn-primary')
    expect(statusToneColor('warning')).not.toContain('state-warning')
    expect(statusToneColor('neutral')).toContain('--dsw-alias-label-tertiary')
    expect(statusToneColor('neutral')).not.toContain('label-dimmed')
    expect(String(badgeStyle('neutral').color)).toContain('label-tertiary')
  })

  it('avoids hardcoded white fallbacks on theme-sensitive fills', async () => {
    const toggleSource = await import('node:fs/promises').then(fs =>
      fs.readFile(new URL('../src/client/components/ToggleSwitch.tsx', import.meta.url), 'utf8'),
    )
    expect(toggleSource).not.toMatch(/#ffffff|#fff\b/i)
    expect(toggleSource).toContain('--dsw-alias-button-primary-fill')
    expect(toggleSource).toContain('--dsw-alias-label-primary-foreground')

    expect(METER_FILL.normal).toContain('--dsw-alias-button-info-fill')
    expect(Object.values(METER_FILL).join(' ')).not.toContain('--dsw-alias-brand-primary')
  })
})
