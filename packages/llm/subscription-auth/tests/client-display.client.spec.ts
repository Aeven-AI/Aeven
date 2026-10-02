import { describe, expect, it } from 'vitest'
import { PROVIDERS } from '../src/client/constants.ts'
import { signInMethod } from '../src/client/display.ts'

describe('client display helpers', () => {
  it('lists Grok before Codex', () => {
    expect(PROVIDERS.map(entry => entry.slug)).toEqual(['grok', 'codex'])
  })

  it('signs in through the browser locally and with a device code from another machine', () => {
    const [grok, codex] = PROVIDERS
    // Locally the browser flow reaches the harness's own callback and needs nothing.
    expect(signInMethod(grok!, false)).toBe('pkce')
    expect(signInMethod(codex!, false)).toBe('browser')
    // Remotely that callback lands on the wrong machine, so the device code is used.
    expect(signInMethod(grok!, true)).toBe('device')
    expect(signInMethod(codex!, true)).toBe('device')
  })
})
