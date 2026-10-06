/**
 * Configuration schema and provider-profile validation for the pi-ai adapter.
 * Profiles are a dict keyed by provider route, so the composition base and a
 * user-settings layer merge per provider and the route set is structural.
 *
 * A route key is not required to name an installed pi-ai provider. When it does,
 * that provider's endpoint, protocol, display name, and model catalog are the
 * profile's defaults and the profile overrides them field by field; when it does
 * not, the profile is the whole provider declaration. Resolution therefore ends
 * in a built pi-ai `Provider` per route: everything a request needs is decided
 * once, while the configuration key that made a route unserviceable can still be
 * named in the failure.
 *
 * @module avn-llm-pi-ai/config
 */

import type {
  Api, CacheRetention, ChatTemplateKwargValue, Model, ModelThinkingLevel, Provider, ThinkingBudgets, Transport,
} from '@earendil-works/pi-ai'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@aeven/credentials'
import type { CredentialRef } from '@aeven/credentials'
import { MAX_TIMER_DELAY_MS } from '@aeven/timeout'
import { resolveRetryPolicy, RetryPolicySchema } from '@aeven/llm'
import type { ResolvedRetryPolicy, RetryPolicyConfig } from '@aeven/llm'
import {
  CACHE_CONTROL_FORMATS,
  catalogProvider,
  CHAT_TEMPLATE_VARS,
  MAX_TOKENS_FIELDS,
  MODALITIES,
  resolveRouteModels,
  SUPPORTED_THINKING_FORMATS,
  THINKING_LEVELS,
} from './catalog.ts'
import { LIVE_CATALOG_FORMATS } from './live-catalog.ts'
import type { LiveCatalogFormat } from './live-catalog.ts'
import type {
  PiAiCatalogRefresh,
  PiAiCompatProfile,
  PiAiModality,
  PiAiModelOverride,
  PiAiModelProfile,
  PiAiReasoningEfforts,
} from './catalog.ts'
import { knownRoute } from './known-routes.ts'
import { buildProvider, supportedProtocols } from './provider.ts'

/** Default maximum idle interval while an adapter stream read is outstanding. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000

/** Default wait for a route's live model-document request. */
export const DEFAULT_CATALOG_REFRESH_TIMEOUT_MS = 10_000

/** Published layout assumed by a refresh that names no format. */
export const DEFAULT_CATALOG_REFRESH_FORMAT: LiveCatalogFormat = 'openrouter'

/**
 * Default request-level bound on base64-encoded image payload. Every image in
 * history is re-encoded into every request body, so an unbounded conversation
 * eventually exceeds a provider or gateway request-size cap and the session
 * can never complete another request. The 20MiB default admits fifteen 1MiB
 * request versions after base64 expansion and reserves request capacity for
 * system prompts, history, tools, and JSON.
 * Deployments behind stricter gateways lower it per route.
 */
export const DEFAULT_MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024
/** Default total-pixel budget preserves the complete 2048px normalized attachment. */
export const DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048
/** Default raw encoded-byte target before inline base64 expansion; the smallest quality-ladder output is used when no quality fits. */
export const DEFAULT_REQUEST_IMAGE_MAX_BYTES = 1024 * 1024

/** Context capacity assumed for a model neither configuration nor the catalog sizes. */
export const DEFAULT_CONTEXT_WINDOW = 262_144

/** Output capability assumed for a model neither configuration nor the catalog sizes. */
export const DEFAULT_MAX_TOKENS = 32_768

/**
 * Modalities assumed for a model neither configuration nor the catalog
 * declares. Text is the floor every supported protocol certainly carries, so
 * this is the absence of a declaration rather than a guess at the endpoint:
 * nothing can interrogate a gateway for its modalities, and the two wrong
 * answers do not cost the same. Under-claiming refuses the image before it is
 * attached, naming the model. Over-claiming admits one the provider then
 * rejects mid-turn, after the message is durable, leaving the session
 * repeating a request that cannot succeed.
 */
export const DEFAULT_INPUT: readonly PiAiModality[] = ['text']

export type {
  PiAiCompatProfile,
  PiAiModality,
  PiAiModelOverride,
  PiAiModelProfile,
  PiAiReasoningEfforts,
  PiAiThinkingFormat,
} from './catalog.ts'

