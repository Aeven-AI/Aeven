/**
 * The least MemOS core the recall path needs: a candidate list, a trace lookup, and the recent-memory scan, with
 * the runtime over them. Capture reaches further into MemOS and is out of scope for the recall specs that share this.
 */
import { OwnerCores } from '../src/cores.ts'
import { LlmRouteContext } from '../src/host-llm.ts'
import { MemosMemory } from '../src/runtime.ts'
import type { MemosMemoryOptions } from '../src/runtime.ts'

/** A trace as the fake core returns it; the fields the runtime reads for one recall. */
export interface FakeTrace {
  readonly refId: string
  /** Trace id as `listTraces` reports it; retrieval hits and trace lookups use {@link FakeTrace.refId}. */
  readonly id?: string
  readonly tags?: readonly string[]
  readonly ts: number
  /** Conversation the trace was captured in; the recent-memory scan leaves out the recalling session's own. */
  readonly sessionId?: string
  /** The message the session captured, which the summarizer distils; `''` where a case does not need one. */
  readonly userText?: string
  readonly summary?: string
  readonly toolCalls?: readonly never[]
  readonly agentText?: string
}

/** What a recall spec controls about the fake core beside the traces it may recall. */
export interface FakeCoreOptions {
  /** Traces one retrieval returns for its query; defaults to every trace. */
  readonly find?: (query: string) => readonly FakeTrace[]
  /** Person traces the recent-memory scan lists, newest first. */
  readonly recent?: readonly FakeTrace[]
  /** Replaces the scan's listing, for a case where the scan itself fails. */
  readonly listTraces?: () => Promise<readonly FakeTrace[]>
  /** Every retrieval query the core was asked for, in call order. */
  readonly queries?: string[]
}

/**
 * A core whose retrieval returns the traces the options pick for a query.
 * @param traces - the traces the runtime may recall.
 * @param options - per-query results, the recent-memory listing, and the query log.
 * @returns the three methods the recall path calls.
 */
export function fakeCore(traces: readonly FakeTrace[], options: FakeCoreOptions = {}) {
  return {
    searchMemory: async (request: { query: string }) => {
      options.queries?.push(request.query)
      const found = options.find?.(request.query) ?? traces
      return { hits: found.map(trace => ({ refKind: 'trace', refId: trace.refId, tier: 2, score: 0.5, snippet: trace.summary ?? trace.refId })) }
    },
    getTrace: async (id: string) => {
      const trace = traces.find(entry => entry.refId === id)
      // An explicit lookup expands the trace, so the fields `traceSnippet` reads are always present.
      return trace === undefined ? null : { toolCalls: [], agentText: '', userText: '', ...trace }
    },
    listTraces: async (): Promise<readonly FakeTrace[]> =>
      (options.listTraces === undefined ? options.recent ?? [] : await options.listTraces())
        .map(trace => ({ ...trace, id: trace.refId })),
  }
}

/** Runtime options a recall spec supplies beside the fake core's answers. */
type RuntimeOptions = Pick<MemosMemoryOptions, 'relevance' | 'sentenceRecall'>

/** A runtime over the fake core, with the retrieval queries it sent. */
export interface RecallHarness {
  readonly memory: MemosMemory
  /** Every retrieval query the core received, in call order. */
  readonly queries: string[]
}

/**
 * The runtime over a fake core, with the retrieval queries it sent.
 * @param traces - the traces the runtime may recall.
 * @param options - per-query results, the recent-memory listing, and the runtime's judgment and sentence recall.
 * @returns the memory provider these specs exercise and its query log.
 */
export function recallHarness(traces: readonly FakeTrace[], options: FakeCoreOptions & RuntimeOptions = {}): RecallHarness {
  const queries: string[] = []
  const memory = new MemosMemory({
    cores: new OwnerCores(async () => fakeCore(traces, { ...options, queries }) as never),
    routes: new LlmRouteContext(),
    toolLimits: { skills: 8, traces: 8, worldModels: 8 },
    personFactsTtlMs: 0,
    ...options.relevance === undefined ? {} : { relevance: options.relevance },
    ...options.sentenceRecall === undefined ? {} : { sentenceRecall: options.sentenceRecall },
    warn: () => {},
    info: () => {},
  })
  return { memory, queries }
}

/**
 * The runtime over a fake core that answers every query with every given trace.
 * @param traces - the traces the runtime may recall.
 * @returns the memory provider these specs exercise.
 */
export function memory(traces: readonly FakeTrace[]): MemosMemory {
  return recallHarness(traces).memory
}

export const SCOPE = { owner: 'owner-1', sessionId: 'session-1', cwd: '/workspace' } as never
export const signal = new AbortController().signal
