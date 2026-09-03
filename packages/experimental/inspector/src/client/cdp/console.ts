/** Client Console observation shared by every active DevTools Runtime session. */

import type { ClientRemoteObjectHandle, ClientRuntimeSessionId } from '../../shared/bridge/ids.ts'
import type { ClientConsoleCapability } from '../../shared/bridge/messages/runtime/index.ts'
import type { RuntimeConsoleBackendEvent, RuntimeConsoleType, RuntimeStackTrace } from '../../shared/cdp/index.ts'
import type { ClientRuntimeExecutor } from './runtime.ts'
import { captureClientConsoleStack, clientErrorStack, type ClientScriptKeyResolver } from './stack.ts'

/**
 * Describe browser-side Console observation.
 * @returns The Console capability advertised by a browser Client source.
 */
export function consoleBridgeCapability(): ClientConsoleCapability {
  return { type: 'client-console' }
}

/** Receives one Console event whose object handles belong to the given session. */
export type ClientConsoleSink = (
  sessionId: ClientRuntimeSessionId,
  event: RuntimeConsoleBackendEvent<ClientRemoteObjectHandle>,
) => void

const METHODS = [
  ['log', 'log'],
  ['debug', 'debug'],
  ['info', 'info'],
  ['error', 'error'],
  ['warn', 'warning'],
  ['dir', 'dir'],
  ['dirxml', 'dirxml'],
  ['table', 'table'],
  ['trace', 'trace'],
  ['clear', 'clear'],
  ['group', 'startGroup'],
  ['groupCollapsed', 'startGroupCollapsed'],
  ['groupEnd', 'endGroup'],
  ['assert', 'assert'],
  ['profile', 'profile'],
  ['profileEnd', 'profileEnd'],
  ['count', 'count'],
  ['timeEnd', 'timeEnd'],
] as const satisfies readonly (readonly [string, RuntimeConsoleType])[]

type ConsoleMethodName = typeof METHODS[number][0]

/**
 * Console events retained for each source generation while no DevTools session
 * is enabled yet. The Worker enables Console observation over the ingest socket,
 * so a Client that logs before that frame arrives would otherwise drop the event
 * with no later trace of it. Replaying the buffer on enable is what Chrome's own
 * Runtime domain does for console history.
 *
 * The bound is fixed rather than configured: it caps the memory one generation's
 * pre-enable window can retain, and its size does not vary by deployment.
 */
const MAX_BUFFERED_CONSOLE_EVENTS = 100

/** One captured Console call awaiting a session to materialize it against. */
interface BufferedConsoleCall {
  readonly kind: 'console'
  readonly type: RuntimeConsoleType
  readonly values: readonly unknown[]
  readonly timestamp: number
  readonly stackTrace: RuntimeStackTrace | undefined
}

/** One captured Client exception awaiting a session to materialize it against. */
interface BufferedException {
  readonly kind: 'exception'
  readonly error: unknown
  readonly timestamp: number
  readonly stackTrace: RuntimeStackTrace | undefined
}

type BufferedEvent = BufferedConsoleCall | BufferedException

interface InstalledMethod {
  readonly name: ConsoleMethodName
  readonly original: (...args: unknown[]) => unknown
  readonly replacement: (...args: unknown[]) => unknown
}

/** Installs one transparent console/error observer and fans out session-local values. */
export class ClientConsoleObserver {
  private readonly sessions = new Set<ClientRuntimeSessionId>()
  private readonly installed: InstalledMethod[] = []
  private readonly buffered: BufferedEvent[] = []
  private active = false
  private closed = false

  constructor(
    private readonly runtime: ClientRuntimeExecutor,
    private readonly sink: ClientConsoleSink,
    private readonly resolveScript: ClientScriptKeyResolver = () => undefined,
  ) {}

  /**
   * Start producing events for one DevTools Runtime session.
   * @param sessionId - Session whose object table retains event arguments.
   */
  enable(sessionId: ClientRuntimeSessionId): void {
    if (this.closed || this.sessions.has(sessionId)) return
    this.sessions.add(sessionId)
    if (!this.active) this.install()
    for (const entry of [...this.buffered]) this.deliver(sessionId, entry)
  }

