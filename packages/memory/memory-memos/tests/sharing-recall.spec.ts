/**
 * Recall of the person's recent memories on a turn that is not a session's first. The first relevance judgment runs
 * without them, so a work turn never pays for a scan of the person's life; when that judgment reports the person
 * sharing it, a second judgment runs with them and replaces the first unless it is degraded.
 */
import { describe, expect, it } from 'vitest'
import { MemoryDeadlineError } from '../src/deadline.ts'
import { recallHarness, SCOPE, signal, type FakeCoreOptions, type FakeTrace } from './harness.ts'

const REQUEST = 'I am exhausted today'

const work: FakeTrace = { refId: 'tr_work', ts: 1, summary: 'Release checklist for the next build.' }
const person: FakeTrace = {
  refId: 'tr_person',
  ts: Date.now(),
  sessionId: 'session-2',
  tags: ['domain:person'],
  userText: '',
  summary: 'Their mother is in hospital in Delft.',
}

const RECENT = { hours: 168, items: 24, perSession: 3 }

/**
 * Turn-start recall whose relevance judgment answers `answers` in call order, remembering each judgment's message.
 * @param answers - the judgment's JSON answers, one per call; the last one repeats.
 * @param options - the recent-memory scan and any runtime option a case varies.
 * @returns the recall of one later turn, its provider, and the judgment messages.
 */
function sharingTurn(answers: readonly string[], options: FakeCoreOptions = {}) {
  const judged: string[] = []
  const harness = recallHarness([work], {
    recent: [person],
    ...options,
    relevance: {
      timeoutMs: 4000,
      run: async (_system, user) => {
        judged.push(user)
        return answers[Math.min(judged.length - 1, answers.length - 1)] ?? ''
      },
    },
  })
  const recall = harness.memory.recall({
    scope: SCOPE,
    query: REQUEST,
    request: REQUEST,
    purpose: 'turn-start',
    timeoutMs: 5000,
    signal,
    recent: { ...RECENT, sharingOnly: true },
  })
  return { ...harness, judged, recall }
}

const SHARED = '{"lead":"person","sharing":true,"keep":[1]}'
const WORK_ONLY = '{"lead":"task","sharing":false,"keep":[1]}'

describe('recall of the person\'s recent memories on a later turn', () => {
  it('judges the turn without the person\'s recent memories first', async () => {
    const { judged, recall } = sharingTurn([WORK_ONLY])
    expect((await recall).hits.map(hit => hit.id)).toEqual(['tr_work'])
    expect(judged).toHaveLength(1)
    expect(judged[0]).not.toContain('in hospital in Delft')
  })

  it('judges again with them when the first judgment finds the person sharing, and replaces it', async () => {
    const { judged, recall } = sharingTurn([SHARED, '{"lead":"person","sharing":true,"keep":[2]}'])
    const result = await recall
    expect(judged).toHaveLength(2)
    expect(judged[1]).toContain('in hospital in Delft')
    expect(result.hits.map(hit => hit.id)).toEqual(['tr_person'])
    expect(result.sharing).toBe(true)
    expect(result.lead).toBe('person')
  })

  it('keeps the first judgment when the second one is degraded', async () => {
    const { judged, recall } = sharingTurn([SHARED, 'not a judgment'])
    const result = await recall
    expect(judged).toHaveLength(2)
    expect(result.hits.map(hit => hit.id)).toEqual(['tr_work'])
    expect(result.degraded).toBeUndefined()
    expect(result.sharing).toBe(true)
  })

  it('keeps the first judgment when the person has no recent memory to offer', async () => {
    const { judged, recall } = sharingTurn([SHARED], { recent: [] })
    const result = await recall
    expect(judged).toHaveLength(1)
    expect(result.hits.map(hit => hit.id)).toEqual(['tr_work'])
  })

  it('keeps the first judgment when the deadline elapses during the scan', async () => {
    const { judged, recall } = sharingTurn([SHARED], {
      listTraces: () => Promise.reject(new MemoryDeadlineError('Memory recall exceeded 5000ms')),
    })
    const result = await recall
    expect(judged).toHaveLength(1)
    expect(result.hits.map(hit => hit.id)).toEqual(['tr_work'])
    expect(result.timedOut).toBe(false)
  })

  it('offers them in the first judgment on a session\'s first turn', async () => {
    const judged: string[] = []
    const harness = recallHarness([work], {
      recent: [person],
      relevance: {
        timeoutMs: 4000,
        run: async (_system, user) => {
          judged.push(user)
          return '{"lead":"person","sharing":true,"keep":[2]}'
        },
      },
    })
    const result = await harness.memory.recall({
      scope: SCOPE,
      query: REQUEST,
      request: REQUEST,
      purpose: 'turn-start',
      timeoutMs: 5000,
      signal,
      recent: { ...RECENT, sharingOnly: false },
    })
    expect(judged).toHaveLength(1)
    expect(judged[0]).toContain('in hospital in Delft')
    expect(result.hits.map(hit => hit.id)).toEqual(['tr_person'])
  })
})
