/**
 * The least MemOS core the recall path needs: a candidate list and a trace lookup, with the runtime over them.
 * Capture reaches further into MemOS and is out of scope for the recall specs that share this.
 */
import { LlmRouteContext } from '../src/host-llm.ts'
import { MemosMemory } from '../src/runtime.ts'

/** A trace as the fake core returns it; the fields the runtime reads for one recall. */
export interface FakeTrace {
  readonly refId: string
  readonly tags?: readonly string[]
  readonly ts: number
  /** The message the session captured, which the summarizer distils; `''` where a case does not need one. */
  readonly userText?: string
  readonly summary?: string
  readonly toolCalls?: readonly never[]
  readonly agentText?: string
}

/**
 * A core whose retrieval returns every given trace as a hit.
 * @param traces - the traces the runtime may recall.
 * @returns the two methods the recall path calls.
 */
export function fakeCore(traces: readonly FakeTrace[]) {
  return {
    searchMemory: async () => ({ hits: traces.map(trace => ({ refKind: 'trace', refId: trace.refId, tier: 2, score: 0.5, snippet: trace.summary ?? trace.refId })) }),
    getTrace: async (id: string) => {
      const trace = traces.find(entry => entry.refId === id)
      // An explicit lookup expands the trace, so the fields `traceSnippet` reads are always present.
      return trace === undefined ? null : { toolCalls: [], agentText: '', userText: '', ...trace }
    },
  }
}

/**
 * The runtime over a fake core.
 * @param traces - the traces the runtime may recall.
 * @returns the memory provider these specs exercise.
 */
export function memory(traces: readonly FakeTrace[]): MemosMemory {
  return new MemosMemory({
    core: fakeCore(traces) as never,
    routes: new LlmRouteContext(),
    toolLimits: { skills: 8, traces: 8, worldModels: 8 },
    warn: () => {},
    info: () => {},
  })
}

export const SCOPE = { owner: 'owner-1', sessionId: 'session-1', cwd: '/workspace' } as never
export const signal = new AbortController().signal