/** Configuration for one pi-ai provider route; the `providers` dict key IS the route. */
export interface PiAiProviderProfile {
  /** Credential reference (environment-variable name) resolved per request through `ctx.credentials`. */
  apiKeyEnv?: string
  /** Name shown by configuration surfaces; defaults to the route key. */
  displayName?: string
  /**
   * Wire protocol every model on this route speaks. Omission keeps each
   * installed catalog model's own protocol, which is why a catalog route needs
   * no protocol at all; a route the catalog does not ship must name one.
   */
  api?: string
  /** Endpoint for this route's models; defaults to the installed catalog's endpoint. */
  baseURL?: string
  /**
   * This route's model catalog. Omission serves the installed catalog for the
   * route unchanged; an explicit list replaces it, each entry defaulting its
   * unset fields from the installed model of the same id.
   */
  models?: PiAiModelProfile[]
  /**
   * Installed-catalog customizations by model id: each entry reshapes that
   * one model with the same fields a {@link models} entry takes, while the
   * rest of the catalog keeps serving untouched. Only meaningful on a catalog
   * route with no `models` list — `models` already replaces the catalog, so
   * an override beside it, on a route the catalog does not ship, or naming a
   * model the catalog does not describe is refused rather than skipped.
   */
  modelOverrides?: Record<string, PiAiModelOverride>
  /**
   * Live model-list refresh for a route whose provider publishes an
   * OpenRouter-style `GET /models` document. Absent, the route serves the
   * installed pi-ai snapshot alone, which lags whatever the provider
   * currently lists.
   *
   * The refresh is additive: it adds the published models the snapshot does
   * not describe and never rewrites one it does, because the snapshot carries
   * tuned reasoning and compatibility values the document does not express.
   * A failed or slow refresh leaves the route serving the snapshot.
   */
  catalogRefresh?: PiAiCatalogRefresh
  /**
   * pi-ai wire-compatibility switches defaulting every model on this route
   * whose protocol declares them; each model's own `compat` overrides per
   * field. What neither sets keeps the installed catalog entry's value, then
   * pi-ai's own detection. A switch no model on the route could read is
   * refused rather than left looking applied.
   */
  compat?: PiAiCompatProfile
  /**
   * Context capacity for a model this route lists that neither the entry nor
   * the installed catalog sizes (default 262,144). A guess by construction, so
   * a deployment whose gateway serves smaller models corrects it here.
   */
  defaultContextWindow?: number
  /**
   * Output capability for a model this route lists that neither the entry nor
   * the installed catalog sizes (default 32,768). This sizes the model; it
   * never becomes a per-request cap on its own.
   */
  defaultMaxTokens?: number
  /**
   * Request modalities for a model this route lists that neither its entry's
   * {@link PiAiModelProfile.input} nor the installed catalog declares (default
   * `[text]`). A fallback like the capacities above, not an override: a
   * catalog model keeps the modalities the catalog records for it, and this
   * value never narrows one. A gateway serving vision models the catalog does
   * not describe declares `[text, image]` once here instead of on every entry.
   * Unlike an entry's list, this one may not be empty — nothing sits below it
   * to answer instead.
   */
  defaultInput?: PiAiModality[]
  /** Provider request headers, validated against Fetch when the profile resolves; Aeven attribution wins reserved names. */
  headers?: Record<string, string>
  /** Provider-neutral pi-ai reasoning level. */
  reasoning?: ModelThinkingLevel
  /** Token budgets used by reasoning providers that support them. */
  thinkingBudgets?: ThinkingBudgets
  /** Prompt-cache retention preference. */
  cacheRetention?: CacheRetention
  /** Streaming transport preference. */
  transport?: Transport
  /** HTTP/provider SDK timeout in milliseconds. */
  timeoutMs?: number
  /** WebSocket connection timeout in milliseconds. */
  websocketConnectTimeoutMs?: number
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs?: number
  /**
   * Maximum base64-encoded image payload per request. When a request's
   * accumulated images exceed it, the oldest images are replaced by text
   * placeholders until the request fits, so a long session keeps completing
   * requests instead of being rejected by a request-size cap.
   */
  maxRequestImageBytes?: number
  /** Total-pixel budget for each deterministic inline request version. */
  requestImagePixelBudget?: number
  /**
   * Raw encoded-byte target for each deterministic inline request version;
   * the smallest quality-ladder output is used when no quality fits.
   */
  requestImageMaxBytes?: number
  /** Provider-owned model-request retry policy; omission uses normal mode with five retries. */
  retryPolicy?: RetryPolicyConfig
}

