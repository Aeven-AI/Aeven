/**
 * Recall ordering and supersession: a block must not assert a value beside the value that replaced it.
 */
import { describe, expect, it } from 'vitest'
import type { MemoryHit } from '@aeven/memory'
import { rankMemoryHits } from '../src/index.ts'

/** One provider hit; only the fields a case cares about have to be given. */
function hit(snippet: string, extra: Partial<MemoryHit> = {}): MemoryHit {
  return {
    kind: 'trace',
    id: 'tr_case' as MemoryHit['id'],
    domain: 'project',
    tier: 2,
    score: 0.5,
    snippet,
    ...extra,
  }
}

const OLD = 1_700_000_000_000
const NEW = OLD + 86_400_000

describe('rankMemoryHits supersession', () => {
  it('retires the earlier statement when a later one describes the same subject', () => {
    const ranked = rankMemoryHits('what is the deployment region', [
      hit('The deployment region is eu-west.', { recordedAt: OLD }),
      hit('The deployment region is us-east.', { recordedAt: NEW }),
    ], 0.6)
    expect(ranked.map(entry => entry.snippet)).toEqual(['The deployment region is us-east.'])
  })

  it('keeps both statements when they are about different subjects', () => {
    const ranked = rankMemoryHits('anything', [
      hit('The sidebar Chrome runs on port 9333.', { recordedAt: OLD }),
      hit('User prefers answer-first replies.', { recordedAt: NEW }),
    ], 0.6)
    expect(ranked).toHaveLength(2)
  })

  it('keeps both statements when either recorded time is unknown, because no order can be preferred', () => {
    const ranked = rankMemoryHits('what is the deployment region', [
      hit('The deployment region is eu-west.', { recordedAt: OLD }),
      hit('The deployment region is us-east.'),
    ], 0.6)
    expect(ranked).toHaveLength(2)
  })

  it('leaves an earlier statement alone when it is the newer one that is missing', () => {
    const ranked = rankMemoryHits('what is the deployment region', [
      hit('The deployment region is us-east.', { recordedAt: NEW }),
      hit('The deployment region is eu-west.', { recordedAt: OLD }),
    ], 0.6)
    expect(ranked.map(entry => entry.snippet)).toEqual(['The deployment region is us-east.'])
  })

  it('splits a single-era pair by domain, because supersession never crosses one', () => {
    const ranked = rankMemoryHits('what is the deployment region', [
      hit('The deployment region is eu-west.', { recordedAt: OLD, domain: 'project' }),
      hit('The deployment region is us-east.', { recordedAt: NEW, domain: 'world' }),
    ], 0.6)
    expect(ranked).toHaveLength(2)
  })

  it('holds a statement whose word set is only identical at the strictest overlap', () => {
    const ranked = rankMemoryHits('what is the deployment region', [
      hit('The deployment region is eu-west and stable.', { recordedAt: OLD }),
      hit('The deployment region is eu-west, confirmed again.', { recordedAt: NEW }),
    ], 1)
    expect(ranked).toHaveLength(2)
  })
})

describe('rankMemoryHits ordering', () => {
  it('prefers the newer memory when relevance and score are equal', () => {
    const ranked = rankMemoryHits('deployment', [
      hit('An older note about deployment.', { recordedAt: OLD, id: 'tr_old' as MemoryHit['id'] }),
      hit('A newer note about deployment.', { recordedAt: NEW, id: 'tr_new' as MemoryHit['id'] }),
    ], 0.6)
    expect(ranked[0]?.id).toBe('tr_new')
  })

  it('still drops an exact duplicate within a domain', () => {
    const ranked = rankMemoryHits('deployment', [
      hit('The deployment region is eu-west.', { recordedAt: OLD }),
      hit('The deployment region is eu-west.', { recordedAt: NEW }),
    ], 0.6)
    expect(ranked).toHaveLength(1)
  })
})
