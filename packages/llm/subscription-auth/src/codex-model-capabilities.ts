/**
 * Live Codex model service-tier cache and composable fast-route payload helpers.
 *
 * Fetches `GET /backend-api/codex/models?client_version=…`, caches `service_tiers`,
 * and never invents eligibility when the live catalog is missing or stale.
 * A stale TTL is unknown: Fast is default-deny until a live, non-stale catalog
 * explicitly lists `priority` for that model. `isEligible` is required and
 * fail-closed — omitting it or returning false injects nothing.
 *
 * Ordinary inference stays unchanged: the unwrapped provider is never mutated.
 * A wrapper may use a distinct profile provider id (`codex-oauth-fast`) while
 * restoring native `model.provider` for the base wire call and the same catalog.
 *
 * @module @aeven/subscription-auth/codex-model-capabilities
 */

import {
  type CodexAuthSession,
  type CodexFetch,
  type CodexHttpClient,
  isRecord,
  optionalNonEmptyString,
  resolveCodexHttpClient,
} from './codex-http.ts'
import { CODEX_OAUTH_FAST_ROUTE } from './ids.ts'

/** Distinct optional Aeven route; parent owns dynamic registration. */
export { CODEX_OAUTH_FAST_ROUTE }

/** Codex models url. */
export const CODEX_MODELS_URL = 'https://chatgpt.com/backend-api/codex/models'
/** Default codex client version. */
export const DEFAULT_CODEX_CLIENT_VERSION = '0.144.0'
/** Default codex service tier. */
export const DEFAULT_CODEX_SERVICE_TIER = 'priority'
/** HTTP header name for codex routing hint. */
export const CODEX_ROUTING_HINT_HEADER = 'x-codex-routing-hint'

const DEFAULT_TTL_MS = 15 * 60 * 1000

/** Codex model capability. */
export interface CodexModelCapability {
  readonly id: string
  readonly serviceTiers: readonly string[]
  /** Display name, when the listing states one. */
  readonly name?: string
  /** Codex lists this model for its own picker; a hidden model is not offered. */
  readonly listed: boolean
  /** Whether the model reads images, when the listing states its input modalities. */
  readonly imageInput?: boolean
}

/** Options for codex model capabilities. */
export interface CodexModelCapabilitiesOptions {
  readonly auth: CodexAuthSession
  readonly http?: CodexHttpClient
  readonly fetchImpl?: CodexFetch
  readonly clientVersion?: string
  readonly originator?: string
  readonly userAgent?: string
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  readonly now?: () => number
  readonly ttlMs?: number
}

/** Codex model capabilities. */
export interface CodexModelCapabilities {
  refresh(signal?: AbortSignal): Promise<readonly CodexModelCapability[]>
  clear(): void
  getCached(): readonly CodexModelCapability[] | undefined
  serviceTiers(modelId: string): readonly string[]
  isPriorityEligible(modelId: string): boolean
  isTierEligible(modelId: string, tier: string): boolean
}

/** Codex on payload. */
export type CodexOnPayload = (payload: unknown, model: unknown) => unknown

/** Options for codex fast stream. */
export interface CodexFastStreamOptions {
  onPayload?: CodexOnPayload
  headers?: Record<string, string | null>
  [key: string]: unknown
}

/**
 * Fast-route composition is default-deny.
 * `isEligible` is required; missing or false means no header and no `service_tier`.
 */
export interface CodexFastRoutingOptions {
  readonly isEligible: (modelId: string) => boolean
  readonly serviceTier?: string
  /** Distinct profile/route id for the wrapper (e.g. {@link CODEX_OAUTH_FAST_ROUTE}). */
  readonly profileProviderId?: string
  /** Native provider id restored on `model.provider` before the base wire call. */
  readonly nativeProviderId?: string
}

/** Codex stream model. */
export interface CodexStreamModel {
  readonly id: string
  readonly provider?: string
  readonly [key: string]: unknown
}

/** Structural pi-ai provider face; `never` parameters keep native Provider assignable. */
export interface CodexStreamableProvider {
  readonly id: string
  readonly headers?: Record<string, string | null>
  stream: (model: never, context: never, options?: never) => unknown
  streamSimple: (model: never, context: never, options?: never) => unknown
}

/** Wrapper face with callable stream methods and a possibly distinct profile id. */
export type CodexFastWrappedProvider<P extends CodexStreamableProvider> = Omit<
  P,
	'id' | 'headers' | 'stream' | 'streamSimple'
