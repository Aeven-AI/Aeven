import { describe, expect, it } from 'vitest'
import { PROVIDERS } from '../src/client/constants.ts'
import { methodLabel, orderedLoginMethods, preferredLoginMethod } from '../src/client/display.ts'
import type { GrokBuildSettingsKey } from '../src/client/locales.ts'
import type { ProviderCardDefinition } from '../src/client/types.ts'

const t = (key: GrokBuildSettingsKey): string => key

describe('client display helpers', () => {
  it('leads with the browser flow locally and the device code on a remote host', () => {
    const grok = PROVIDERS.find(entry => entry.slug === 'grok')
    const codex = PROVIDERS.find(entry => entry.slug === 'codex')
    expect(grok).toBeDefined()
    expect(codex).toBeDefined()
    // Locally the browser flow reaches the harness's own callback and needs nothing.
    expect(orderedLoginMethods(grok!, false)).toEqual(['pkce', 'device'])
    expect(orderedLoginMethods(codex!, false)).toEqual(['browser', 'device'])
    // Remotely that callback lands on the wrong machine, so the device code leads.
    expect(preferredLoginMethod(grok!, true)).toBe('device')
    expect(orderedLoginMethods(codex!, true)[0]).toBe('device')
  })

  it('lists a card whose leading method it does not offer, rather than inventing a button', () => {
    // A definition whose recommendation drifted out of its own method list can
    // only be shown as it stands: there is no button to lead with.
    const drifted: ProviderCardDefinition = {
      ...PROVIDERS.find(entry => entry.slug === 'codex')!,
      methods: ['browser', 'device'],
      recommended: 'pkce',
    }

    expect(preferredLoginMethod(drifted, false)).toBe('pkce')
    expect(orderedLoginMethods(drifted, false)).toEqual(['browser', 'device'])
  })

  it('names each button by what it asks of you, wherever it sits', () => {
    // A browser flow completes by itself; the device flow hands you a code.
    expect(methodLabel('browser', t)).toBe('signIn')
    expect(methodLabel('pkce', t)).toBe('signIn')
    expect(methodLabel('device', t)).toBe('codeLogin')
  })
})
