/**
 * Plugin-owned same-origin Web routes for the capability-settings namespace.
 * Arbitrary Host settings namespaces are not remotely exposed, so this plugin
 * publishes only the secret-free snapshot and the two optional read surfaces.
 * @module @aeven/experimental-subscription-auth/capability-routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  assertCapabilitySettingsPatch,
  type CapabilitySettingsPatch,
  type CapabilitySettingsSnapshot,
  isCapabilitySettingsConflictError,
  isCapabilitySettingsReadOnlyError,
  isPlainObject,
  normalizeCapabilitySettingsPatch,
} from './capability-settings.ts'
import { readJsonRequest, requestErrorStatus } from './http-json.ts'
import {
  CAPABILITY_SETTINGS_PATH,
  CODEX_USAGE_PATH,
  IMAGINE_CREDENTIAL_STATUS_PATH,
  SUBSCRIPTION_USAGE_PATH_PREFIX,
  SUBSCRIPTION_USAGE_ROUTE,
} from './ids.ts'
import { safeMessage } from './redact.ts'
import { LOOPBACK_OWNER_REQUEST_POLICY, type OwnerRequestPolicy } from './web-origin.ts'
import { registerWebRouteSetupAtomically } from './web-routes.ts'

export {
  CAPABILITY_SETTINGS_PATH,
  CODEX_USAGE_PATH,
  IMAGINE_CREDENTIAL_STATUS_PATH,
  SUBSCRIPTION_USAGE_PATH_PREFIX,
  SUBSCRIPTION_USAGE_ROUTE,
} from './ids.ts'

/**
 * What the route needs of a usage reader: one already-projected answer. The
 * route neither inspects nor reshapes it, so the reader owns the projection.
 */
export interface UsageRouteReader {
  /**
   * Read the provider's usage.
   * @param options - `force` skips the reader's cache and reads the provider again.
   * @returns the projected usage answer.
   */
  read(options?: { force?: boolean }): Promise<unknown>
}

/** Structural `ctx.webServer` + `ctx.effect` surface used by the registrar. */
export interface CapabilityRouteContext {
  readonly webServer: {
    register(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
    }): () => void
  }
  effect(callback: () => () => void | Promise<void>, label?: string): unknown
}

/** Owner-facing subset of {@link import("./capability-settings.ts").CapabilitySettingsController}. */
export interface CapabilityRouteController {
  snapshot(): CapabilitySettingsSnapshot
  patch(patch: CapabilitySettingsPatch, expectedRevision: number): Promise<CapabilitySettingsSnapshot>
  replace(section: CapabilitySettingsPatch, expectedRevision: number): Promise<CapabilitySettingsSnapshot>
}

/** Secret-free Imagine credential probe returned on the optional status route. */
export interface ImagineCredentialStatus {
  readonly configured: boolean
  readonly source: string
  readonly writable: boolean
}

/** Options for capability route. */
export interface CapabilityRouteOptions {
  readonly controller: CapabilityRouteController
  /**
	 * Usage readers by provider slug. Usage is not a capability toggle: an
	 * account that cannot use a provider still needs to be told so, which is
	 * exactly what the reader answers.
	 */
  readonly usageReaders?: Readonly<Record<string, UsageRouteReader>>
  readonly credentialInfo?: () => unknown
  readonly ownerRequestPolicy?: OwnerRequestPolicy
}

class CapabilityRouteRequestError extends Error {
  readonly statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'CapabilityRouteRequestError'
    this.statusCode = statusCode
  }
}

/**
 * Register the plugin-owned capability routes. Owns and returns the route disposer.
 * @param ctx - Cordis context that owns the registration.
 * @param options - Operation options.
 * @returns A disposer that removes the registration.
 */
