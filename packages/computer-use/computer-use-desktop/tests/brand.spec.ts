/**
 * The adapter-name brand.
 *
 * Branding exists so an adapter identity cannot be confused with any other string,
 * and the runtime half of that is deliberately a pass-through: it must return the
 * caller's name unchanged. A brand that trimmed, normalised or validated would
 * silently alter the identity a provider registered under, which is the one thing
 * this function must never do.
 */

import { describe, expect, it } from 'vitest'
import { DesktopAdapterName } from '../src/brand.ts'

describe('DesktopAdapterName', () => {
  it('returns the caller name unchanged', () => {
    expect(DesktopAdapterName('macos-first-party')).toBe('macos-first-party')
  })

  it('does not normalise case, spacing or surrounding whitespace', () => {
    // A brand is a claim about identity, not a formatter. Anything that rewrote the
    // value here would make the registered name differ from the declared one.
    expect(DesktopAdapterName('  Mixed Case  ')).toBe('  Mixed Case  ')
    expect(DesktopAdapterName('')).toBe('')
  })
})
