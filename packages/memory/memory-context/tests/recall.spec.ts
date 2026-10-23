/**
 * The person's recent memories in a turn-start recall. A session's first turn always offers them, because recall
 * searches the turn's words; a later turn offers them only once the relevance judgment finds the person sharing their
 * life, so a work turn never pays for a scan of the person's own memories.
 */
import { describe, expect, it } from 'vitest'
import { brandString } from '@aeven/brand'
import type { MemoryHit, MemoryItemId, MemoryRecall } from '@aeven/memory'
import * as memoryContext from '@aeven/memory-context'
import { harness, resolveConfig, textOf } from './harness.ts'

const PERSON: MemoryHit = {
  kind: 'trace',
  id: brandString<MemoryItemId>('tr_person'),
  domain: 'person',
  tier: 2,
  score: 1,
  snippet: 'Their mother is in hospital in Delft.',
}

const PERSONAL: MemoryRecall = { hits: [PERSON], timedOut: false, lead: 'person', sharing: true }

describe('the person\'s recent memories in a turn-start recall', () => {
  it('asks for a week of them by default', () => {
    expect(memoryContext.Config().recentPersonHours).toBe(168)
    expect(memoryContext.Config().recentPersonItems).toBe(24)
    expect(resolveConfig({ recentPersonHours: 0 }).recentPersonItems).toBe(24)
  })

  it('offers them on a session\'s first turn, without waiting for the judgment', async () => {
    const { provider, step } = await harness()
    await step(1)
    expect(provider.requests[0]?.recent).toEqual({ hours: 168, items: 24, perSession: 3, sharingOnly: false })
  })

  it('offers them on a later turn only when the judgment finds the person sharing', async () => {
    const { provider, step } = await harness()
    await step(2)
    expect(provider.requests[0]?.recent).toEqual({ hours: 168, items: 24, perSession: 3, sharingOnly: true })
  })

  it('sends no recent-memory request when the window is turned off', async () => {
    const { provider, step } = await harness({ recentPersonHours: 0 })
    await step(1)
    await step(2)
    expect(provider.requests.map(request => request.recent)).toEqual([undefined, undefined])
  })

  it('sends no recent-memory request when the item count is turned off', async () => {
    const { provider, step } = await harness({ recentPersonItems: 0 })
    await step(1)
    await step(2)
    expect(provider.requests.map(request => request.recent)).toEqual([undefined, undefined])
  })
})

describe('the guidance of a personal turn', () => {
  it('delivers the personal note when the recall reports the person sharing', async () => {
    const { provider, step } = await harness()
    provider.answer(PERSONAL)
    const added = await step(2)
    expect(added.map(textOf)).toContain(memoryContext.PERSONAL_NOTE)
    expect(added.map(textOf).join('\n')).toContain('About the user and people they mention:')
  })

  it('delivers no personal note when the recall does not report sharing', async () => {
    const { provider, step } = await harness()
    provider.answer({ hits: [PERSON], timedOut: false, lead: 'task', sharing: false })
    const added = await step(2)
    expect(added.map(textOf)).not.toContain(memoryContext.PERSONAL_NOTE)
    expect(added.map(textOf).join('\n')).toContain('About the user and people they mention:')
  })

  it('delivers no personal note when the recall states no sharing at all', async () => {
    const { provider, step } = await harness()
    provider.answer({ hits: [PERSON], timedOut: false })
    const added = await step(2)
    expect(added.map(textOf)).not.toContain(memoryContext.PERSONAL_NOTE)
  })
})
