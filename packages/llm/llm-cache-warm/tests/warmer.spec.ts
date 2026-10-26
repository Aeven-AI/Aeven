/**
 * What the warmer does with a captured request: nothing without a configured
 * provider, an excluded tool, attachments, or a prefix under the floor; one
 * logged warm per interval inside a tool block, bounded by the ping, budget,
 * and dry-run settings; and no warm at all once the block ends.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createUserMessage } from '@aeven/llm'
import type { GenerateOptions, StreamChunk, TokenUsage } from '@aeven/llm'
import { SessionId } from '@aeven/session'
import type { Session } from '@aeven/session'
import { CacheWarmer } from '@aeven/llm-cache-warm'
import type { WarmerSettings } from '@aeven/llm-cache-warm'

const USAGE: TokenUsage = { inputTokens: 0, outputTokens: 1, cacheReadTokens: 900, cacheWriteTokens: 0 }

/** A stream that reports cache-hit usage and finishes, honouring the request's signal. */
async function* warmStream(options: GenerateOptions): AsyncIterable<StreamChunk> {
  options.signal?.throwIfAborted()
  yield { type: 'usage', usage: USAGE }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** A long conversation request the warmer may replay. */
function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: 'deepseek',
    model: 'deepseek-chat',
    sessionId: SessionId('session-1'),
    system: 'x'.repeat(20000),
    messages: [createUserMessage({ content: [{ type: 'text', text: 'start the build' }], source: { kind: 'user' } })],
    ...overrides,
  } as GenerateOptions
}

/** One appended log event, as the fake session recorded it. */
interface Recorded {
  readonly type: string
  readonly data: Record<string, unknown>
}

/** A session that records appends and reports an id. */
function fakeSession(recorded: Recorded[], id = 'session-1'): Session {
  return {
    id,
    append: (type: string, data: Record<string, unknown>) => {
      recorded.push({ type, data })
      return { type, data }
    },
  } as unknown as Session
}

/** Settings over one configured provider. */
function settings(overrides: Partial<WarmerSettings> = {}): WarmerSettings {
  return {
    dryRun: false,
    providers: { deepseek: { intervalMs: 1000 } },
    excludeTools: ['ask_user_question'],
    minPrefixChars: 12000,
    maxConcurrentPings: 2,
    dailyPingBudget: 10,
    pingTimeoutMs: 5000,
    maxPings: 2,
    ...overrides,
  }
}

