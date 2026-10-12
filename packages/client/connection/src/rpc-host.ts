/** Host registry and HTTP adapter for generic Connection RPC channels. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { WebRoute } from '@aeven/host-webserver'
import {
  RpcId,
  type ClientRequest,
  type RpcId as RpcIdType,
} from './rpc.ts'
import { clientRequestSchema } from './rpc-schema.ts'
import { bridge, type FetchHandler } from './http-bridge.ts'
import { isTrustedApiRequest } from './api-request-trust.ts'
import { API_PATH } from './api-path.ts'
import type { BrowserAuth } from './browser-auth.ts'
import type {} from '@aeven/identity-user'
import type { User } from '@aeven/identity-user'
import type {
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionFetchRoute,
  ConnectionFetchHandler,
  HostConnectionFetch,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcFailure,
  ConnectionRpcHandler,
  ConnectionRpcResult,
  ConnectionRequestRejection,
  ConnectionTrustRequest,
  HostConnectionHandle,
  HostConnectionRpc,
} from './rpc.ts'

const INVALID_REQUEST_RPC_ID = RpcId('invalid-request')
const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

/** Bearer scheme name, matched case-insensitively as RFC 7235 requires. */
const BEARER_PREFIX = /^bearer /iu

/**
 * The bearer a request presents, when it presents exactly one.
 *
 * Read here rather than inside the authority because the authority is handed
 * headers and answers a user; this answers "what string was presented", which
 * is a different question and only the caller that must re-present it asks. A
 * repeated header names no credential, matching the authority's own reading.
 * @param request - the incoming HTTP request or WebSocket upgrade.
 * @returns the token, or undefined when absent or ambiguous.
 */
function bearerOf(request: ConnectionTrustRequest): string | undefined {
  const headers = request.headers
  const raw = typeof (headers as Headers).get === 'function'
    ? (headers as Headers).get('authorization') ?? undefined
    : (headers as Record<string, string | readonly string[] | undefined>)['authorization']
  if (typeof raw !== 'string') return undefined
  const match = BEARER_PREFIX.exec(raw)
  if (match === null) return undefined
  const token = raw.slice(match[0].length).trim()
  return token.length > 0 ? token : undefined
}

interface ConnectionRpcInterceptor {
  readonly matches: ConnectionRpcEndpointMatcher
  readonly fetchHandler: FetchHandler
}

interface RegisteredFetchRoute {
  readonly methods: ReadonlySet<string>
  readonly fetch: ConnectionFetchRoute['fetch']
}

interface ConnectionServerResponse {
  readonly type: 'server-response'
  readonly rpcId: RpcIdType
  readonly result: ConnectionRpcResult<unknown>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Connection transport and RPC registrations. */
    connection: HostConnectionHandle
  }
}

/** Host Connection service whose channel registrations belong to the caller fiber. */
export class HostConnectionService extends Service implements HostConnectionHandle {
  private readonly interceptors = new Map<string, ConnectionRpcInterceptor>()
  private readonly fetchRoutes = new Map<string, RegisteredFetchRoute>()

  /**
   * Provide the Host half over the active HTTP server.
   * @param ctx - owning Connection plugin context.
   * @param trustedHosts - deployment authorities accepted by the Host/Origin fence.
   * @param browserAuth - process token and persistent browser-session owner.
   */
  constructor(
    ctx: Context,
    private readonly trustedHosts: readonly string[],
    private readonly browserAuth: BrowserAuth,
  ) {
    super(ctx, 'connection')
  }

  /** Generic channel registry scoped to the Context reading this service. */
  get rpc(): HostConnectionRpc {
    const owner = this.ctx
    return {
      handle: (channel, handler) => this.register(owner, channel, handler),
      intercept: (channel, matches, handler) =>
        this.registerInterceptor(owner, channel, matches, handler),
    }
  }

  /** Exact Fetch-route registry scoped to the Context reading this service. */
  get fetch(): HostConnectionFetch {
    const owner = this.ctx
    return {
      register: route => this.registerFetchRoute(owner, route),
    }
  }

  /**
   * Apply the configured Host/Origin fence, then whichever authority decides
   * who may act.
   *
   * The Host/Origin fence always runs: it answers whether this process will
   * speak to the caller's page at all, which no authentication replaces.
   *
   * Beyond it there is exactly one authority. The launch token exists because
   * a local harness has no other way to tell its own browser from anything
   * else on the machine; a composition that mounts a real one has that way,
   * and requiring both would mean a reader could not reach the sign-in screen
   * without first being handed a URL — which is the thing signing in is meant
   * to replace.
   * @param request - the incoming HTTP request or WebSocket upgrade.
   * @returns the status to answer with, or undefined to proceed.
   */
  requestRejection(request: ConnectionTrustRequest): ConnectionRequestRejection {
    if (!isTrustedApiRequest(request, this.trustedHosts)) return 403
    if (this.enforcingIdentity() !== undefined) {
      return this.ctx.get('identityUsers')?.resolve(request) === undefined ? 401 : undefined
    }
    return this.browserAuth.isAuthenticated(request) ? undefined : 401
  }

