/**
 * Turn-start retrieval per sentence. A message that opens on one subject and asks about another sits closest, whole,
 * to memories of its first subject; each sentence gets its own retrieval beside the conversation query, and adds only
 * its top hits so the relevance judgment reads a bounded number of candidates.
 */
import { describe, expect, it } from 'vitest'
import { recallHarness, SCOPE, signal, type FakeTrace } from './harness.ts'

const MESSAGE = 'Training plan for the marathon? Also what is a good pasta recipe?'
const SENTENCES = ['Training plan for the marathon?', 'Also what is a good pasta recipe?']

function trace(refId: string): FakeTrace {
  return { refId, ts: 1, summary: `Memory ${refId}.` }
}

const whole = [trace('tr_whole_1'), trace('tr_whole_2'), trace('tr_whole_3')]
const firstSentence = [trace('tr_race_1'), trace('tr_race_2'), trace('tr_race_3')]
const secondSentence = [trace('tr_pasta_1'), trace('tr_whole_1')]

/** The core's answers: each sentence retrieves its own memories, the conversation query retrieves the rest. */
function find(query: string): readonly FakeTrace[] {
  if (query === SENTENCES[0]) return firstSentence
  if (query === SENTENCES[1]) return secondSentence
  return whole
}

function ids(hits: readonly { readonly id: string }[]): string[] {
  return hits.map(hit => hit.id)
}

function turnStart(options: { readonly request?: string; readonly sentenceRecall?: { sentences: number; hits: number } }) {
  const harness = recallHarness(whole, {
    find,
    ...options.sentenceRecall === undefined ? {} : { sentenceRecall: options.sentenceRecall },
  })
  const recall = harness.memory.recall({
    scope: SCOPE,
    query: MESSAGE,
    ...options.request === undefined ? {} : { request: options.request },
    purpose: 'turn-start',
    timeoutMs: 1000,
    signal,
  })
  return { queries: harness.queries, recall }
}

describe('turn-start retrieval per sentence', () => {
  it('adds at most each sentence\'s top hits after the conversation query\'s whole ranking', async () => {
    const { queries, recall } = turnStart({ request: MESSAGE, sentenceRecall: { sentences: 3, hits: 2 } })
    expect(ids((await recall).hits)).toEqual(['tr_whole_1', 'tr_whole_2', 'tr_whole_3', 'tr_race_1', 'tr_race_2', 'tr_pasta_1'])
    expect([...queries].sort()).toEqual([MESSAGE, SENTENCES[0], SENTENCES[1]].sort())
  })

  it('keeps a memory once when a sentence retrieves one the conversation query already ranked', async () => {
    const { recall } = turnStart({ request: MESSAGE, sentenceRecall: { sentences: 3, hits: 8 } })
    const hitIds = ids((await recall).hits)
    expect(hitIds.filter(id => id === 'tr_whole_1')).toHaveLength(1)
  })

  it('runs the conversation query alone for an explicit search', async () => {
    const harness = recallHarness(whole, { find, sentenceRecall: { sentences: 3, hits: 2 } })
    const recall = await harness.memory.recall({
      scope: SCOPE,
      query: MESSAGE,
      request: MESSAGE,
      purpose: 'tool',
      timeoutMs: 1000,
      signal,
    })
    expect(harness.queries).toEqual([MESSAGE])
    expect(ids(recall.hits)).toEqual(['tr_whole_1', 'tr_whole_2', 'tr_whole_3'])
  })

  it('runs the conversation query alone when sentence recall is not configured', async () => {
    const { queries, recall } = turnStart({ request: MESSAGE })
    expect((await recall).timedOut).toBe(false)
    expect(queries).toEqual([MESSAGE])
  })

  it('runs the conversation query alone for a one-sentence message', async () => {
    const { queries, recall } = turnStart({
      request: 'Training plan for the marathon next spring',
      sentenceRecall: { sentences: 3, hits: 2 },
    })
    expect((await recall).timedOut).toBe(false)
    expect(queries).toEqual([MESSAGE])
  })

  it('retrieves the leading sentences only, up to the configured count', async () => {
    const { queries, recall } = turnStart({ request: MESSAGE, sentenceRecall: { sentences: 1, hits: 8 } })
    expect(ids((await recall).hits)).toEqual(['tr_whole_1', 'tr_whole_2', 'tr_whole_3', 'tr_race_1', 'tr_race_2', 'tr_race_3'])
    expect([...queries].sort()).toEqual([MESSAGE, SENTENCES[0]].sort())
  })

  it('runs the conversation query alone when the request carries no message text', async () => {
    const { queries, recall } = turnStart({ sentenceRecall: { sentences: 3, hits: 2 } })
    expect((await recall).timedOut).toBe(false)
    expect(queries).toEqual([MESSAGE])
  })
})
