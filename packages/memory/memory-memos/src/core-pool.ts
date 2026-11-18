/** Host side of the MemOS core workers: assigns accounts to workers and stands in for each account's core. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { Worker } from 'node:worker_threads'
import type { MemoryCore } from '@deepseek-ai/memos-local-plugin/agent-contract/memory-core.js'
import { MemosError, type ErrorCode } from '@deepseek-ai/memos-local-plugin/agent-contract/errors.js'
import type { EmbeddingProvider, ProviderLogger } from '@deepseek-ai/memos-local-plugin/core/embedding/types.js'
import type { HostLlmBridge } from '@deepseek-ai/memos-local-plugin/core/llm/host-bridge.js'
import { GATE, wireError, type CoreOpenSpec, type FromWorker, type ToWorker, type WireError } from './core-protocol.ts'

/** What the pool needs from the provider that owns it. */
export interface CorePoolOptions {
  /** Worker threads; accounts are spread over them and stay on the one that opened them. */
  readonly workers: number
  /** How long a worker waits for the Host's maintenance verdict before it treats the answer as a refusal. */
  readonly gateTimeoutMs: number
  /** Core calls whose Host context is kept for the LLM requests their work issues later; the oldest are dropped. */
  readonly contexts: number
  /** The Host LLM bridge workers call through, or null when MemOS uses its own provider. */
  readonly bridge: HostLlmBridge | null
  /** Whether the calling code runs inside a Host context an LLM request would need. */
  readonly inContext: () => boolean
  /** The Host's embedding queue for an account; absent when each worker loads the model itself. */
  readonly embeddings?: (owner: string) => EmbeddingProvider
  /** Whether this device may run an account's maintenance now. */
  readonly mayMaintain: (owner: string) => boolean
  /** Called with the accounts of a worker that stopped; their next use opens them again. */
  readonly lost: (owners: readonly string[]) => void
  readonly warn: (message: string) => void
}

interface Slot {
  worker: Worker | undefined
  readonly gate: Int32Array
  readonly owners: Set<string>
  /** Calls and opens awaiting the worker's result, by id. */
  readonly pending: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>
  /** Host work running for the worker's `llm` and `embed` requests, by request id. */
  readonly serving: Map<number, AbortController>
}

const SILENT: ProviderLogger = { trace() {}, debug() {}, info() {}, warn() {}, error() {} }

function fromWire(error: WireError): Error {
  if (error.code !== undefined) return new MemosError(error.code as ErrorCode, error.message, error.details)
  const plain = new Error(error.message)
  plain.name = error.name
  return plain
}

/** MemOS cores running in worker threads, one core per account. */
export class CoreWorkerPool {
  private readonly slots: Slot[]
  private nextId = 0
  /** Restorers of the Host context each recorded call ran in, oldest first. */
  private readonly contexts = new Map<number, <T>(run: () => T) => T>()
  private closed = false

  /** @param options - worker count, limits, and the Host services workers call back into. */
  constructor(private readonly options: CorePoolOptions) {
    this.slots = Array.from({ length: options.workers }, () => ({
      worker: undefined,
      gate: new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
      owners: new Set<string>(),
      pending: new Map(),
      serving: new Map(),
    }))
  }

  /**
   * Open an account's core on the worker holding the fewest accounts.
   * @param owner - account id.
   * @param spec - what the worker opens the core with.
   * @returns a stand-in whose methods run on that worker's core.
   */
  async open(owner: string, spec: CoreOpenSpec): Promise<MemoryCore> {
    if (this.closed) throw new Error('memory-memos: the core workers are shutting down')
    const slot = this.slots.reduce((least, candidate) => candidate.owners.size < least.owners.size ? candidate : least)
    slot.owners.add(owner)
    try {
      await this.request(slot, id => ({ type: 'open', id, owner, spec }))
    } catch (error) {
      slot.owners.delete(owner)
      throw error
    }
    return this.standIn(slot, owner)
  }

  /**
   * Stop every worker. Cores the provider did not shut down first are closed with their worker.
   * @returns after every worker thread ended.
   */
  async close(): Promise<void> {
    this.closed = true
    await Promise.all(this.slots.map(async (slot) => {
      const worker = slot.worker
      slot.worker = undefined
      await worker?.terminate()
    }))
  }

  private standIn(slot: Slot, owner: string): MemoryCore {
    const methods = new Map<string, (...args: unknown[]) => Promise<unknown>>()
    return new Proxy({}, {
      get: (_target, property) => {
        // A stand-in returned from an async function must not look like a promise.
        if (typeof property !== 'string' || property === 'then') return undefined
        let method = methods.get(property)
        if (method === undefined) {
          method = property === 'init' ? () => Promise.resolve()
            : property === 'shutdown' ? () => this.shutdown(slot, owner)
              : (...args) => this.call(slot, owner, property, args)
          methods.set(property, method)
        }
        return method
      },
    }) as MemoryCore
  }

  private async shutdown(slot: Slot, owner: string): Promise<void> {
    if (!slot.owners.delete(owner) || slot.worker === undefined) return
    await this.request(slot, id => ({ type: 'close', id, owner }))
  }