  /**
   * The authority deciding who may act, when one is mounted and registered.
   * @returns the seam while it is enforcing, else undefined.
   */
  private enforcingIdentity(): { resolve: (request: ConnectionTrustRequest) => unknown } | undefined {
    const identity = this.ctx.get('identityUsers')
    return identity !== undefined && identity.enforcing ? identity : undefined
  }

  /**
   * Hand the admitted caller's own credential to whatever else must present it.
   *
   * A credential that is a *session* — Aeven's access token — is verified here
   * on every request and then needed a second time by a different subsystem:
   * the model route calls Aeven's own API on this caller's behalf. The caller is
   * the only holder of it, so the only way across is to publish it as it passes.
   * Doing that per request is also what keeps it fresh: the token rotates every
   * two hours and the browser re-sends the new one immediately, so nothing here
   * tracks expiry, schedules a refresh, or stores a copy that can go stale.
   *
   * An authority declares whether its credential is re-presentable at all, so a
   * launch token — which admits one browser and opens nothing else — is never
   * published anywhere.
   * @param request - a request {@link requestRejection} already admitted.
   */
  publishCallerCredential(request: ConnectionTrustRequest): void {
    const identity = this.ctx.get('identityUsers')
    if (identity === undefined) return
    // The authority declares whether its credential is re-presentable at all, so
    // a launch token — which admits one browser and opens nothing else — is never
    // published anywhere. One resolution per request decides both questions.
    const ref = identity.credentialRefFor(request)
    if (ref === undefined) return
    const user = identity.resolve(request)
    if (user === undefined) return
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) return
    const bearer = bearerOf(request)
    if (bearer === undefined) return
    // Optional capability: a provider without an in-memory layer simply cannot
    // hold a session credential, and says so by not implementing this. Keyed
    // by the caller, so clients signed in to different accounts never present
    // each other's session.
    credentials.setSession?.(ref, user.id, bearer)
  }

  /**
   * Identify the caller behind a request that {@link requestRejection} admitted.
   *
   * Separate from the rejection because the two answer different questions and
   * have different callers: every request is fenced, while only a connection
   * that outlives its upgrade needs to remember whose it is.
   * @param request - the incoming HTTP request or WebSocket upgrade.
   * @returns the authenticated user, or undefined when this harness
   * authenticates nobody.
   */
  identify(request: ConnectionTrustRequest): User | undefined {
    return this.ctx.get('identityUsers')?.resolve(request)
  }

  /**
   * Dispatch one admitted request with its caller as the acting user, so work it starts can attribute
   * durable state, such as a new session's owner, to that person.
   * @param request - a request {@link requestRejection} already admitted.
   * @param work - the request's dispatch.
   * @returns the dispatch result.
   */
  runAsCaller<T>(request: ConnectionTrustRequest, work: () => T): T {
    const identity = this.ctx.get('identityUsers')
    return identity === undefined ? work() : identity.runAsCaller(request, work)
  }

  /**
   * Decide whether the application index may be served.
   *
   * With an authority mounted the index is served to anyone: it carries no
   * data, and it is what presents the sign-in screen — refusing it would leave
   * a reader with nothing to sign in through. Every API route behind it stays
   * fenced by {@link requestRejection}.
   * @param request - root or configured-index HTTP request.
   * @param response - response owned when the result is false.
   * @returns true only when the frontend may serve index.html.
   */
  authorizeIndex(request: ConnectionIndexRequest, response: ConnectionIndexResponse): boolean {
    if (this.enforcingIdentity() !== undefined) return true
    return this.browserAuth.authorizeIndex(request, response)
  }

  /** Add this process's launch token to the clean application URL. */
  authenticatedUrl(baseUrl: string): string {
    // With an authority mounted the token grants nothing the sign-in screen
    // does not, and printing one invites a reader to treat a URL as a
    // credential — pasting it somewhere, or wondering why an ordinary address
    // does not work.
    if (this.enforcingIdentity() !== undefined) return baseUrl
    return this.browserAuth.authenticatedUrl(baseUrl)
  }

  /**
   * Compose one shared-channel Fetch handler from exact routes and its interceptor.
   * @param channel - shared channel mounted by Connection.
   * @returns Fetch handler that selects one owner or returns 404.
   */
  createSharedFetchHandler(
    channel: '/api',
  ): ConnectionFetchHandler {
    return {
      fetch: (request) => {
        const pathname = new URL(request.url).pathname
        const route = this.fetchRoutes.get(pathname)
        if (route?.methods.has(request.method) === true) return route.fetch(request)
        const endpoint = endpointFromPath(channel, pathname)
        const interceptor = this.interceptors.get(channel)
        if (endpoint === undefined || interceptor === undefined || !interceptor.matches(endpoint)) {
          return Promise.resolve(new Response('not found', { status: 404 }))
        }
        return interceptor.fetchHandler.fetch(request)
      },
    }
  }

  private registerFetchRoute(
    owner: Context,
    route: ConnectionFetchRoute,
  ): () => Promise<void> {
    assertFetchRoute(route)
    const registered: RegisteredFetchRoute = {
      methods: new Set(route.methods),
      fetch: route.fetch,
    }
    return owner.effect(() => {
      if (this.fetchRoutes.has(route.path)) {
        throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} is already registered`)
      }
      this.fetchRoutes.set(route.path, registered)
      return () => { this.fetchRoutes.delete(route.path) }
    }, `client-connection: ${route.path} Fetch route`)
  }

  private register(
    owner: Context,
    channel: string,
    handler: ConnectionRpcHandler,
  ): () => Promise<void> {
    assertChannel(channel)
    const fetchHandler = rpcFetchHandler(channel, handler)
    const route: WebRoute = {
      kind: 'prefix',
      path: channel,
      handler: async (req, res) => {
        const rejection = this.requestRejection(req)
        if (rejection !== undefined) {
          res.writeHead(rejection)
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        // Admitted, so whoever else needs this caller's credential can have the
        // one they just presented. Publishing before dispatch means the model
        // route reads the same token the request was authenticated with.
        this.publishCallerCredential(req)
        await this.runAsCaller(req, () => bridge(req, res, fetchHandler))
      },
    }
    const webServer = owner.get('webServer')
    if (webServer === undefined) throw new Error('connection: RPC channel registration requires webServer')
    return owner.effect(
      () => webServer.register(route),
      `client-connection: ${channel} rpc channel`,
    )
  }

  private registerInterceptor(
    owner: Context,
    channel: string,
    matches: ConnectionRpcEndpointMatcher,
    handler: ConnectionRpcHandler,
  ): () => Promise<void> {
    if (channel !== API_PATH) {
      throw new Error(`connection: invalid shared RPC channel ${JSON.stringify(channel)}`)
    }
    const interceptor: ConnectionRpcInterceptor = {
      matches,
      fetchHandler: rpcFetchHandler(channel, handler),
    }
    return owner.effect(() => {
      if (this.interceptors.has(channel)) {
        throw new Error(`connection: shared RPC channel ${JSON.stringify(channel)} already has an interceptor`)
      }
      this.interceptors.set(channel, interceptor)
      return () => {
        this.interceptors.delete(channel)
      }
    }, `client-connection: ${channel} rpc interceptor`)
  }
}

function rpcFetchHandler(
  channel: string,
  handler: ConnectionRpcHandler,
): FetchHandler {
  return {
    async fetch(request: Request): Promise<Response> {
      const endpoint = endpointFromPath(channel, new URL(request.url).pathname)
      if (request.method !== 'POST' || endpoint === undefined) {
        return new Response('not found', { status: 404 })
      }

      const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (mediaType !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 })
      }

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return new Response('body is not JSON', { status: 400 })
      }

      const envelope = clientRequestSchema.safeParse(body)
      if (!envelope.success) {
        return invalidEnvelopeResponse(body, envelope.error.issues)
      }
      const message: ClientRequest = envelope.data
      if (message.method !== endpoint) {
        return errorResponse(message.rpcId, {
          code: 'gateway/bad-request',
          message: `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
          details: { issues: [] },
        })
      }

      try {
        const result = await handler(endpoint, message.payload, request.signal)
        return fullResponse(message.rpcId, result)
      } catch (error) {
        return new Response(`handler failure: ${String(error)}`, { status: 500 })
      }
    },
  }
}