> & {
  readonly id: string
  readonly headers?: Record<string, string | null>
  stream: (model: CodexStreamModel, context: unknown, options?: CodexFastStreamOptions) => unknown
  streamSimple: (model: CodexStreamModel, context: unknown, options?: CodexFastStreamOptions) => unknown
}

function parseServiceTiers(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const tiers: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const id =
      typeof item === 'string'
        ? optionalNonEmptyString(item)
        : isRecord(item)
          ? optionalNonEmptyString(item['id'])
          : undefined
    if (id === undefined || seen.has(id)) continue
    seen.add(id)
    tiers.push(id)
  }
  return tiers
}

/**
 * Parse the live models envelope. Unknown shapes yield an empty catalog, never a hardcoded fallback.
 * @param value - Value to process.
 * @returns The parsed codex model capabilities.
 */
export function parseCodexModelCapabilities(value: unknown): CodexModelCapability[] {
  if (!isRecord(value)) return []
  const raw = value['models']
  if (!Array.isArray(raw)) return []
  const models: CodexModelCapability[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!isRecord(item)) continue
    const id = optionalNonEmptyString(item['slug']) ?? optionalNonEmptyString(item['id'])
    if (id === undefined || seen.has(id)) continue
    seen.add(id)
    const name = optionalNonEmptyString(item['display_name'])
    const modalities = Array.isArray(item['input_modalities']) ? item['input_modalities'] : undefined
    models.push({
      id,
      serviceTiers: parseServiceTiers(item['service_tiers']),
      listed: item['visibility'] !== 'hide' && item['visibility'] !== 'hidden',
      ...(name === undefined ? {} : { name }),
      ...(modalities === undefined ? {} : { imageInput: modalities.includes('image') }),
    })
  }
  return models
}

/**
 * Codex models url.
 * @param clientVersion - Client version value.
 * @returns The resulting codex models url.
 */
export function codexModelsUrl(clientVersion: string): string {
  const url = new URL(CODEX_MODELS_URL)
  url.searchParams.set('client_version', clientVersion)
  return url.toString()
}

/**
 * Exact per-model Fast header value. Never a bare static `priority`.
 * @param modelId - Model id value.
 * @param tier - Tier value.
 * @returns The resulting codex routing hint.
 */
export function codexRoutingHint(modelId: string, tier = DEFAULT_CODEX_SERVICE_TIER): string {
  return `model=${modelId};tier=${tier}`
}

function modelIdOf(payload: Record<string, unknown>, model: unknown): string | undefined {
  if (isRecord(model)) {
    const id = optionalNonEmptyString(model['id'])
    if (id !== undefined) return id
  }
  return optionalNonEmptyString(payload['model'])
}

function isFastEligible(options: CodexFastRoutingOptions | undefined, modelId: string): boolean {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- both members are optional at call sites
  return options?.isEligible?.(modelId) === true
}

function restoreNativeProvider(model: CodexStreamModel, nativeProviderId: string): CodexStreamModel {
  if (model.provider === nativeProviderId) return model
  return { ...model, provider: nativeProviderId }
}

/**
 * Compose an existing `onPayload` with service_tier injection.
 * Does not override a payload that already set `service_tier`.
 * Fail-closed: injection happens only when `isEligible(modelId)` is exactly true.
 * @param inner - Inner value.
 * @param options - Operation options.
 * @returns The resulting compose codex fast on payload.
 */
export function composeCodexFastOnPayload(
  inner: CodexOnPayload | undefined,
  options: CodexFastRoutingOptions,
): CodexOnPayload {
  const serviceTier = options.serviceTier ?? DEFAULT_CODEX_SERVICE_TIER
  return async (payload, model) => {
    const next = inner === undefined ? payload : await inner(payload, model)
    const body = next === undefined ? payload : next
    if (!isRecord(body)) return next
    const modelId = modelIdOf(body, model)
    if (modelId === undefined || !isFastEligible(options, modelId)) return next
    if (optionalNonEmptyString(body['service_tier']) !== undefined) return next
    return { ...body, service_tier: serviceTier }
  }
}

/**
 * Merge `x-codex-routing-hint=model=<slug>;tier=<tier>` without dropping existing keys.
 * @param headers - Headers value.
 * @param modelId - Model id value.
 * @param tier - Tier value.
 * @returns The resulting compose codex fast headers.
 */
export function composeCodexFastHeaders(
  headers: Record<string, string | null> | undefined,
  modelId: string,
  tier = DEFAULT_CODEX_SERVICE_TIER,
): Record<string, string | null> {
  return { ...(headers ?? {}), [CODEX_ROUTING_HINT_HEADER]: codexRoutingHint(modelId, tier) }
}

