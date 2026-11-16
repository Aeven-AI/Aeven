/**
 * Outbound HTTP routing that follows the operating system's proxy settings.
 *
 * The Electron shell's network stack honours the system proxy, including PAC scripts and WPAD, but
 * Node's `fetch` connects directly. On a network that only lets traffic out through its proxy, the
 * renderer then reaches Aeven while every Host request fails. This module installs a global undici
 * dispatcher that asks the shell, per request, which routes Chromium would use for the URL, and
 * sends the request along the first route that works. Chromium caches PAC results and re-reads the
 * settings when the network changes, so a laptop that moves between an office proxy and a home
 * network follows each change without restarting the Host.
 *
 * Fallback follows Chromium's: when a route cannot be reached, the request moves to the next one,
 * which is how a `PROXY corp:8080; DIRECT` PAC keeps working away from the office. A proxy that could
 * not be reached moves behind the other routes for {@link BAD_PROXY_RETRY_MS}, as Chromium
 * deprioritizes a bad proxy, and stays in the list as the last resort; reaching it again clears the
 * mark. Only failures to connect move on: a proxy that answers, even with a refusal or a reset, keeps
 * the request.
 *
 * Loopback destinations always connect directly without asking: the Host's own loopback HTTP
 * carrier serves every renderer request, and Chromium never proxies loopback either. While the
 * shell's IPC channel is closed, as when the Host keeps serving after the shell quit, every request
 * connects directly.
 *
 * Only the global dispatcher, and so every plain `fetch()`, follows this routing. A caller that
 * passes its own dispatcher, such as the web-fetch tool's pinned direct transport, keeps it.
 * @module
 */

import { isIP } from 'node:net'
import { Agent, Dispatcher, ProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici'

/**
 * How long a proxy that could not be reached is passed over: Chromium's own retry delay for a bad
 * proxy, so the Host and the renderer give an unreachable proxy the same second chance.
 */
export const BAD_PROXY_RETRY_MS = 5 * 60 * 1000

/**
 * Socket and DNS failures that mean a route's first hop could not be reached at all. A request that
 * fails with one of these before it starts moves to its next route.
 */
const UNREACHABLE_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'EHOSTDOWN', 'ENETUNREACH', 'ENETDOWN',
  'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT',
])

/** One route: an `http:`, `https:`, or `socks5:` proxy URL, or `null` for a direct connection. */
export type ProxyRoute = string | null

/** Host-to-shell question: which routes the system settings choose for `url`. */
export interface ProxyQuestion {
  readonly type: 'resolveProxy'
  /** Positive safe integer, unique among this Host's open questions. */
  readonly id: number
  /** `http:` or `https:` URL the Host is about to request. */
  readonly url: string
}

/** Shell-to-Host answer to the {@link ProxyQuestion} with the same `id`. */
export interface ProxyAnswer {
  readonly type: 'proxy'
  readonly id: number
  /** Routes in order of preference; at least one, and a `null` route only last. */
  readonly routes: readonly ProxyRoute[]
}

/**
 * Find the routes for one request URL.
 * @param url - absolute `http:` or `https:` URL.
 * @returns at least one route in order of preference; never rejects.
 */
export type ProxyLookup = (url: string) => Promise<readonly ProxyRoute[]>

/** The answer that connects directly. */
const DIRECT: readonly ProxyRoute[] = [null]

/** Proxy URL schemes the Host's undici transport speaks. */
const PROXY_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'socks5:'])

function isProxyUrl(value: unknown): value is string {
  return typeof value === 'string' && URL.canParse(value) && PROXY_PROTOCOLS.has(new URL(value).protocol)
}

/**
 * Validate one shell IPC message as a {@link ProxyAnswer}.
 * @param message - a message received on the shell's IPC channel.
 * @returns whether the message is a well-formed answer.
 */
export function isProxyAnswer(message: unknown): message is ProxyAnswer {
  if (typeof message !== 'object' || message === null) return false
  const candidate = message as Record<string, unknown>
  if (candidate.type !== 'proxy' || !Number.isSafeInteger(candidate.id) || (candidate.id as number) < 1) return false
  const routes = candidate.routes
  if (!Array.isArray(routes) || routes.length === 0) return false
  return routes.every((route, index) => route === null ? index === routes.length - 1 : isProxyUrl(route))
}

/**
 * Whether a URL hostname names this machine's loopback interface.
 * @param hostname - `URL.hostname`, with IPv6 literals in brackets.
 * @returns whether requests to the host must never leave the machine.
 */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  const lower = host.toLowerCase()
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true
  switch (isIP(lower)) {
    case 4:
      return lower.startsWith('127.')
    case 6:
      return lower === '::1' || lower.startsWith('::ffff:127.')
    default:
      return false
  }
}

