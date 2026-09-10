/** Theme-token contracts for Settings UI (light + dark readable contrast). */

import { describe, expect, it } from 'vitest'
import {
  badgeStyle,
  chevronStyle,
  dotStyle,
  METER_FILL,
  METER_TRACK,
  primaryButtonStyle,
  providerStatusTone,
  statusToneColor,
  stepNumberActiveStyle,
} from '../src/client/styles.ts'

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

  it('fills usage meters with the info token, never brand-primary', () => {
    expect(METER_FILL.normal).toContain('--dsw-alias-button-info-fill')
    expect(Object.values(METER_FILL).join(' ')).not.toContain('--dsw-alias-brand-primary')
  })

  it('answers a readable token for every tone, not just the warn and neutral ones', () => {
    expect(statusToneColor('success')).toContain('--dsw-alias-state-success-primary')
    expect(statusToneColor('error')).toContain('--dsw-alias-state-error-primary')
    expect(statusToneColor('info')).toContain('--dsw-alias-brand-primary')
  })

  it('tones a provider badge by sign-in state and greys it out when uninstalled', () => {
    expect(providerStatusTone('signed-in')).toBe('success')
    expect(providerStatusTone('error')).toBe('error')
    expect(providerStatusTone('signing-in')).toBe('info')
    expect(providerStatusTone('signed-out')).toBe('neutral')
    // An uninstalled provider is neutral whatever its sign-in state says.
    expect(providerStatusTone('error', false)).toBe('neutral')
  })

  it('gives every dot the colour its state earns, and a grey one when uninstalled', () => {
    expect(String(dotStyle('signed-in').background)).toContain('--dsw-alias-state-success-primary')
    expect(String(dotStyle('available').background)).toContain('--dsw-alias-state-success-primary')
    expect(String(dotStyle('error').background)).toContain('--dsw-alias-state-error-primary')
    expect(String(dotStyle('signing-in').background)).toContain('--dsw-alias-brand-primary')
    expect(String(dotStyle('loading').background)).toContain('--dsw-alias-brand-primary')
    expect(String(dotStyle('signed-out').background)).toContain('--dsw-alias-label-tertiary')
    expect(String(dotStyle('unavailable').background)).toContain('--dsw-alias-label-tertiary')
    // Not installed: no state colour can apply, so the dot stays tertiary.
    expect(String(dotStyle('signed-in', false).background)).toContain('--dsw-alias-label-tertiary')
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