/**
 * Apply fast-route payload + per-model header composition to one stream-options object.
 * @param options - Operation options.
 * @param config - Validated configuration.
 * @param modelId - Model id value.
 * @returns The resulting apply codex fast stream options.
 */
export function applyCodexFastStreamOptions<T extends CodexFastStreamOptions>(
  options: T | undefined,
  config: CodexFastRoutingOptions,
  modelId: string,
): T {
  const eligible = isFastEligible(config, modelId)
  const tier = config.serviceTier ?? DEFAULT_CODEX_SERVICE_TIER
  const onPayload = eligible
    ? composeCodexFastOnPayload(options?.onPayload, { ...config, isEligible: () => true })
    : options?.onPayload
  const next: CodexFastStreamOptions = {
    ...(options ?? {}),
    ...(onPayload === undefined ? {} : { onPayload }),
    headers: eligible ? composeCodexFastHeaders(options?.headers, modelId, tier) : { ...(options?.headers ?? {}) },
  }
  return next as T
}

/**
 * Wrap a pi-ai provider for a future `codex-oauth-fast` route.
 * The original provider object is not mutated. The wrapper may advertise a
 * distinct profile provider id while restoring native `model.provider` so the
 * base wire call and model catalog stay on the native provider.
 * @param provider - Provider used by the operation.
 * @param options - Operation options.
 * @returns The resulting with codex fast routing.
 */
export function withCodexFastRouting<P extends CodexStreamableProvider>(
  provider: P,
  options: CodexFastRoutingOptions,
): CodexFastWrappedProvider<P> {
  const nativeProviderId = options.nativeProviderId ?? provider.id
  const profileProviderId = options.profileProviderId ?? provider.id

  const forward =
    (method: 'stream' | 'streamSimple') =>
      (model: CodexStreamModel, context: unknown, streamOptions?: CodexFastStreamOptions) => {
        const wireModel = restoreNativeProvider(model, nativeProviderId)
        return provider[method](
          wireModel as never,
          context as never,
          applyCodexFastStreamOptions(streamOptions, options, model.id) as never,
        )
      }

  return {
    ...provider,
    id: profileProviderId,
    stream: forward('stream'),
    streamSimple: forward('streamSimple'),
  }
}

/**
 * Live `/codex/models` cache. Fetch failures leave ordinary inference alone.
 * Eligibility is false until a live, non-stale catalog explicitly lists the tier.
 * A stale TTL is treated as unknown, not as the last known catalog.
 * @param options - Operation options.
 * @returns The created codex model capabilities.
 */
export function createCodexModelCapabilities(options: CodexModelCapabilitiesOptions): CodexModelCapabilities {
  const http = resolveCodexHttpClient(options)
  const clientVersion = options.clientVersion ?? DEFAULT_CODEX_CLIENT_VERSION
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  let cached: { fetchedAt: number; models: readonly CodexModelCapability[] } | undefined
  let inFlight: Promise<readonly CodexModelCapability[]> | undefined
  let epoch = 0

  const isFresh = (): boolean => cached !== undefined && now() - cached.fetchedAt < ttlMs

  const freshModels = (): readonly CodexModelCapability[] | undefined => (isFresh() ? cached?.models : undefined)

  const lookup = (modelId: string): CodexModelCapability | undefined =>
    freshModels()?.find(model => model.id === modelId)

  const load = async (startedEpoch: number, signal?: AbortSignal): Promise<readonly CodexModelCapability[]> => {
    try {
      const payload = await http.requestJson({
        url: codexModelsUrl(clientVersion),
        method: 'GET',
        headers: { 'cache-control': 'no-store' },
        ...(signal === undefined ? {} : { signal }),
      })
      const models = parseCodexModelCapabilities(payload)
      if (startedEpoch === epoch) cached = { fetchedAt: now(), models }
      return models
    } catch {
      return freshModels() ?? []
    }
  }

  return {
    async refresh(signal) {
      if (isFresh() && cached !== undefined) return cached.models
      if (inFlight !== undefined) return inFlight
      const startedEpoch = epoch
      const current = load(startedEpoch, signal).finally(() => {
        if (inFlight === current) inFlight = undefined
      })
      inFlight = current
      return current
    },
    clear() {
      epoch += 1
      cached = undefined
      inFlight = undefined
    },
    getCached: () => freshModels(),
    serviceTiers: modelId => lookup(modelId)?.serviceTiers ?? [],
    isPriorityEligible: modelId => lookup(modelId)?.serviceTiers.includes(DEFAULT_CODEX_SERVICE_TIER) === true,
    isTierEligible: (modelId, tier) => lookup(modelId)?.serviceTiers.includes(tier) === true,
  }
}
