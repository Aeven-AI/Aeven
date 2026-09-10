import { describe, expect, it } from 'vitest'
import { PROVIDERS } from '../src/client/constants.ts'
import {
  allOfficialCliMissing,
  anyOfficialCliAvailable,
  isLikelyRemoteHost,
  methodLabel,
  orderedLoginMethods,
  preferredLoginMethod,
  shouldShowPerCardSourceReason,
} from '../src/client/display.ts'
import type { GrokBuildSettingsKey } from '../src/client/locales.ts'
import type { SourceStatus } from '../src/client/types.ts'

const t = (key: GrokBuildSettingsKey): string => key

describe('client display helpers', () => {
  it('detects remote hosts', () => {
    expect(isLikelyRemoteHost('127.0.0.1')).toBe(false)
    expect(isLikelyRemoteHost('localhost')).toBe(false)
    expect(isLikelyRemoteHost('example.localhost')).toBe(false)
    expect(isLikelyRemoteHost('dsh.example.com')).toBe(true)
  })

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

  it('names each button by what it asks of you, wherever it sits', () => {
    // A browser flow completes by itself; the device flow hands you a code.
    expect(methodLabel('browser', t)).toBe('signIn')
    expect(methodLabel('pkce', t)).toBe('signIn')
    expect(methodLabel('device', t)).toBe('codeLogin')
  })

  it('hides per-card missing reasons while keeping actionable ones', () => {
    const missing: SourceStatus = {
      kind: 'grok',
      displayPath: '~/.grok/auth.json',
      available: false,
      reason: 'missing',
    }
    const unsafe: SourceStatus = { kind: 'grok', displayPath: '~/.grok/auth.json', available: false, reason: 'unsafe' }
    expect(shouldShowPerCardSourceReason(missing)).toBe(false)
    expect(shouldShowPerCardSourceReason(unsafe)).toBe(true)
    expect(shouldShowPerCardSourceReason(undefined)).toBe(false)
  })

  it('summarizes official CLI discovery without treating missing as an error', () => {
    const sources: SourceStatus[] = [
      { kind: 'grok', displayPath: '~/.grok/auth.json', available: false, reason: 'missing' },
      { kind: 'codex', displayPath: '~/.codex/auth.json', available: false, reason: 'missing' },
      { kind: 'claude', displayPath: '~/.claude/.credentials.json', available: false, reason: 'missing' },
    ]
    expect(allOfficialCliMissing(sources)).toBe(true)
    expect(anyOfficialCliAvailable(sources)).toBe(false)
    expect(anyOfficialCliAvailable([{ ...sources[0]!, available: true }])).toBe(true)
  })
})