/** One route's live refresh after resolution: the endpoint it names and the wait it gets. */
export interface ResolvedPiAiCatalogRefresh {
  /** Absolute URL of the provider's model document. */
  url: string
  /** Published layout of that document. */
  format: LiveCatalogFormat
  /** Capability tags an entry must carry to be added; empty accepts every entry. */
  requireTags: readonly string[]
  /** Abort the request after this many milliseconds. */
  timeoutMs: number
  /** Context window for an added model the document does not size. */
  defaultContextWindow: number
  /** Output cap for an added model the document does not size. */
  defaultMaxTokens: number
}

/** Validated profile with its route stamped and every adapter-owned default resolved. */
export interface ResolvedPiAiProviderProfile
  extends Omit<PiAiProviderProfile, 'apiKeyEnv' | 'retryPolicy' | 'models' | 'displayName' | 'catalogRefresh'> {
  /** Live model-list refresh this route configured, with its timeout defaulted; absent when it configured none. */
  catalogRefresh?: ResolvedPiAiCatalogRefresh
  /** Aeven route key and the `Models` collection key (the configuration dict key). */
  provider: string
  /** Resolved display name for selectors and configuration surfaces. */
  displayName: string
  /** Validated credential reference, when one is configured. */
  apiKeyEnv?: CredentialRef
  /** Positive finite provider-idle interval after defaulting. */
  streamIdleTimeoutMs: number
  /** Positive request-level base64 image payload bound after defaulting. */
  maxRequestImageBytes: number
  /** Positive total-pixel request-version budget after defaulting. */
  requestImagePixelBudget: number
  /** Positive raw request-version byte target after defaulting; the smallest quality-ladder output is used when no quality fits. */
  requestImageMaxBytes: number
  /** Immutable retry policy captured with this provider route. */
  retryPolicy: ResolvedRetryPolicy
  /**
   * The pi-ai provider this route registers, built from the resolved models.
   * Construction happens here so an unserviceable protocol or an underspecified
   * model fails with the rest of resolution, leaving the last good route set
   * serving requests.
   */
  piProvider: Provider
  /**
   * Per-request output caps this profile explicitly configured, by model id.
   * The seam materializes one only into a request that names no cap of its
   * own, so a catalog capability must not appear here.
   */
  configuredMaxTokens: ReadonlyMap<string, number>
}

/** Plugin configuration: the provider routes this instance owns. */
export interface Config {
  /**
   * pi-ai provider routes, keyed by provider. An empty (or omitted) dict is
   * the dormant settings-driven posture: the adapter mounts with no routes
   * and registers them the moment a settings section supplies profiles.
   */
  providers?: Record<string, PiAiProviderProfile>
}

const thinkingBudgets = z.object({
  minimal: z.number(),
  low: z.number(),
  medium: z.number(),
  high: z.number(),
})

/**
 * One `chat_template_kwargs` or `chat_template_args` value. The `$var` member
 * is pi-ai's placeholder for a value dispatch fills from the request's
 * thinking state, which makes a template-driven gateway configurable without
 * restating its template.
 */
const chatTemplateKwarg: z<ChatTemplateKwargValue> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.const(null),
  z.object({
    $var: z.union(CHAT_TEMPLATE_VARS).required(),
    omitWhenOff: z.boolean(),
  }),
])

const compatProfile: z<PiAiCompatProfile> = z.object({
  supportsStore: z.boolean(),
  supportsDeveloperRole: z.boolean(),
  supportsReasoningEffort: z.boolean(),
  supportsUsageInStreaming: z.boolean(),
  supportsFinishReason: z.boolean(),
  maxTokensField: z.union(MAX_TOKENS_FIELDS),
  requiresToolResultName: z.boolean(),
  requiresAssistantAfterToolResult: z.boolean(),
  requiresThinkingAsText: z.boolean(),
  requiresReasoningContentOnAssistantMessages: z.boolean(),
  thinkingFormat: z.union(SUPPORTED_THINKING_FORMATS),
  chatTemplateKwargs: z.dict(chatTemplateKwarg),
  chatTemplateArgs: z.dict(chatTemplateKwarg),
  supportsThinkingTokenBudget: z.boolean(),
  supportsStrictMode: z.boolean(),
  cacheControlFormat: z.union(CACHE_CONTROL_FORMATS),
  supportsLongCacheRetention: z.boolean(),
  supportsEagerToolInputStreaming: z.boolean(),
  supportsCacheControlOnTools: z.boolean(),
  supportsTemperature: z.boolean(),
  forceAdaptiveThinking: z.boolean(),
  allowEmptySignature: z.boolean(),
  supportsStrictTools: z.boolean(),
})

