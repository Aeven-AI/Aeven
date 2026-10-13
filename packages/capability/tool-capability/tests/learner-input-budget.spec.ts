import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@aeven/llm'
import type { CompletedWork, WorkStep } from '../src/executions.ts'
import { CapabilityLearner, estimateDistillationTokens, MIN_INPUT_TOKENS, type LearnerConfig } from '../src/learner.ts'

/** A bound far above any transcript these cases build. */
const UNBOUNDED = 1_000_000

const CONFIG: LearnerConfig = {
  minSteps: 1,
  timeoutMs: 5_000,
  maxOutputTokens: 4_000,
  maxInputTokens: UNBOUNDED,
  store: 'capabilities',
}

/** One tool call whose output is long enough that dropping it pays for the omission line. */
function step(index: number): WorkStep {
  return { name: `step_${index}`, input: '{}', output: 'x'.repeat(300), failed: false, calledAt: 0 }
}

function work(steps: number, request = 'read the file and report what it contains'): CompletedWork {
  return {
    sessionId: 'session-1',
    turn: 1,
    request,
    answer: 'Reported the contents.',
    steps: Array.from({ length: steps }, (_unused, index) => step(index + 1)),
    startedAt: 0,
    endedAt: 1,
    endReason: 'completed',
    loaded: [],
  }
}

function reply(text: string): AsyncIterable<StreamChunk> {
  return (async function* generate(): AsyncGenerator<StreamChunk> {
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  })()
}

/** A context holding what the learner reads: the logger, the LLM service, and the registry. */
function context(sent: GenerateOptions[]): Context {
  return {
    logger: () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} }),
    llm: {
      stream: (options: GenerateOptions): AsyncIterable<StreamChunk> => {
        sent.push(options)
        return reply('{"decision":"skip"}')
      },
    },
    capabilities: {
      list: async () => [],
      get: async () => undefined,
    },
  } as unknown as Context
}

/** Run one learning call and return the transcript the model received. */
async function learn(turn: CompletedWork, maxInputTokens: number): Promise<string> {
  const sent: GenerateOptions[] = []
  const learner = new CapabilityLearner(context(sent), { ...CONFIG, maxInputTokens })
  learner.offer('owner-1', { provider: 'provider', model: 'model' }, turn)
  await learner.settle(turn.sessionId)
  expect(sent).toHaveLength(1)
  return sent[0]!.messages.flatMap(message => message.content.map(block => block.type === 'text' ? block.text : '')).join('')
}

describe('learner input budget', () => {
  it('sends a transcript below the budget unchanged', async () => {
    const transcript = await learn(work(6), UNBOUNDED)

    expect(transcript).toContain('1. step_1')
    expect(transcript).toContain('6. step_6')
    expect(transcript).not.toContain('older tool calls omitted')
    expect(transcript).not.toContain('transcript cut to the learning input budget')
    expect(estimateDistillationTokens(transcript)).toBeLessThan(UNBOUNDED)
  })

  it('sends a transcript exactly at the budget unchanged', async () => {
    const full = await learn(work(6), UNBOUNDED)
    const exact = estimateDistillationTokens(full)

    const transcript = await learn(work(6), exact)

    expect(transcript).toBe(full)
    expect(estimateDistillationTokens(transcript)).toBe(exact)
  })

  it('drops the oldest tool calls from a transcript over the budget', async () => {
    const full = await learn(work(6), UNBOUNDED)
    const budget = estimateDistillationTokens(full) - 1

    const transcript = await learn(work(6), budget)

    expect(transcript).not.toBe(full)
    expect(estimateDistillationTokens(transcript)).toBeLessThanOrEqual(budget)
    expect(transcript).not.toContain('1. step_1')
    expect(transcript).toContain('(1 older tool calls omitted to fit the learning input budget)')
    expect(transcript).toContain('6. step_6')
  })

  it('keeps the newest evidence when even the tool calls alone exceed the budget', async () => {
    const transcript = await learn(work(6, 'x'.repeat(20_000)), MIN_INPUT_TOKENS)

    expect(estimateDistillationTokens(transcript)).toBeLessThanOrEqual(MIN_INPUT_TOKENS)
    expect(transcript.startsWith('<request>')).toBe(true)
    expect(transcript.endsWith('…[transcript cut to the learning input budget]')).toBe(true)
    expect(transcript).not.toContain('6. step_6')
  })
})