export function registerCapabilityRoutes(ctx: CapabilityRouteContext, options: CapabilityRouteOptions): () => void {
  const { controller, usageReaders, credentialInfo } = options
  const ownerRequestPolicy = options.ownerRequestPolicy ?? LOOPBACK_OWNER_REQUEST_POLICY
  let dispose = (): void => undefined
  ctx.effect(() => {
    dispose = registerWebRouteSetupAtomically(ctx.webServer, (webServer) => {
      webServer.register({
        kind: 'exact',
        path: CAPABILITY_SETTINGS_PATH,
        handler: (req, res) => handleCapabilities(req, res, controller, ownerRequestPolicy),
      })
      if (usageReaders !== undefined) {
        webServer.register({
          kind: 'prefix',
          path: SUBSCRIPTION_USAGE_ROUTE,
          handler: (req, res) => handleUsage(req, res, usageReaders, ownerRequestPolicy),
        })
        // The pre-rename single-provider path stays served so an existing
        // caller of the documented Codex route keeps working.
        webServer.register({
          kind: 'exact',
          path: CODEX_USAGE_PATH,
          handler: (req, res) => handleUsage(req, res, usageReaders, ownerRequestPolicy, 'codex'),
        })
      }
      if (credentialInfo !== undefined) {
        webServer.register({
          kind: 'exact',
          path: IMAGINE_CREDENTIAL_STATUS_PATH,
          handler: (req, res) => handleCredentialStatus(req, res, credentialInfo, ownerRequestPolicy),
        })
      }
    })
    return dispose
  }, 'avn-subscription-auth: capability routes')
  return () =>{  dispose() }
}

async function handleCapabilities(
  req: IncomingMessage,
  res: ServerResponse,
  controller: CapabilityRouteController,
  ownerRequestPolicy: OwnerRequestPolicy,
): Promise<void> {
  const method = req.method ?? ''
  if (method !== 'GET' && method !== 'PATCH' && method !== 'PUT') {
    json(res, 405, { error: 'method not allowed' })
    return
  }
  if (!ownerRequestPolicy.authorize(req).authorized) {
    json(res, 403, { error: 'forbidden' })
    return
  }
  try {
    if (method === 'GET') {
      json(res, 200, controller.snapshot())
      return
    }
    const body = await readJsonRequest(req)
    if (method === 'PATCH') {
      const { expectedRevision, payload } = readWriteEnvelope(body, 'patch')
      json(res, 200, await controller.patch(admitCapabilitySection(payload, 'patch'), expectedRevision))
      return
    }
    const { expectedRevision, payload } = readWriteEnvelope(body, 'value')
    json(res, 200, await controller.replace(admitCapabilitySection(payload, 'value'), expectedRevision))
  } catch (error: unknown) {
    const status = statusFor(error)
    json(res, status, errorBody(error, status))
  }
}

/** Read the provider slug out of a prefix-routed usage request. */
function usageSlugOf(req: IncomingMessage): string | undefined {
  /* v8 ignore next -- split() always yields at least one element, so index 0 is never nullish */
  const path = (req.url ?? '').split('?')[0] ?? ''
  if (!path.startsWith(SUBSCRIPTION_USAGE_PATH_PREFIX)) return undefined
  const slug = decodeURIComponent(path.slice(SUBSCRIPTION_USAGE_PATH_PREFIX.length))
  return /^[a-z0-9-]{1,32}$/u.test(slug) ? slug : undefined
}

async function handleUsage(
  req: IncomingMessage,
  res: ServerResponse,
  readers: Readonly<Record<string, UsageRouteReader>>,
  ownerRequestPolicy: OwnerRequestPolicy,
  fixedSlug?: string,
): Promise<void> {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'method not allowed' })
    return
  }
  if (!ownerRequestPolicy.authorize(req).authorized) {
    json(res, 403, { error: 'forbidden' })
    return
  }
  const slug = fixedSlug ?? usageSlugOf(req)
  if (slug === undefined) {
    json(res, 404, { error: 'unknown usage provider' })
    return
  }
  const reader = readers[slug]
  if (reader === undefined) {
    json(res, 404, { error: 'unknown usage provider' })
    return
  }
  try {
    // `?refresh=1` is the viewer's explicit re-read; every other read may be served from cache.
    const force = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('refresh') === '1'
    json(res, 200, await reader.read({ force }))
  } catch (error: unknown) {
    const status = statusFor(error)
    json(res, status, errorBody(error, status))
  }
}