  private call(slot: Slot, owner: string, method: string, args: readonly unknown[]): Promise<unknown> {
    if (!slot.owners.has(owner)) return Promise.reject(new Error('memory-memos: this account\'s core worker stopped'))
    const signals: number[] = []
    const aborts: AbortSignal[] = []
    const plain = args.map((arg, index) => {
      if (typeof arg !== 'object' || arg === null) return arg
      const signal = (arg as { signal?: unknown }).signal
      if (!(signal instanceof AbortSignal)) return arg
      const { signal: _signal, ...rest } = arg as Record<string, unknown>
      signals.push(index)
      aborts.push(signal)
      return rest
    })
    const aborted = aborts.find(signal => signal.aborted)
    if (aborted !== undefined) return Promise.reject(aborted.reason instanceof Error ? aborted.reason : new Error('aborted'))
    let callId = 0
    const context = this.options.inContext() ? this.remember() : 0
    const result = this.request(slot, (id) => {
      callId = id
      return { type: 'call', id, owner, method, args: plain, signals, context }
    })
    if (aborts.length > 0) {
      const abort = (): void => { slot.worker?.postMessage({ type: 'abort', id: callId } satisfies ToWorker) }
      for (const signal of aborts) signal.addEventListener('abort', abort, { once: true })
      const detach = (): void => { for (const signal of aborts) signal.removeEventListener('abort', abort) }
      result.then(detach, detach)
    }
    // Some callers fire a core method without awaiting it; their own chains still see the rejection.
    result.catch(() => undefined)
    return result
  }

  /** Record the caller's Host context and return the id a worker's later LLM request names it by. */
  private remember(): number {
    const id = ++this.nextId
    this.contexts.set(id, AsyncLocalStorage.snapshot())
    if (this.contexts.size > this.options.contexts) {
      const oldest = this.contexts.keys().next()
      if (oldest.done !== true) this.contexts.delete(oldest.value)
    }
    return id
  }

  private request(slot: Slot, build: (id: number) => ToWorker): Promise<unknown> {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      slot.pending.set(id, { resolve, reject })
      try {
        this.workerOf(slot).postMessage(build(id))
      } catch (error) {
        slot.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private workerOf(slot: Slot): Worker {
    if (slot.worker !== undefined) return slot.worker
    const source = new URL(import.meta.url).pathname.endsWith('.ts')
    const worker = new Worker(new URL(source ? './core-worker.ts' : './core-worker.js', import.meta.url), {
      workerData: { gate: slot.gate.buffer, gateTimeoutMs: this.options.gateTimeoutMs, bridgeId: this.options.bridge?.id ?? '' },
    })
    slot.worker = worker
    worker.on('message', (message: FromWorker) => { this.receive(slot, worker, message) })
    worker.on('error', (error) => { this.stopped(slot, worker, error) })
    worker.on('exit', (code) => { this.stopped(slot, worker, new Error(`MemOS core worker exited (${String(code)})`)) })
    return worker
  }

  /** Fail what waited on a worker that stopped and release its accounts. */
  private stopped(slot: Slot, worker: Worker, error: Error): void {
    if (slot.worker !== worker) return
    slot.worker = undefined
    const owners = [...slot.owners]
    slot.owners.clear()
    for (const waiting of slot.pending.values()) waiting.reject(error)
    slot.pending.clear()
    for (const serving of slot.serving.values()) serving.abort(error)
    slot.serving.clear()
    if (this.closed) return
    this.options.warn(`a MemOS core worker stopped (${error.message}); ${String(owners.length)} account(s) reopen on their next use`)
    this.options.lost(owners)
  }

  private receive(slot: Slot, worker: Worker, message: FromWorker): void {
    switch (message.type) {
      case 'result': {
        const waiting = slot.pending.get(message.id)
        if (waiting === undefined) return
        slot.pending.delete(message.id)
        if (message.error === undefined) waiting.resolve(message.value)
        else waiting.reject(fromWire(message.error))
        return
      }
      case 'llm': {
        const bridge = this.options.bridge
        const restore = this.contexts.get(message.context)
        this.serve(slot, worker, message.id, signal => bridge === null
          ? Promise.reject(new Error('memory-memos: no Host LLM bridge is configured'))
          : restore === undefined
            ? bridge.complete({ ...message.input, signal })
            : restore(() => bridge.complete({ ...message.input, signal })))
        return
      }
      case 'embed': {
        const provider = this.options.embeddings?.(message.owner)
        this.serve(slot, worker, message.id, signal => provider === undefined
          ? Promise.reject(new Error('memory-memos: no Host embedding queue is configured'))
          : provider.embed([...message.texts], message.role, {
            config: message.config, log: SILENT, signal,
            ...message.deadlineAt === undefined ? {} : { deadlineAt: message.deadlineAt },
          }))
        return
      }
      case 'cancel':
        slot.serving.get(message.id)?.abort(new Error('cancelled by the MemOS core worker'))
        return
      case 'gate':
        Atomics.store(slot.gate, 0, this.options.mayMaintain(message.owner) ? GATE.GRANTED : GATE.DENIED)
        Atomics.notify(slot.gate, 0)
        return
      default: {
        const unknown: never = message
        throw new Error(`Unknown MemOS core worker message: ${JSON.stringify(unknown)}`)
      }
    }
  }

  /** Run Host work for a worker's request and send back its outcome. */
  private serve(slot: Slot, worker: Worker, id: number, work: (signal: AbortSignal) => Promise<unknown>): void {
    const controller = new AbortController()
    slot.serving.set(id, controller)
    const reply = (message: ToWorker): void => {
      slot.serving.delete(id)
      if (slot.worker === worker) worker.postMessage(message)
    }
    let running: Promise<unknown>
    try {
      running = work(controller.signal)
    } catch (error) {
      running = Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
    running.then(
      (value) => { reply({ type: 'reply', id, value }) },
      (error: unknown) => { reply({ type: 'reply', id, error: wireError(error) }) },
    )
  }
}
