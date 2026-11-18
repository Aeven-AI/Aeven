/**
 * Runs MemOS cores outside the Host event loop. One worker holds the cores of the accounts the Host assigned to it,
 * each over its own database; LLM calls, hosted embedding, and the maintenance gate are asked of the Host.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { parentPort, workerData } from 'node:worker_threads'
import type { MemoryCore } from '@deepseek-ai/memos-local-plugin/agent-contract/memory-core.js'
import { MemosError, type ErrorCode } from '@deepseek-ai/memos-local-plugin/agent-contract/errors.js'
import { bootstrapMemoryCore } from '@deepseek-ai/memos-local-plugin/core/index.js'
import type { EmbeddingProvider } from '@deepseek-ai/memos-local-plugin/core/embedding/types.js'
import type { HostLlmBridge, HostLlmCompletion } from '@deepseek-ai/memos-local-plugin/core/llm/host-bridge.js'
import { GATE, wireError, type FromWorker, type ToWorker, type WireError } from './core-protocol.ts'

const port = parentPort
if (port === null) throw new Error('MemOS core worker requires a parent port')
const { gate: gateBuffer, gateTimeoutMs, bridgeId } = workerData as { gate: SharedArrayBuffer; gateTimeoutMs: number; bridgeId: string }
const gateCell = new Int32Array(gateBuffer)
const send = (message: FromWorker): void => { port.postMessage(message) }

const cores = new Map<string, MemoryCore>()
/** Host context of the core call an asynchronous continuation belongs to. */
const callContext = new AsyncLocalStorage<number>()
/** Abort controllers of running core calls, by call id. */
const running = new Map<number, AbortController>()
/** Requests this worker sent the Host and waits on, by request id. */
const asked = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
let nextRequest = 0

function fromWire(error: WireError): Error {
  if (error.code !== undefined) return new MemosError(error.code as ErrorCode, error.message, error.details)
  const plain = new Error(error.message)
  plain.name = error.name
  return plain
}

/**
 * Ask the Host and wait for its reply; an aborted `signal` tells the Host to stop and rejects with the signal's reason.
 * @param build - the request for a fresh request id.
 * @param signal - cancels the wait.
 * @returns the Host's reply value.
 */
function ask(build: (id: number) => FromWorker, signal: AbortSignal | undefined): Promise<unknown> {
  if (signal?.aborted === true) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
  const id = ++nextRequest
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      if (!asked.delete(id)) return
      send({ type: 'cancel', id })
      reject(signal?.reason instanceof Error ? signal.reason : new Error('aborted'))
    }
    asked.set(id, {
      resolve: (value) => { signal?.removeEventListener('abort', onAbort); resolve(value) },
      reject: (error) => { signal?.removeEventListener('abort', onAbort); reject(error) },
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    send(build(id))
  })
}

const bridge: HostLlmBridge = {
  id: bridgeId,
  complete: async (input) => {
    const { signal, ...rest } = input
    return await ask(id => ({ type: 'llm', id, context: callContext.getStore() ?? 0, input: rest }), signal) as HostLlmCompletion
  },
}

function hostEmbeddings(owner: string): EmbeddingProvider {
  return {
    name: 'local',
    embed: async (texts, role, context) => await ask(id => ({
      // The core's config object carries its own callbacks; the Host's queue reads the model fields only.
      type: 'embed', id, owner, texts: [...texts], role, config: JSON.parse(JSON.stringify(context.config)) as typeof context.config,
      ...context.deadlineAt === undefined ? {} : { deadlineAt: context.deadlineAt },
    }), context.signal) as number[][],
  }
}

/**
 * Ask the Host whether this device may run an account's maintenance. The core asks synchronously, so the worker
 * waits on the shared gate cell; a Host that does not answer within `gateTimeoutMs` counts as a refusal.
 */
function mayMaintain(owner: string): boolean {
  Atomics.store(gateCell, 0, GATE.ASKED)
  send({ type: 'gate', owner })
  Atomics.wait(gateCell, 0, GATE.ASKED, gateTimeoutMs)
  return Atomics.load(gateCell, 0) === GATE.GRANTED
}

async function open(owner: string, spec: Extract<ToWorker, { type: 'open' }>['spec']): Promise<void> {
  if (cores.has(owner)) return
  const core = await bootstrapMemoryCore({
    agent: spec.agent,
    namespace: spec.namespace,
    home: spec.home,
    config: spec.config as NonNullable<Parameters<typeof bootstrapMemoryCore>[0]['config']>,
    hostLlmBridge: spec.hostLlm ? bridge : null,
    ...spec.hostEmbeddings ? { embeddingProvider: hostEmbeddings(owner) } : {},
    autoRecovery: spec.autoRecovery,
    maintenanceGate: () => mayMaintain(owner),
    initLogging: false,
  })
  await core.init()
  cores.set(owner, core)
}

async function call(message: Extract<ToWorker, { type: 'call' }>): Promise<unknown> {
  const core = cores.get(message.owner)
  if (core === undefined) throw new Error('MemOS core worker holds no core for this account')
  const method = (core as unknown as Record<string, unknown>)[message.method]
  if (typeof method !== 'function') throw new Error(`MemOS core has no method ${message.method}`)
  const controller = new AbortController()
  running.set(message.id, controller)
  const args = message.args.map((arg, index) => message.signals.includes(index)
    ? { ...arg as Record<string, unknown>, signal: controller.signal }
    : arg)
  try {
    // The context reaches every continuation the call starts, including work that outlives the call.
    return await callContext.run(message.context, () => (method as (...values: unknown[]) => unknown).apply(core, args))
  } finally {
    running.delete(message.id)
  }
}

function settle(id: number, work: Promise<unknown>): void {
  work.then(
    (value) => { send({ type: 'result', id, ...value === undefined ? {} : { value } }) },
    (error: unknown) => { send({ type: 'result', id, error: wireError(error) }) },
  )
}

port.on('message', (message: ToWorker) => {
  switch (message.type) {
    case 'open': settle(message.id, open(message.owner, message.spec)); break
    case 'call': settle(message.id, call(message)); break
    case 'abort': running.get(message.id)?.abort(new Error('aborted by the Host')); break
    case 'close': {
      const core = cores.get(message.owner)
      cores.delete(message.owner)
      settle(message.id, core === undefined ? Promise.resolve() : core.shutdown())
      break
    }
    case 'reply': {
      const waiting = asked.get(message.id)
      if (waiting === undefined) break
      asked.delete(message.id)
      if (message.error === undefined) waiting.resolve(message.value)
      else waiting.reject(fromWire(message.error))
      break
    }
    default: {
      const unknown: never = message
      throw new Error(`Unknown MemOS core worker message: ${JSON.stringify(unknown)}`)
    }
  }
})