function invalidEnvelopeResponse(body: unknown, issues: readonly object[]): Response {
  const rawId = (body as { rpcId?: unknown } | null)?.rpcId
  const rpcId = typeof rawId === 'string' ? RpcId(rawId) : INVALID_REQUEST_RPC_ID
  return errorResponse(rpcId, {
    code: 'gateway/bad-request',
    message: 'invalid client-request message',
    details: { issues },
  })
}

function endpointFromPath(channel: string, pathname: string): string | undefined {
  if (!pathname.startsWith(`${channel}/`)) return undefined
  const endpoint = pathname.slice(channel.length + 1)
  const segments = endpoint.split('/')
  if (segments.some(segment =>
    segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
    return undefined
  }
  return endpoint
}

function errorResponse(rpcId: RpcIdType, error: ConnectionRpcFailure): Response {
  return fullResponse(rpcId, { ok: false, error })
}

function fullResponse(rpcId: RpcIdType, result: ConnectionRpcResult<unknown>): Response {
  const body: ConnectionServerResponse = { type: 'server-response', rpcId, result }
  return Response.json(body)
}

function assertChannel(channel: string): void {
  if (!CHANNEL_PATTERN.test(channel) || channel === '/api') {
    throw new Error(`connection: invalid or reserved RPC channel ${JSON.stringify(channel)}`)
  }
}

function assertFetchRoute(route: ConnectionFetchRoute): void {
  if (endpointFromPath(API_PATH, route.path) === undefined) {
    throw new Error(`connection: invalid exact Fetch route ${JSON.stringify(route.path)}`)
  }
  if (route.methods.length === 0) {
    throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} declares no methods`)
  }
  const methods = new Set(route.methods)
  if (methods.size !== route.methods.length) {
    throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} repeats a method`)
  }
}