async function handleCredentialStatus(
  req: IncomingMessage,
  res: ServerResponse,
  credentialInfo: () => unknown,
  ownerRequestPolicy: OwnerRequestPolicy,
): Promise<void> {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'method not allowed' })
    return
  }
  if (!ownerRequestPolicy.authorize(req).authorized) {
    json(res, 403, { error: 'forbidden' })
    return
  }
  try {
    json(res, 200, publicCredentialStatus(await credentialInfo()))
  } catch (error: unknown) {
    const status = statusFor(error)
    json(res, status, errorBody(error, status))
  }
}

function readWriteEnvelope(
  body: unknown,
  payloadKey: 'patch' | 'value',
): { expectedRevision: number; payload: Record<string, unknown> } {
  if (!isPlainObject(body)) {
    throw new CapabilityRouteRequestError(400, 'request body must be a JSON object')
  }
  const expectedRevision = body['expectedRevision']
  if (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new CapabilityRouteRequestError(400, 'expectedRevision must be a nonnegative integer')
  }
  const payload = body[payloadKey]
  if (!isPlainObject(payload)) {
    throw new CapabilityRouteRequestError(400, `${payloadKey} must be a JSON object`)
  }
  return { expectedRevision, payload }
}

/** Admit a wire section without silently coercing, truncating, or clamping it. */
function admitCapabilitySection(input: Record<string, unknown>, label: string): CapabilitySettingsPatch {
  try {
    assertCapabilitySettingsPatch(input, label)
  } catch (error) {
    throw new CapabilityRouteRequestError(400, safeMessage(error))
  }
  return normalizeCapabilitySettingsPatch(input)
}

function publicCredentialStatus(info: unknown): ImagineCredentialStatus {
  const record = isPlainObject(info) ? info : {}
  const source = record['source']
  return {
    configured: record['configured'] === true,
    source: typeof source === 'string' && source.length <= 40 && /^[a-z0-9._-]+$/iu.test(source) ? source : 'unknown',
    writable: record['writable'] === true,
  }
}

function statusFor(error: unknown): number {
  if (error instanceof CapabilityRouteRequestError) return error.statusCode
  const jsonStatus = requestErrorStatus(error, 0)
  if (jsonStatus !== 0) return jsonStatus
  if (conflictInfo(error) !== undefined) return 409
  if (isCapabilitySettingsReadOnlyError(error)) {
    return error.reason === 'read-only' ? 403 : 503
  }
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code
    if (code === 'SETTINGS_READ_ONLY') return 403
    if (code === 'SETTINGS_PROVIDER_ABSENT' || code === 'SETTINGS_DISPOSED') return 503
  }
  if (error instanceof TypeError) return 400
  return 500
}

function errorBody(error: unknown, status: number): Record<string, unknown> {
  const body: Record<string, unknown> = { error: status >= 500 ? 'request failed' : safeMessage(error) }
  const conflict = conflictInfo(error)
  if (conflict !== undefined) {
    body['code'] = 'SETTINGS_CONFLICT'
    body['expected'] = conflict.expected
    body['actual'] = conflict.actual
    return body
  }
  if (isCapabilitySettingsReadOnlyError(error)) {
    body['code'] = error.code
  }
  return body
}

function conflictInfo(error: unknown): { expected: number; actual: number } | undefined {
  if (isCapabilitySettingsConflictError(error)) {
    return { expected: error.expected, actual: error.actual }
  }
  if (typeof error !== 'object' || error === null) return undefined
  const candidate = error as { code?: unknown; expected?: unknown; actual?: unknown }
  if (candidate.code !== 'SETTINGS_CONFLICT') return undefined
  if (typeof candidate.expected !== 'number' || typeof candidate.actual !== 'number') return undefined
  return { expected: candidate.expected, actual: candidate.actual }
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}
