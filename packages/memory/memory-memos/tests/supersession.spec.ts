/**
 * Supersession: a correction records which earlier memory it replaced, and automatic recall leaves that
 * memory out while an explicit lookup still finds it.
 */
import { describe, expect, it } from 'vitest'
import { SUPERSEDED_TAG, withSupersededTag } from '../src/domain.ts'
import { memory, SCOPE, signal, type FakeTrace } from './harness.ts'

describe('withSupersededTag', () => {
  it('records the replacement alongside the tags the memory already carried', () => {
    expect(withSupersededTag(['domain:project', 'outcome:goal-completed'], 'tr_new'))
      .toEqual(['domain:project', 'outcome:goal-completed', `${SUPERSEDED_TAG}tr_new`])
  })

  it('holds one entry for a replacement recorded twice', () => {
    expect(withSupersededTag([`${SUPERSEDED_TAG}tr_new`], 'tr_new')).toEqual([`${SUPERSEDED_TAG}tr_new`])
  })

  it('keeps every replacement, so what replaced what stays readable', () => {
    expect(withSupersededTag([`${SUPERSEDED_TAG}tr_new`], 'tr_newer'))
      .toEqual([`${SUPERSEDED_TAG}tr_new`, `${SUPERSEDED_TAG}tr_newer`])
  })
})

describe('recall over a superseded memory', () => {
  // Experience memory carries no workspace, so the project filter cannot stand in for the check under test.
  const traces: readonly FakeTrace[] = [
    { refId: 'tr_old', tags: ['domain:experience', `${SUPERSEDED_TAG}tr_new`], ts: 1, summary: 'The deployment region is eu-west.' },
    { refId: 'tr_new', tags: ['domain:experience'], ts: 2, summary: 'The deployment region is us-east.' },
  ]

  it('leaves a superseded memory out of automatic recall', async () => {
    const recall = await memory(traces).recall({ scope: SCOPE, query: 'deployment region', purpose: 'turn-start', timeoutMs: 1000, signal } as never)
    expect(recall.hits.map(hit => hit.id)).toEqual(['tr_new'])
  })

  it('still returns a superseded memory to an explicit lookup, as history', async () => {
    const recall = await memory(traces).recall({ scope: SCOPE, query: 'deployment region', purpose: 'tool', timeoutMs: 1000, signal } as never)
    expect(recall.hits.map(hit => hit.id).sort()).toEqual(['tr_new', 'tr_old'])
  })

  it('carries each memory the time it was recorded, which recall orders and supersedes by', async () => {
    const recall = await memory(traces).recall({ scope: SCOPE, query: 'deployment region', purpose: 'tool', timeoutMs: 1000, signal } as never)
    expect(recall.hits.map(hit => hit.recordedAt).sort()).toEqual([1, 2])
  })
})
