/** Theme-token contracts for the Subscriptions cards (light + dark readable contrast). */

import { describe, expect, it } from 'vitest'
import * as styles from '../src/client/styles.ts'
import {
  chevronStyle,
  foldoutStyle,
  METER_FILL,
  METER_TRACK,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../src/client/styles.ts'

describe('Settings theme token contracts', () => {
  it('primary CTAs use the shared primary-fill pairing and hardcode no colour', () => {
    expect(String(primaryButtonStyle.background)).toContain('--dsw-alias-button-primary-fill')
    expect(String(primaryButtonStyle.color)).toContain('--dsw-alias-label-primary-foreground')
    expect(String(primaryButtonStyle.color)).not.toMatch(/#fff/i)
    expect(String(primaryButtonStyle.background)).not.toContain('--dsw-alias-brand-primary')
    expect(String(secondaryButtonStyle.borderColor)).toContain('--dsw-alias-border-l3')
  })

  it('fills the card with the panel surface, open and closed', () => {
    expect(foldoutStyle(false)).toMatchObject({ borderRadius: 16, background: 'var(--dsw-alias-bg-layer-2)' })
    expect(foldoutStyle(true)).toMatchObject({
      background: 'var(--dsw-alias-bg-layer-2)',
      borderColor: 'var(--dsw-alias-label-dimmed)',
    })
  })

  it('sets no text smaller than 14px', () => {
    const sizes = Object.values(styles)
      .filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null)
      .map(value => value['fontSize'])
      .filter((size): size is number => typeof size === 'number')
    expect(sizes.length).toBeGreaterThan(0)
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14)
  })

  it('fills usage meters with the info token, never brand-primary', () => {
    expect(METER_FILL.normal).toContain('--dsw-alias-button-info-fill')
    expect(Object.values(METER_FILL).join(' ')).not.toContain('--dsw-alias-brand-primary')
  })

  it('leaves the usage meter track distinct from every fill', () => {
    expect(METER_TRACK).toBe('var(--dsw-alias-border-l2)')
    expect(Object.values(METER_FILL)).not.toContain(METER_TRACK)
  })

  it('points the disclosure chevron down while closed and up while open', () => {
    expect(String(chevronStyle(false).transform)).toBe('none')
    expect(String(chevronStyle(true).transform)).toBe('rotate(180deg)')
  })
})
