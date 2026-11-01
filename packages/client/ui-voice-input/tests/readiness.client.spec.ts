// @vitest-environment jsdom
/** The readiness mirror reopens its stream instead of leaving the composer unable to record. */
import { afterEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { RemoteStream } from '@aeven/api-gateway/client'
import type { SpeechCatalog } from '@aeven/api-speech-to-text/types'
import { observeReadiness } from '../src/client/readiness.ts'

const catalog: SpeechCatalog = {
  providers: [{ id: 'whisper-local', name: 'Whisper small', location: 'host-local', languages: ['auto'],
    downloadSources: [], setupEstimate: { recommendedDiskBytes: 1, expectedMemoryBytes: 1, minimumMinutes: 1, maximumMinutes: 1 },
    preparation: { phase: 'standby', steps: [] } }],
  selection: { providerId: 'whisper-local', language: 'auto' },
  maxAudioBytes: 1,
  maxDurationSeconds: 1,
} as unknown as SpeechCatalog

/** A connection with no live generation, so `RemoteStream` never waits on carrier retries here. */
const connection = { generation: { getSnapshot: (): undefined => undefined, subscribe: (): (() => void) => () => {} } }

/**
 * Build a Context whose speech Remote answers each follow with the next scripted generation.
 * @param script - one entry per follow call: the items it yields, then whether it holds the stream open.
 * @returns the fake Context, the follow count, and the registered lifecycle listeners.
 */
function harness(script: Array<{ hold: boolean }>) {
  const listeners = new Map<string, Array<() => void>>()
  const follows = { count: 0 }
  const ctx = {
    remote: {
      $stream: <Item>(options: ConstructorParameters<typeof RemoteStream>[1]) => new RemoteStream<Item>(connection as never, options),
      speech: {
        follow: async function* (signal: AbortSignal) {
          const step = script[follows.count++] ?? { hold: true }
          yield catalog
          if (!step.hold) return
          await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
        },
      },
    },
    on: (event: string, listener: () => void) => {
      listeners.set(event, [...listeners.get(event) ?? [], listener])
      return () => { listeners.set(event, (listeners.get(event) ?? []).filter(item => item !== listener)) }
    },
  } as unknown as Context
  return { ctx, follows, listeners }
}

afterEach(() => { vi.useRealTimers() })

it('reopens a stream the Host ended instead of leaving the mic unusable', async () => {
  vi.useFakeTimers()
  const { ctx, follows } = harness([{ hold: false }])
  const readiness = observeReadiness(ctx)
  await vi.advanceTimersByTimeAsync(0)
  // The ended generation is not a usable observation, but the catalogue it delivered stays published.
  expect(readiness.state.getSnapshot().connected).toBe(false)
  expect(readiness.state.getSnapshot().catalog).toEqual(catalog)
  await vi.advanceTimersByTimeAsync(2_000)
  expect(follows.count).toBe(2)
  expect(readiness.state.getSnapshot().connected).toBe(true)
  await readiness.dispose()
})

it('restarts the live generation when the carrier reports a fresh Host', async () => {
  vi.useFakeTimers()
  const { ctx, follows, listeners } = harness([{ hold: true }])
  const readiness = observeReadiness(ctx)
  await vi.advanceTimersByTimeAsync(0)
  expect(follows.count).toBe(1)
  for (const listener of listeners.get('connection/reset') ?? []) listener()
  await vi.advanceTimersByTimeAsync(0)
  expect(follows.count).toBe(2)
  await readiness.dispose()
})

it('stops reopening after disposal', async () => {
  vi.useFakeTimers()
  const { ctx, follows } = harness([{ hold: false }])
  const readiness = observeReadiness(ctx)
  await vi.advanceTimersByTimeAsync(0)
  await readiness.dispose()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(follows.count).toBe(1)
})