/**
 * Whether a dispatch error means the route's first hop, the proxy or the destination itself, could not be reached.
 * @param error - the error undici reported for the request.
 * @returns whether the request may move to its next route.
 */
export function isUnreachable(error: Error): boolean {
  if (error.name === 'AbortError') return false
  const code = (error as NodeJS.ErrnoException).code ?? ((error as { cause?: NodeJS.ErrnoException }).cause)?.code
  return code !== undefined && UNREACHABLE_CODES.has(code)
}

/**
 * Hands one request to the caller's handler and, when it fails to reach its proxy before anything was
 * sent, to the next route instead.
 *
 * undici calls `onRequestStart` once the connection, tunnel included, is up and before it writes any
 * request bytes, so a request that fails earlier has consumed none of its body and can be dispatched
 * again unchanged.
 */
class FallbackHandler implements Dispatcher.DispatchHandler {
  private started = false

  /**
   * @param handler - the caller's handler.
   * @param reached - called once when the route connected.
   * @param fallBack - offered an error that arrived before the route connected; `true` when it took the request.
   */
  constructor(
    private readonly handler: Dispatcher.DispatchHandler,
    private readonly reached: () => void,
    private readonly fallBack: (error: Error) => boolean,
  ) {}

  onRequestStart(controller: Dispatcher.DispatchController, context: unknown): void {
    this.started = true
    this.reached()
    this.handler.onRequestStart?.(controller, context)
  }

  onRequestUpgrade(...args: Parameters<NonNullable<Dispatcher.DispatchHandler['onRequestUpgrade']>>): void {
    this.started = true
    this.handler.onRequestUpgrade?.(...args)
  }

  onResponseStart(...args: Parameters<NonNullable<Dispatcher.DispatchHandler['onResponseStart']>>): void {
    this.started = true
    this.handler.onResponseStart?.(...args)
  }

  onResponseData(...args: Parameters<NonNullable<Dispatcher.DispatchHandler['onResponseData']>>): void {
    this.handler.onResponseData?.(...args)
  }

  onResponseEnd(...args: Parameters<NonNullable<Dispatcher.DispatchHandler['onResponseEnd']>>): void {
    this.handler.onResponseEnd?.(...args)
  }

  onResponseError(controller: Dispatcher.DispatchController, error: Error): void {
    if (!this.started && this.fallBack(error)) return
    this.handler.onResponseError?.(controller, error)
  }

  onRequestSent(): void {
    this.handler.onRequestSent?.()
  }

  onResponseStarted(): void {
    this.handler.onResponseStarted?.()
  }

  onBodySent(chunk: Buffer): void {
    this.handler.onBodySent?.(chunk)
  }
}

/**
 * Global dispatcher that routes each request by a {@link ProxyLookup}.
 *
 * Routing is decided per request, never pinned to an origin, so a proxy change applies to the next
 * request. Connections stay pooled per route: one direct agent, and one proxy agent per proxy URL.
 */
export class SystemProxyDispatcher extends Dispatcher {
  // proxy-exempt: the DIRECT route of the system proxy choice, used only where the shell's answer names no proxy.
  private readonly direct = new Agent()
  private readonly proxies = new Map<string, ProxyAgent>()
  /** Proxies that could not be reached, with the time each is tried again first. */
  private readonly badUntil = new Map<string, number>()

  /**
   * @param lookup - route choice for one request URL.
   * @param now - clock for the bad-proxy delay; `Date.now` in production.
   */
  constructor(private readonly lookup: ProxyLookup, private readonly now: () => number = Date.now) {
    super()
  }