/** One mounted warmer with its recorded log, dispatched requests, and warnings. */
function mount(config: Partial<WarmerSettings> = {}) {
  const recorded: Recorded[] = []
  const dispatched: GenerateOptions[] = []
  const warnings: string[] = []
  const warmer = new CacheWarmer({
    stream: (options) => {
      dispatched.push(options)
      return warmStream(options)
    },
    now: () => Date.now(),
    warn: (message) => { warnings.push(message) },
  }, settings(config))
  return { warmer, recorded, dispatched, warnings, session: fakeSession(recorded) }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('whether a request is warmed at all', () => {
  it('warns for a configured provider inside a tool block', async () => {
    const { warmer, recorded, dispatched, session } = mount()
    const controller = new AbortController()
    warmer.capture(request())
    warmer.beginBlock(session, 'bash', controller.signal)
    await vi.advanceTimersByTimeAsync(1000)
    expect(dispatched).toHaveLength(1)
    expect(recorded.map(event => event.type)).toEqual(['cache-warm/start', 'cache-warm/result'])
    expect(recorded[1]?.data['usage']).toEqual(USAGE)
    warmer.dispose()
  })

  it('replays the captured request with a one-token cap and no session id', async () => {
    const { warmer, dispatched, session } = mount()
    const captured = request()
    warmer.capture(captured)
    warmer.beginBlock(session, 'bash', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(1000)
    expect(dispatched[0]?.maxTokens).toBe(1)
    expect(dispatched[0]?.sessionId).toBeUndefined()
    expect(dispatched[0]?.messages).toEqual(captured.messages)
    expect(dispatched[0]?.system).toBe(captured.system)
    warmer.dispose()
  })

  it('ignores a provider with no interval entry', async () => {
    const { warmer, dispatched, session } = mount()
    warmer.capture(request({ provider: 'openrouter' }))
    warmer.beginBlock(session, 'bash', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(5000)
    expect(dispatched).toHaveLength(0)
    warmer.dispose()
  })

  it('ignores an auxiliary call', async () => {
    const { warmer, dispatched, session } = mount()
    warmer.capture(request({ purpose: 'compaction' }))
    warmer.beginBlock(session, 'bash', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(5000)
    expect(dispatched).toHaveLength(0)
    warmer.dispose()
  })

  it('ignores a request carrying an attachment', async () => {
    const { warmer, dispatched, session } = mount()
    warmer.capture(request({
      messages: [createUserMessage({ content: [{ type: 'file', id: 'f1' } as never], source: { kind: 'user' } })],
    }))
    warmer.beginBlock(session, 'bash', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(5000)
    expect(dispatched).toHaveLength(0)
    warmer.dispose()
  })

  it('ignores a prefix below the floor', async () => {
    const { warmer, dispatched, session } = mount({ minPrefixChars: 100000 })
    warmer.capture(request())
    warmer.beginBlock(session, 'bash', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(5000)
    expect(dispatched).toHaveLength(0)
    warmer.dispose()
  })

  it('ignores an excluded tool', async () => {
    const { warmer, dispatched, session } = mount()
    warmer.capture(request())
    warmer.beginBlock(session, 'ask_user_question', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(5000)
    expect(dispatched).toHaveLength(0)
    warmer.dispose()
  })
})

describe('bounds on one tool block', () => {
  it('stops at the ping cap', async () => {
    const { warmer, dispatched, session } = mount()
    warmer.capture(request())
    warmer.beginBlock(session, 'bash', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(10000)
    expect(dispatched).toHaveLength(2)
    warmer.dispose()
  })

  it('drops a pending warm when the block ends', async () => {
    const { warmer, dispatched, session } = mount()
    warmer.capture(request())
    warmer.beginBlock(session, 'bash', new AbortController().signal)
    warmer.endBlock(session)
    await vi.advanceTimersByTimeAsync(5000)
    expect(dispatched).toHaveLength(0)
    warmer.dispose()
  })

  it('keeps one window while a composite runs its sub-calls', async () => {
    const { warmer, dispatched, session } = mount()
    warmer.capture(request())
    const controller = new AbortController()
    warmer.beginBlock(session, 'run_code', controller.signal)
    warmer.beginBlock(session, 'bash', controller.signal)
    warmer.endBlock(session)
    await vi.advanceTimersByTimeAsync(1000)
    expect(dispatched).toHaveLength(1)
    warmer.dispose()
  })

  it('reports a warm the provider answered with a failure', async () => {
    const recorded: Recorded[] = []
    const warnings: string[] = []
    const warmer = new CacheWarmer({
      stream: async function* () { throw new Error('429 rate limited') } as unknown as (options: GenerateOptions) => AsyncIterable<StreamChunk>,
      now: () => Date.now(),
      warn: (message) => { warnings.push(message) },
    }, settings())
    const session = fakeSession(recorded)
    warmer.capture(request())
    warmer.beginBlock(session, 'bash', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(1000)
    expect(recorded[1]?.data['error']).toBe('429 rate limited')
    expect(warnings).toHaveLength(1)
    warmer.dispose()
  })
})

describe('setting-driven behaviour', () => {
  it('journals a dry run without dispatching', async () => {
    const { warmer, recorded, dispatched, session } = mount({ dryRun: true })
    warmer.capture(request())
    warmer.beginBlock(session, 'bash', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(1000)
    expect(dispatched).toHaveLength(0)
    expect(recorded.map(event => event.type)).toEqual(['cache-warm/start'])
    warmer.dispose()
  })

  it('stops when the daily budget is spent', async () => {
    const { warmer, dispatched, session } = mount({ maxPings: 5, dailyPingBudget: 1 })
    warmer.capture(request())
    warmer.beginBlock(session, 'bash', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(10000)
    expect(dispatched).toHaveLength(1)
    warmer.dispose()
  })

  it('waits for a free slot instead of exceeding the concurrency cap', async () => {
    const dispatched: GenerateOptions[] = []
    let release: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const warmer = new CacheWarmer({
      stream: async function* (options: GenerateOptions) {
        dispatched.push(options)
        await blocked
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
      now: () => Date.now(),
      warn: () => {},
    }, settings({ maxConcurrentPings: 1, maxPings: 3, providers: { deepseek: { intervalMs: 1000 } } }))
    const session = fakeSession([])
    warmer.capture(request())
    warmer.beginBlock(session, 'bash', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(dispatched).toHaveLength(1)
    release?.()
    await vi.advanceTimersByTimeAsync(1000)
    expect(dispatched).toHaveLength(2)
    warmer.dispose()
  })
})