  /**
   * Stop producing events and release Console objects for one session.
   * @param sessionId - Session being disabled or closed.
   */
  disable(sessionId: ClientRuntimeSessionId): void {
    this.sessions.delete(sessionId)
    this.runtime.releaseObjectGroup(sessionId, 'console')
  }

  /** Restore original browser hooks and clear every active session. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.sessions.clear()
    this.buffered.length = 0
    this.uninstall()
  }

  /**
   * Start a source generation: drop the previous generation's retained events and
   * observe from here, so events logged before the Worker's enable frame arrives
   * are still replayed to the session that enables.
   */
  reset(): void {
    this.sessions.clear()
    this.buffered.length = 0
    if (!this.closed && !this.active) this.install()
  }

  private install(): void {
    this.active = true
    for (const [name, type] of METHODS) {
      const candidate: unknown = Reflect.get(console, name)
      if (typeof candidate !== 'function') continue
      const original = candidate as (...args: unknown[]) => unknown
      const capture = (values: readonly unknown[]): void => { this.captureConsole(type, values) }
      const replacement = function (this: unknown, ...args: unknown[]): unknown {
        const result = Reflect.apply(original, this, args)
        const values = name === 'assert' ? args.slice(1) : args
        if (name !== 'assert' || !args[0]) capture(values)
        return result
      }
      if (Reflect.set(console, name, replacement)) this.installed.push({ name, original, replacement })
    }
    addGlobalListener('error', this.onError)
    addGlobalListener('unhandledrejection', this.onUnhandledRejection)
  }

  private uninstall(): void {
    if (!this.active) return
    this.active = false
    removeGlobalListener('error', this.onError)
    removeGlobalListener('unhandledrejection', this.onUnhandledRejection)
    for (const method of this.installed.splice(0).reverse()) {
      if (Reflect.get(console, method.name) === method.replacement) Reflect.set(console, method.name, method.original)
    }
  }

  private readonly onError = (event: Event): void => {
    const error = Reflect.get(event, 'error') as unknown
    const message = Reflect.get(event, 'message') as unknown
    this.captureException(error ?? new Error(typeof message === 'string' ? message : 'Client error'))
  }

  private readonly onUnhandledRejection = (event: Event): void => {
    this.captureException(Reflect.get(event, 'reason') as unknown)
  }

  private captureConsole(type: RuntimeConsoleType, values: readonly unknown[]): void {
    this.record({
      kind: 'console',
      type,
      values,
      timestamp: Date.now(),
      stackTrace: captureClientConsoleStack(this.resolveScript),
    })
  }

  private captureException(error: unknown): void {
    this.record({
      kind: 'exception',
      error,
      timestamp: Date.now(),
      stackTrace: clientErrorStack(error, this.resolveScript),
    })
  }

  /** Retain one capture for later sessions and fan it out to the enabled ones. */
  private record(entry: BufferedEvent): void {
    this.buffered.push(entry)
    if (this.buffered.length > MAX_BUFFERED_CONSOLE_EVENTS) this.buffered.shift()
    queueMicrotask(() => {
      for (const sessionId of [...this.sessions]) this.deliver(sessionId, entry)
    })
  }

  /** Materialize one capture against a session's object table and emit it. */
  private deliver(sessionId: ClientRuntimeSessionId, entry: BufferedEvent): void {
    try {
      const event = entry.kind === 'console'
        ? this.runtime.consoleEvent(sessionId, entry.type, entry.values, entry.timestamp, entry.stackTrace)
        : this.runtime.exceptionEvent(sessionId, entry.error, entry.timestamp, entry.stackTrace)
      if (event !== undefined) this.sink(sessionId, event)
    } catch {
      // Console observation must not affect the page's original console call.
    }
  }
}

function addGlobalListener(type: string, listener: EventListener): void {
  const add = Reflect.get(globalThis, 'addEventListener') as unknown
  if (typeof add === 'function') Reflect.apply(add, globalThis, [type, listener])
}

function removeGlobalListener(type: string, listener: EventListener): void {
  const remove = Reflect.get(globalThis, 'removeEventListener') as unknown
  if (typeof remove === 'function') Reflect.apply(remove, globalThis, [type, listener])
}
