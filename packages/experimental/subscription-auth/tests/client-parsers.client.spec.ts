import { describe, expect, it } from 'vitest'
import {
  mergeSources,
  parseCapabilities,
  parseGateway,
  parseGatewayPort,
  parseSources,
  safeDisplayPath,
} from '../src/client/parsers.ts'

describe('client parsers', () => {
  it('merges missing CLI sources with default paths', () => {
    const merged = mergeSources([])
    expect(merged).toHaveLength(3)
    expect(merged.every(entry => ! entry.available && entry.reason === 'missing')).toBe(true)
    expect(merged[0]?.displayPath).toBe('~/.grok/auth.json')
  })

  it('parses sources payloads and keeps available entries', () => {
    const parsed = parseSources({
      sources: [{ kind: 'codex', displayPath: '~/.codex/auth.json', available: true, expiresAt: 1_700_000_000 }],
    })
    expect(parsed.find(entry => entry.kind === 'codex')?.available).toBe(true)
    expect(parsed.find(entry => entry.kind === 'grok')?.reason).toBe('missing')
  })

  it('rejects secret-looking display paths', () => {
    expect(safeDisplayPath('sk-abcdefghijklmnopqrstuvwxyz', 'grok')).toBe('~/.grok/auth.json')
    expect(safeDisplayPath('~/.grok/auth.json', 'grok')).toBe('~/.grok/auth.json')
  })

  it('parses capability snapshots and gateway ports', () => {
    expect(parseCapabilities({ value: { codexSearch: true, searchResults: 7 }, revision: 3, writable: true })).toEqual(
      expect.objectContaining({
        revision: 3,
        writable: true,
        value: expect.objectContaining({ codexSearch: true, searchResults: 7 }),
      }),
    )
    expect(parseGatewayPort('18080')).toBe(18080)
    expect(parseGatewayPort('22')).toBeUndefined()
    expect(
      parseGateway({
        enabled: true,
        running: false,
        bind: '127.0.0.1',
        port: 18080,
        keyConfigured: true,
        keyHint: 'ab…',
        models: ['gpt-5.3-codex', 3],
      }),
    ).toEqual({
      enabled: true,
      running: false,
      bind: '127.0.0.1',
      port: 18080,
      model: 'gpt-5.3-codex',
      keyConfigured: true,
      keyAvailable: true,
      keyHint: 'ab…',
      models: ['gpt-5.3-codex'],
      warning: '',
    })
    expect(
      parseGateway({
        enabled: false,
        running: false,
        bind: '127.0.0.1',
        port: 18080,
        model: 'codex/gpt-5',
        keyAvailable: true,
        keyHint: 'dsh_…abcd',
      }),
    ).toEqual(expect.objectContaining({ models: ['codex/gpt-5'], keyConfigured: true }))
  })

})
