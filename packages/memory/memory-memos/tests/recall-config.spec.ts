/**
 * The recall configuration the provider writes into MemOS. `rememberedFactTags` is what makes a remembered fact rank
 * like one: a fact the turn judgment filed under the person or a project carries its conversation's reward, which is
 * lowest exactly when the person had to correct the assistant.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@deepseek-ai/memos-local-plugin/core/config/index.js'
import { rank } from '@deepseek-ai/memos-local-plugin/core/retrieval/ranker.js'
import type { RetrievalConfig, TraceCandidate } from '@deepseek-ai/memos-local-plugin/core/retrieval/types.js'
import { Config } from '../src/index.ts'

const REQUIRED = { home: '/tmp/memos-home', accounts: '/tmp/memos-accounts' }

/**
 * Resolve a configuration the way the Loader does: the plugin's schema fills every field but `home` and `accounts`
 * from its own defaults. The schema declares its input as the resolved configuration, while at runtime it accepts the
 * authored shape, so the two required paths plus a spec's overrides are assembled as that input.
 * @param overrides - the fields a spec sets.
 * @returns the configuration the plugin would receive.
 */
function resolveConfig(overrides: Partial<Config> = {}): Config {
  return Config({ ...REQUIRED, ...overrides } as Config)
}

/** One trace as retrieval hands it to the ranker: no vectors, so its base score comes from the reward alone. */
function trace(refId: string, value: number, tags: readonly string[]): TraceCandidate {
  return {
    refId,
    tier: 'tier2',
    refKind: 'trace',
    cosine: 0.5,
    ts: Date.parse('2026-10-20T12:00:00.000Z'),
    vec: null,
    value,
    priority: 0,
    episodeId: 'episode-1',
    sessionId: 'session-1',
    vecKind: 'summary',
    userText: refId,
    agentText: '',
    summary: refId,
    reflection: null,
    tags: [...tags],
  }
}

/**
 * Rank two traces of one conversation whose only difference is the tag and the reward.
 * @param tags - trace tags that rank with at least `rememberedFactValue`.
 * @returns the ranked ids, best first.
 */
function ranked(tags: readonly string[]): string[] {
  const config: RetrievalConfig = {
    ...DEFAULT_CONFIG.algorithm.retrieval,
    rememberedFactValue: 0.5,
    rememberedFactTags: tags,
    decayHalfLifeDays: DEFAULT_CONFIG.algorithm.reward.decayHalfLifeDays,
  }
  const result = rank({
    tier1: [],
    tier2Traces: [trace('tr_fact', 0, ['domain:person']), trace('tr_talk', 0.4, [])],
    tier2Episodes: [],
    tier3: [],
    limit: 10,
    config,
    now: Date.parse('2026-10-21T12:00:00.000Z'),
  })
  return result.ranked.map(entry => entry.candidate.refId)
}

describe('recall configuration', () => {
  it('ranks a remembered fact filed under the person above a rewarded conversation', () => {
    expect(ranked(resolveConfig().rememberedFactTags)).toEqual(['tr_fact', 'tr_talk'])
  })

  it('ranks it by its own reward when the tags do not name its domain', () => {
    expect(ranked(['lightweight_memory'])).toEqual(['tr_talk', 'tr_fact'])
  })

  it('defaults to the tags a stored fact and a judged turn carry', () => {
    expect(resolveConfig()).toMatchObject({
      rememberedFactTags: ['lightweight_memory', 'domain:person', 'domain:project'],
      rememberedFactValue: 0.5,
      sentenceRetrievals: 3,
      sentenceHits: 8,
    })
  })

  it('refuses an empty tag and a sentence recall outside its bounds', () => {
    expect(() => resolveConfig({ rememberedFactTags: [''] })).toThrow()
    expect(() => resolveConfig({ sentenceRetrievals: 9 })).toThrow()
    expect(() => resolveConfig({ sentenceHits: 0 })).toThrow()
    expect(() => resolveConfig({ sentenceHits: 41 })).toThrow()
    expect(resolveConfig({ sentenceRetrievals: 0 }).sentenceRetrievals).toBe(0)
  })
})