  /**
   * Route one request. A non-loopback request waits for its lookup before it reaches an agent.
   * @param options - undici dispatch options; `origin` names the destination.
   * @param handler - the caller's response handler.
   * @returns `true`: the request is accepted and queued on its route.
   */
  override dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    const origin = new URL(String(options.origin))
    if (isLoopbackHostname(origin.hostname)) return this.direct.dispatch(options, handler)
    void this.lookup(origin.href).then((routes) => {
      this.attempt(this.preferred(routes), options, handler)
    })
    return true
  }

  /** Close every agent after its queued requests finish. */
  override close(callback: () => void): void
  override close(): Promise<void>
  override close(callback?: () => void): Promise<void> | undefined {
    const closing = Promise.all(this.agents().map(agent => agent.close())).then(() => undefined)
    if (callback === undefined) return closing
    void closing.then(callback)
    return undefined
  }

  /** Abort every queued and running request and close every agent. */
  override destroy(err: Error | null, callback: () => void): void
  override destroy(callback: () => void): void
  override destroy(err?: Error | null): Promise<void>
  override destroy(errOrCallback?: Error | null | (() => void), callback?: () => void): Promise<void> | undefined {
    const err = typeof errOrCallback === 'function' ? null : errOrCallback ?? null
    const done = typeof errOrCallback === 'function' ? errOrCallback : callback
    const destroying = Promise.all(this.agents().map(agent => agent.destroy(err))).then(() => undefined)
    if (done === undefined) return destroying
    void destroying.then(done)
    return undefined
  }

  /** The routes in order, with proxies still inside their bad-proxy delay moved behind the others. */
  private preferred(routes: readonly ProxyRoute[]): readonly ProxyRoute[] {
    const at = this.now()
    const isBad = (route: ProxyRoute): boolean => route !== null && (this.badUntil.get(route) ?? 0) > at
    return [...routes.filter(route => !isBad(route)), ...routes.filter(isBad)]
  }

  private attempt(routes: readonly ProxyRoute[], options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): void {
    const [route = null, ...rest] = routes
    if (rest.length === 0) {
      this.agentFor(route).dispatch(options, handler)
      return
    }
    this.agentFor(route).dispatch(options, new FallbackHandler(handler, () => {
      if (route !== null) this.badUntil.delete(route)
    }, (error) => {
      if (!isUnreachable(error)) return false
      if (route !== null) this.badUntil.set(route, this.now() + BAD_PROXY_RETRY_MS)
      this.attempt(rest, options, handler)
      return true
    }))
  }

  private agentFor(route: ProxyRoute): Dispatcher {
    if (route === null) return this.direct
    let agent = this.proxies.get(route)
    if (agent === undefined) {
      // For a `socks5:` route undici's ProxyAgent hands each connection to its SOCKS5 agent, which sends the
      // destination hostname for the proxy to resolve, as Chromium's SOCKS5 does.
      // proxy-exempt: this agent is the system proxy route itself, built from the shell's answer.
      agent = new ProxyAgent({ uri: route })
      this.proxies.set(route, agent)
    }
    return agent
  }

  private agents(): Dispatcher[] {
    return [this.direct, ...this.proxies.values()]
  }
}

/**
 * Ask the Electron shell over this process's Node IPC channel.
 *
 * The returned lookup answers direct when the channel is closed, when sending fails because it
 * closed meanwhile, and for every question still open when it disconnects. The shell answers every
 * question it receives, so no question waits on a timer.
 * @param channel - this process, or a test double with the same IPC members.
 * @returns the lookup, and a disposer that removes its listeners and answers open questions directly.
 */
export function ipcProxyLookup(channel: NodeJS.Process): { lookup: ProxyLookup; dispose: () => void } {
  let nextId = 1
  const open = new Map<number, (routes: readonly ProxyRoute[]) => void>()
  const answerAll = (): void => {
    for (const resolve of open.values()) resolve(DIRECT)
    open.clear()
  }
  const onMessage = (message: unknown): void => {
    if (!isProxyAnswer(message)) return
    const resolve = open.get(message.id)
    if (resolve === undefined) return
    open.delete(message.id)
    resolve(message.routes)
  }
  channel.on('message', onMessage)
  channel.on('disconnect', answerAll)
  const lookup: ProxyLookup = (url) => {
    const send = channel.send?.bind(channel)
    if (send === undefined || !channel.connected) return Promise.resolve(DIRECT)
    const id = nextId++
    return new Promise((resolve) => {
      open.set(id, resolve)
      const question: ProxyQuestion = { type: 'resolveProxy', id, url }
      send(question, undefined, undefined, (error: Error | null) => {
        if (error === null || !open.has(id)) return
        open.delete(id)
        resolve(DIRECT)
      })
    })
  }
  return {
    lookup,
    dispose: () => {
      channel.off('message', onMessage)
      channel.off('disconnect', answerAll)
      answerAll()
    },
  }
}

/**
 * Route this process's `fetch()` calls by the shell's system proxy answers.
 * @param lookup - route choice for one request URL.
 * @returns a disposer that restores the previous global dispatcher and closes this one's agents.
 */
export function installSystemProxy(lookup: ProxyLookup): () => Promise<void> {
  const previous = getGlobalDispatcher()
  const dispatcher = new SystemProxyDispatcher(lookup)
  setGlobalDispatcher(dispatcher)
  return async () => {
    setGlobalDispatcher(previous)
    await dispatcher.close()
  }
}