/**
 * Keys are the offered levels, values their wire spellings. A valueless key
 * (`off:`) survives validation because schemastery passes nullable data
 * through before any member schema runs — `z.const(null)` only controls the
 * error for non-null wrong values and what a configuration UI renders.
 * Only resolution decides which levels may leave the value empty, so the
 * diagnostic can name the route and model. The assertion narrows
 * schemastery's `Dict`, which types every literal key as required; dict
 * validation checks only present keys, so the runtime value is a partial record.
 */
const reasoningEfforts = z.dict(
  z.union([z.string(), z.const(null)]),
  z.union(THINKING_LEVELS),
) as unknown as z<PiAiReasoningEfforts>

/** The fields a `models` entry and a `modelOverrides` value share; only the id's home differs. */
const modelFields = {
  name: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  // No explicit default, unlike the route's `defaultInput`: schemastery
  // materializes `[]` for an absent array, and resolution reads that as "no
  // answer here" so the catalog entry below still applies.
  input: z.array(z.union(MODALITIES)),
  // The union, not a bare dict: schemastery materializes an absent dict as
  // `{}`, and absent must stay distinguishable — it means "inherit the
  // installed catalog's capability", while `false` disables reasoning.
  reasoningEfforts: z.union([z.const(false), reasoningEfforts]),
  compat: compatProfile,
}

const modelProfile: z<PiAiModelProfile> = z.object({
  id: z.string().required(),
  ...modelFields,
})

/** A {@link modelProfile} whose id lives in the `modelOverrides` dict key. */
const modelOverride: z<PiAiModelOverride> = z.object(modelFields)

/**
 * Runtime schema for {@link PiAiCatalogRefresh}. Neither member is `required()`
 * or defaulted here: either one makes the schema materialize the parent for
 * every route, so an absent `catalogRefresh` would stop being distinguishable
 * from a configured one. Presence and the timeout default are resolved below,
 * where a diagnostic can name the route.
 */
const catalogRefresh: z<PiAiCatalogRefresh> = z.object({
  url: z.string(),
  format: z.union(LIVE_CATALOG_FORMATS),
  requireTags: z.array(z.string()),
  timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
})

const profile = z.object({
  apiKeyEnv: z.string().role('credential-ref'),
  displayName: z.string(),
  api: z.union(supportedProtocols()),
  baseURL: z.string(),
  models: z.array(modelProfile),
  modelOverrides: z.dict(modelOverride),
  catalogRefresh,
  compat: compatProfile,
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  defaultMaxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS),
  defaultInput: z.array(z.union(MODALITIES)).default([...DEFAULT_INPUT]),
  headers: z.dict(z.string()),
  reasoning: z.union(THINKING_LEVELS),
  thinkingBudgets,
  cacheRetention: z.union(['none', 'short', 'long']),
  transport: z.union(['sse', 'websocket', 'websocket-cached', 'auto']),
  timeoutMs: z.natural(),
  websocketConnectTimeoutMs: z.natural(),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  maxRequestImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_REQUEST_IMAGE_BYTES),
  requestImagePixelBudget: z.number().step(1).min(1).default(DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET),
  requestImageMaxBytes: z.number().step(1).min(1).default(DEFAULT_REQUEST_IMAGE_MAX_BYTES),
  retryPolicy: RetryPolicySchema,
})

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  providers: z.dict(profile).default({}),
})

/**
 * Reject a section this adapter could not serve. Registered as the settings
 * namespace's validator, so an unserviceable profile is refused where it is
 * *written* — `settings.mutate` answers `settings-rejected` with the offending
 * route and model named — instead of being stored and then quietly disabling
 * every route in the namespace. It stays a validator rather than a schema
 * transform because the schema is also the shape a configuration surface
 * renders and the value an absent section resolves to; wrapping it would break
 * both.
 * @param config - the resolved section to check.
 * @throws Error naming the route and configuration entry that cannot be served.
 */
export function assertServiceable(config: Config): void {
  resolveProfiles(config.providers)
}

/** Reject removed pre-release profile fields and name their replacements. */
function rejectRemovedFields(provider: string, source: PiAiProviderProfile): void {
  const legacy = source as PiAiProviderProfile & {
    provider?: unknown
    maxRetries?: unknown
    maxRetryDelayMs?: unknown
  }
  if ('provider' in legacy) {
    throw new Error(`llm-pi-ai: provider "${provider}" sets "provider", which moved to the providers dict key`)
  }
  if ('maxRetries' in legacy || 'maxRetryDelayMs' in legacy) {
    throw new Error(
      `llm-pi-ai: provider "${provider}" sets maxRetries or maxRetryDelayMs, which were removed;`
      + ' compose agent recovery with avn-llm-retry',
    )
  }
}

