/**
 * What one recalled trace reads as. Automatic recall states the distilled summary, because it is injected on
 * every turn; an explicit search returns the trace whole, so a fact the distillation dropped is still reachable
 * from the turn that needs it.
 */
import { describe, expect, it } from 'vitest'
import { memory, SCOPE, signal, type FakeTrace } from './harness.ts'

// The summary keeps the channel and drops the salt: the case a probe hit, where the searched-for value existed
// in the captured message and nowhere the agent could reach.
const NOTE = ['Project notes for this workspace.', '- The deployment release channel is "zeta-7".', '- The release checksum salt is "salt-9".'].join('\n')
const traces: readonly FakeTrace[] = [
  { refId: 'tr_notes', ts: 1, summary: 'Workspace notes: release channel zeta-7.', userText: NOTE, agentText: 'Acknowledged.' },
]

async function recallOf(at: readonly FakeTrace[], purpose: 'tool' | 'turn-start') {
  const recall = await memory(at).recall({ scope: SCOPE, query: 'release checksum salt', purpose, timeoutMs: 1000, signal })
  return recall.hits[0]?.snippet
}

describe('an explicit memory search', () => {
  it('returns the captured message, so a fact the summary dropped stays reachable', async () => {
    expect(await recallOf(traces, 'tool')).toContain('salt-9')
  })

  it('returns the captured message for a person memory, which automatic recall states as a summary', async () => {
    const person: readonly FakeTrace[] = [
      { refId: 'tr_person', tags: ['domain:person'], ts: 1, summary: 'User works on Aeven.', userText: 'I work on Aeven and prefer answer-first replies.' },
    ]
    expect(await recallOf(person, 'tool')).toContain('answer-first')
  })

  it('names the captured message, so a reader can tell it from the summary above it', async () => {
    expect(await recallOf(traces, 'tool')).toContain(`User message: ${NOTE}`)
  })
})

describe('automatic recall', () => {
  it('states only the distilled summary, because it is injected on every turn', async () => {
    expect(await recallOf(traces, 'turn-start')).toBe('Workspace notes: release channel zeta-7.')
  })
})