/** Reject a profile header that Fetch cannot put on a provider request. */
function assertValidHeaders(provider: string, headers: Readonly<Record<string, string>> | undefined): void {
  for (const [name, value] of Object.entries(headers ?? {})) {
    try {
      new Headers([[name, value]])
    } catch {
      throw new Error(
        `llm-pi-ai: provider "${provider}" header "${name}" is not valid for Fetch;`
        + ' use a valid HTTP field name and a single-line value representable as bytes',
      )
    }
  }
}

/**
 * Validate profiles and return a detached route-keyed map suitable for
 * per-request reads. This is the one explicit resolve step, so an omitted dict
 * resolves to the empty (dormant) route set here rather than through a hidden
 * fallback, and each route's models and pi-ai provider are materialized once.
 * @param providers - configured provider profiles keyed by route.
 * @param liveModels - models a completed refresh added, by route; a route
 * absent here serves the installed snapshot alone.
 * @returns validated profiles in configuration order.
 */
export function resolveProfiles(
  providers: Readonly<Record<string, PiAiProviderProfile>> | undefined,
  liveModels?: ReadonlyMap<string, readonly Model<Api>[]>,
): Map<string, ResolvedPiAiProviderProfile> {
  if (Array.isArray(providers)) {
    throw new Error('llm-pi-ai: providers is now a dict keyed by provider route, not an array of profiles')
  }
  const entries = Object.entries(providers ?? {})
  const resolved = new Map<string, ResolvedPiAiProviderProfile>()
  for (const [provider, source] of entries) {
    rejectRemovedFields(provider, source)
    if (provider.length === 0) throw new Error('llm-pi-ai: provider names must be non-empty')
    if (source.baseURL !== undefined && source.baseURL.length === 0) {
      throw new Error(`llm-pi-ai: provider "${provider}" has an empty baseURL`)
    }
    if (source.displayName !== undefined && source.displayName.length === 0) {
      throw new Error(`llm-pi-ai: provider "${provider}" has an empty displayName`)
    }
    assertValidHeaders(provider, source.headers)
    const streamIdleTimeoutMs = source.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
    if (!Number.isFinite(streamIdleTimeoutMs)
      || streamIdleTimeoutMs <= 0
      || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
      throw new Error(
        `llm-pi-ai: provider "${provider}" streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
      )
    }
    const maxRequestImageBytes = source.maxRequestImageBytes ?? DEFAULT_MAX_REQUEST_IMAGE_BYTES
    if (!Number.isInteger(maxRequestImageBytes) || maxRequestImageBytes <= 0) {
      throw new Error(`llm-pi-ai: provider "${provider}" maxRequestImageBytes must be a positive integer`)
    }
    const requestImagePixelBudget = source.requestImagePixelBudget ?? DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET
    if (!Number.isSafeInteger(requestImagePixelBudget) || requestImagePixelBudget <= 0) {
      throw new Error(`llm-pi-ai: provider "${provider}" requestImagePixelBudget must be a positive safe integer`)
    }
    const requestImageMaxBytes = source.requestImageMaxBytes ?? DEFAULT_REQUEST_IMAGE_MAX_BYTES
    if (!Number.isSafeInteger(requestImageMaxBytes) || requestImageMaxBytes <= 0) {
      throw new Error(`llm-pi-ai: provider "${provider}" requestImageMaxBytes must be a positive safe integer`)
    }
    // Detached from the configuration object because pi-ai types `Model.input`
    // mutable. The schema's explicit default covers an absent key, so an empty
    // list here is always one someone typed — and unlike an entry's, nothing
    // below it can answer instead — so it is refused rather than read as "no
    // answer".
    const defaultInput = [...source.defaultInput ?? DEFAULT_INPUT]
    if (defaultInput.length === 0) {
      throw new Error(`llm-pi-ai: provider "${provider}" defaultInput must name at least one modality`)
    }
    // The route key, not the installed provider's own name: the directory has
    // always shown route keys, and a catalog route must not silently rename
    // itself on every configuration surface just because it gained a profile.
    // The schema materializes an absent all-optional object as `{}`, so an
    // untouched route is the empty block, not `undefined`. A block someone did
    // write still has to name an endpoint: nothing else in the profile can
    // supply the document's location, so a missing url is a typo rather than a
    // disabled refresh.
    const refresh = source.catalogRefresh
    // Only the optional scalars signal a written block: the schema
    // materializes `requireTags` as `[]` and may materialize `format`, so
    // neither can distinguish an authored block from an absent one.
    const wrote = refresh !== undefined && (refresh.url !== undefined || refresh.timeoutMs !== undefined)
    if (wrote && (refresh.url ?? '').length === 0) {
      throw new Error(`llm-pi-ai: provider "${provider}" catalogRefresh must name the url of its model document`)
    }
    // A known route supplies the refresh a profile did not write, which is what
    // lets a person add one of these providers with a credential alone.
    const known = knownRoute(provider)
    const refreshSource = wrote && refresh.url !== undefined ? refresh : known?.catalogRefresh
    const resolvedRefresh = refreshSource?.url === undefined
      ? undefined
      : {
        url: refreshSource.url,
        format: refreshSource.format ?? DEFAULT_CATALOG_REFRESH_FORMAT,
        requireTags: [...refreshSource.requireTags ?? []],
        timeoutMs: (wrote ? refresh.timeoutMs : undefined) ?? DEFAULT_CATALOG_REFRESH_TIMEOUT_MS,
        // The same fallbacks the route's own catalog uses, resolved here so
        // the refresh never re-derives a default this layer already chose.
        defaultContextWindow: source.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
        defaultMaxTokens: source.defaultMaxTokens ?? DEFAULT_MAX_TOKENS,
      }
    // A known route's protocol, endpoint, and credential reference stand in
    // for whatever the profile left out, so a stored `{ apiKeyEnv }` — which is
    // all the Models page writes — is a complete route.
    const api = source.api ?? known?.api
    const baseURL = source.baseURL ?? known?.baseURL
    // pi-ai names every catalog provider ("Hugging Face", "Moonshot AI CN"); the route key is the last resort.
    const displayName = source.displayName ?? known?.displayName ?? catalogProvider(provider)?.name ?? provider
    const added = liveModels?.get(provider)
    const catalog = resolveRouteModels({
      provider,
      ...api === undefined ? {} : { api },
      ...baseURL === undefined ? {} : { baseURL },
      ...source.models === undefined ? {} : { models: source.models },
      ...source.modelOverrides === undefined ? {} : { modelOverrides: source.modelOverrides },
      ...added === undefined ? {} : { liveModels: added },
      // Only before the first answer: once a refresh has replied, an empty
      // route is a real misconfiguration again.
      ...resolvedRefresh !== undefined && added === undefined ? { awaitingRefresh: true } : {},
      ...source.compat === undefined ? {} : { compat: source.compat },
      defaultInput,
      defaultContextWindow: source.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
      defaultMaxTokens: source.defaultMaxTokens ?? DEFAULT_MAX_TOKENS,
    })
    const {
      apiKeyEnv, retryPolicy, models: _models, displayName: _displayName,
      catalogRefresh: _catalogRefresh, api: _api, baseURL: _baseURL, ...rest
    } = source
    // A known route names the credential a profile omits; every other route
    // that omits one still defers to pi-ai's own environment discovery.
    const effectiveApiKeyEnv = apiKeyEnv ?? known?.apiKeyEnv
    resolved.set(provider, {
      ...rest,
      provider,
      displayName,
      ...api === undefined ? {} : { api },
      ...baseURL === undefined ? {} : { baseURL },
      ...effectiveApiKeyEnv === undefined ? {} : { apiKeyEnv: credentialRef(effectiveApiKeyEnv) },
      streamIdleTimeoutMs,
      maxRequestImageBytes,
      requestImagePixelBudget,
      requestImageMaxBytes,
      retryPolicy: resolveRetryPolicy(retryPolicy, `llm-pi-ai: provider "${provider}" retryPolicy`),
      ...rest.headers === undefined ? {} : { headers: { ...rest.headers } },
      ...rest.thinkingBudgets === undefined ? {} : { thinkingBudgets: { ...rest.thinkingBudgets } },
      configuredMaxTokens: catalog.configuredMaxTokens,
      ...resolvedRefresh === undefined ? {} : { catalogRefresh: resolvedRefresh },
      piProvider: buildProvider({
        provider,
        displayName,
        ...api === undefined ? {} : { api },
        ...baseURL === undefined ? {} : { baseURL },
        models: catalog.models,
        namesCredential: apiKeyEnv !== undefined,
      }),
    })
  }
  return resolved
}
