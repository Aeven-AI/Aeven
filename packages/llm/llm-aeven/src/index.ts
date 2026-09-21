/**
 * Register an {@link DeepSeekAdapter} for the `aeven-cloud` provider route on
 * `ctx.llm`, pointed at the Aeven gateway instead of DeepSeek's own endpoint.
 *
 * The adapter is deliberately the same one the DeepSeek route uses. It is
 * transport-only — "fetch + SSE against an OpenAI-compatible chat-completions
 * endpoint" — and the Aeven gateway speaks exactly that protocol, so a second
 * adapter would be a copy of the same wire behaviour with its own bugs. What
 * differs between the two routes is not the transport but the authority behind
 * it: DeepSeek's platform, against Aeven's, which the registering plugin owns.
 * The DeepSeek-only paths (file upload, image offload) stay unconfigured here,
 * because the gateway accepts images inline as `image_url` parts and has no
 * files API to upload them to.
 *
 * **Why this route exists.** A key is what a user must produce to talk to a
 * provider directly; an Aeven sign-in already establishes the same thing. So the
 * base URL is not a new setting to keep in sync but the origin the client is
 * already authenticated against, and the credential is the session the host
 * already verifies — not an API key the user has to find. That is the whole
 * difference between this route and `deepseek-official`, and it is why signing
 * in is enough.
 *
 * Two facts make it fit the existing first-run flow without touching it:
 * `providerUsable` in the Models page treats a route whose credential is
 * configured as usable, and the step ends as soon as *any* route is; and the
 * catalog is announced through `registerModelDiscovery`, so the picker offers
 * these models the same way it offers any other provider's.
 *
 * @module @aeven/llm-aeven
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { LlmError, resolveRetryPolicy, RetryPolicySchema } from '@aeven/llm'
import type { LlmProviderInfo, RetryPolicyConfig } from '@aeven/llm'
import { credentialRef } from '@aeven/credentials'
import { MAX_TIMER_DELAY_MS } from '@aeven/timeout'
import { getOrCreateAnonymousUserId, type AnonymousUserId } from '@aeven/anonymous-user-id'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_FILES_API_TIMEOUT_MS,
  DEFAULT_FILE_EXPIRY_SECONDS,
  DEFAULT_FILE_QUOTA_CLEANUP_BATCH,
  DEFAULT_FILE_REFRESH_MARGIN_SECONDS,
  DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM,
  DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM,
  DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM,
  DEFAULT_MAX_IMAGES_PER_REQUEST,
  DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES,
  DEFAULT_MAX_REQUEST_FILES_BYTES,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  DeepSeekAdapter,
} from '@aeven/llm-deepseek'
import type { DeepSeekCatalogModel, DeepSeekConnectionOptions } from '@aeven/llm-deepseek'

export const name = 'llm-aeven'

export const inject = ['llm']

/** The provider route these models are served under. */
export const PROVIDER = 'aeven-cloud'

/** User-settings section that overrides this entry. */
export const NS = 'llm-aeven'

/**
 * The Aeven API origin.
 *
 * The same value the identity authority is configured with, and the same default
 * the web bundle already resolves, so identity and inference are one origin
 * rather than two settings that can drift apart.
 */
export const DEFAULT_API_URL = 'http://localhost:9000'

/** Credential holding the signed-in session; see {@link DEFAULT_API_KEY_ENV}. */
export const DEFAULT_API_KEY_ENV = 'AEVEN_TOKEN'

/**
 * What the gateway serves, at the capabilities it advertises.
 *
 * Shipped rather than fetched because a selector needs labels and limits before
 * any request is made, and because the listing is entitlement-scoped: it answers
 * with what one *account* may use, which is the wrong input for a catalog every
 * account reads. The sync below widens this with what the listing publishes;
 * it never narrows it, so a free account still sees the paid model and learns
 * from the refusal that it needs a plan.
 */
export const DEFAULT_MODELS: readonly DeepSeekCatalogModel[] = [
  {
    id: 'Aeven-1.0-Flash',
    name: 'Aeven Flash',
    description: 'Fast, low-cost Aeven model for everyday requests and long contexts.',
    contextWindow: 1000000,
    maxTokens: 384000,
    inputModalities: ['text', 'image'],
  },
  {
    id: 'Aeven-1.0-Pro',
    name: 'Aeven Pro',
    description: 'The stronger Aeven model, for work that needs more than speed.',
    contextWindow: 1000000,
    maxTokens: 384000,
    inputModalities: ['text'],
  },
]

/** Accepted request modalities; mirrors the adapter's own catalog schema. */
const MODEL_MODALITIES = ['text', 'image'] as const

const catalogModel: z<DeepSeekCatalogModel> = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  inputModalities: z.array(z.union(MODEL_MODALITIES)).min(1).default(['text']),
  imagePixelBudget: z.union([z.number().step(1).min(1), 'low']),
  imageMaxBytes: z.number().step(1).min(1),
})

export const Config: z<Config> = z.object({
  /** The Aeven API origin; `/v1` is appended. */
  apiUrl: z.string().default(DEFAULT_API_URL),
  /**
   * Credential holding the signed-in session.
   *
   * The `credential-ref` role is what makes the Models page treat this as a
   * credential rather than a plain string — it is how the route reports that a
   * configured session is the condition for being usable, and so how the
   * first-run step knows it can end.
   */
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  /** Shipped catalog; a user-settings section replaces it whole. */
  models: z.array(catalogModel).default([...DEFAULT_MODELS] as DeepSeekCatalogModel[]),
  /** Both are forwarded and both are accepted by the gateway. */
  thinking: z.union(['enabled', 'disabled']).default('enabled'),
  reasoningEffort: z.union(['off', 'low', 'high', 'max']).default('max'),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_TOKENS),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  /**
   * Present because the adapter's connection facts require them, not because
   * this route uses them: the gateway takes images inline and has no files API.
   * Pinned to the adapter's own defaults so a change upstream is inherited
   * rather than silently overridden here.
   */
  maxRequestFilesBytes: z.number().step(1).min(1).default(DEFAULT_MAX_REQUEST_FILES_BYTES),
  maxInlineRequestImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES),
  maxImagesPerRequest: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGES_PER_REQUEST),
  imageOffloadByteQuantum: z.number().step(1).min(1).default(DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM),
  inlineImageOffloadByteQuantum: z.number().step(1).min(1).default(DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM),
  imageOffloadCountQuantum: z.number().step(1).min(1).default(DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM),
  filesApiTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_FILES_API_TIMEOUT_MS),
  fileExpiresAfterSeconds: z.number().step(1).min(3_600).max(2_592_000).default(DEFAULT_FILE_EXPIRY_SECONDS),
  fileRefreshMarginSeconds: z.number().step(1).min(0).default(DEFAULT_FILE_REFRESH_MARGIN_SECONDS),
  fileQuotaCleanupBatch: z.number().step(1).min(1).max(1_000).default(DEFAULT_FILE_QUOTA_CLEANUP_BATCH),
  retryPolicy: RetryPolicySchema,
})

/**
 * Entry and user-settings configuration.
 *
 * Declared rather than inferred, because schemastery's `z` is a callable generic
 * rather than a namespace — the same shape `@aeven/llm-deepseek` uses.
 */
export interface Config {
  /** Aeven API origin; `/v1` is appended. Defaults to the development gateway. */
  apiUrl?: string
  /** Credential holding the signed-in session; defaults to `AEVEN_TOKEN`. */
  apiKeyEnv?: string
  /** Advisory catalog shown to the picker; defaults to the shipped Aeven models. */
  models?: DeepSeekCatalogModel[]
  /** Forwarded to the gateway, which accepts both values. */
  thinking?: 'enabled' | 'disabled'
  /** Default thinking effort; `off` disables thinking per request. */
  reasoningEffort?: 'off' | 'low' | 'high' | 'max'
  /** Default per-request output cap; a model's own cap and explicit request values win. */
  maxTokens?: number
  /** Positive context capacity used when the selected model has no exact value. */
  defaultContextWindow?: number
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs?: number
  /**
   * The image and Files knobs below are inert on this route: the gateway accepts
   * images inline as `image_url` parts and has no files API to upload them to,
   * so nothing here ever offloads, uploads, or expires. They are declared
   * because {@link DeepSeekConnectionOptions} requires a complete set, and they
   * are pinned to the adapter's own defaults so an upstream change is inherited
   * rather than silently overridden here. Each is documented for what it does on
   * the route that uses it, not for what it does on this one.
   */
  /** High watermark for retained request-image bytes before oldest-first offload. */
  maxRequestFilesBytes?: number
  /** Independent base64 fallback high watermark, applied when Files mode is unavailable. */
  maxInlineRequestImageBytes?: number
  /** High watermark for retained request-image count. */
  maxImagesPerRequest?: number
  /** Files-mode oldest-prefix removal quantum, in bytes. */
  imageOffloadByteQuantum?: number
  /** Inline-mode oldest-prefix removal quantum, in bytes. */
  inlineImageOffloadByteQuantum?: number
  /** Count-overflow removal quantum, in images. */
  imageOffloadCountQuantum?: number
  /** Per-image Files resolution deadline. */
  filesApiTimeoutMs?: number
  /** Requested uploaded-image lifetime; the provider clamps values outside its own range. */
  fileExpiresAfterSeconds?: number
  /** Remaining lifetime below which a cached upload id is replaced rather than reused. */
  fileRefreshMarginSeconds?: number
  /** Oldest harness-owned files removed before one upload retry after a quota refusal. */
  fileQuotaCleanupBatch?: number
  /** Transport retry policy, resolved once at registration. */
  retryPolicy?: RetryPolicyConfig
}

/**
 * The DeepSeek transport under Aeven's own name. The gateway speaks the same
 * OpenAI-compatible protocol, so the transport is reused as it stands; the one
 * fact that cannot be inherited is the identity a selector shows, because
 * {@link DeepSeekAdapter} answers every route it owns with its own brand.
 */
class AevenAdapter extends DeepSeekAdapter {
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Aeven' }
  }
}

/**
 * Register the Aeven route.
 * @param ctx - the plugin context.
 * @param config - the resolved entry configuration.
 */
export function apply(ctx: Context, config: Config): void {
  let userId: AnonymousUserId | undefined

  /**
   * One resolution's complete request facts.
   *
   * Every default is restated from the schema rather than left to it: the schema
   * fills them for a loader-resolved entry, but the type stays optional so that a
   * user-settings section can supply a subset. Resolving here is what keeps the
   * connection and its credential one value — a request can never pair a stale
   * endpoint with a newer key.
   */
  const options = (): DeepSeekConnectionOptions => ({
    // `/v1` because the gateway serves the OpenAI-compatible surface there, so
    // the origin stays the one fact an operator configures.
    baseURL: `${(config.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '')}/v1`,
    apiKeyEnv: credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV),
    defaults: {
      thinking: config.thinking ?? 'enabled',
      reasoningEffort: config.reasoningEffort ?? 'max',
    },
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    defaultContextWindow: config.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
    models: config.models ?? DEFAULT_MODELS,
    streamIdleTimeoutMs: config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    // Present because the adapter's connection facts require them, not because
    // this route uses them: the gateway takes images inline and has no files API
    // to upload to. Kept at the adapter's own defaults so a change upstream is
    // inherited rather than silently pinned here.
    maxRequestFilesBytes: config.maxRequestFilesBytes ?? DEFAULT_MAX_REQUEST_FILES_BYTES,
    maxInlineRequestImageBytes:
      config.maxInlineRequestImageBytes ?? DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES,
    maxImagesPerRequest: config.maxImagesPerRequest ?? DEFAULT_MAX_IMAGES_PER_REQUEST,
    imageOffloadByteQuantum: config.imageOffloadByteQuantum ?? DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM,
    inlineImageOffloadByteQuantum:
      config.inlineImageOffloadByteQuantum ?? DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM,
    imageOffloadCountQuantum:
      config.imageOffloadCountQuantum ?? DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM,
    filesApiTimeoutMs: config.filesApiTimeoutMs ?? DEFAULT_FILES_API_TIMEOUT_MS,
    filePolicy: {
      expiresAfterSeconds: config.fileExpiresAfterSeconds ?? DEFAULT_FILE_EXPIRY_SECONDS,
      refreshMarginSeconds: config.fileRefreshMarginSeconds ?? DEFAULT_FILE_REFRESH_MARGIN_SECONDS,
      quotaCleanupBatch: config.fileQuotaCleanupBatch ?? DEFAULT_FILE_QUOTA_CLEANUP_BATCH,
    },
    retryPolicy: resolveRetryPolicy(config.retryPolicy, 'llm-aeven: retryPolicy'),
  })

  /**
   * The bearer for one request.
   *
   * The credential is the signed-in session, resolved through the same seam
   * every other adapter uses. Its value is written by whichever component holds
   * it — the credentials service, or the launching environment for a headless
   * run — so this route neither invents a token store nor tries to mint one.
   */
  const resolveApiKey = async (connection: DeepSeekConnectionOptions): Promise<string> => {
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')

    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined && hit.value.length > 0) return hit.value
    }

    const ambient = process.env[ref]
    if (ambient !== undefined && ambient.length > 0) return ambient

    // A refusal that names the remedy: the user is not signed in, or the host
    // has not yet mirrored the session it verified. Either way a missing key is
    // not the fix, so the message must not send them looking for one.
    throw new LlmError(
      `llm-aeven: no Aeven session for provider route "${PROVIDER}"; sign in, or store ${ref}`
      + ' through the credentials service when running headless',
      'MISSING_CREDENTIAL',
    )
  }

  const resolveUserId = (): AnonymousUserId => userId ??= getOrCreateAnonymousUserId()

  const adapter = new AevenAdapter({
    options,
    resolveApiKey,
    resolveUserId,
    // Aeven's gateway carries no plugin-contributed top-level fields, so every
    // request contributes none and acceptance is a no-op.
    prepareExtensions: () => Promise.resolve({ fields: {}, accept: () => Promise.resolve() }),
  })

  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: 'Aeven', settingsNs: NS, settingsPath: [] },
  ])

  // Answers the Models page's "fetch available models" from the catalog already
  // advertised. A live listing would be entitlement-scoped and so disclose less
  // than these entries carry.
  ctx.llm.registerModelDiscovery(NS, () =>
    Promise.resolve(
      options().models.map(model => ({
        id: model.id,
        ...model.name === undefined ? {} : { name: model.name },
        ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
        ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
      })),
    ),
  )

  ctx.llm.registerAdapter([PROVIDER], adapter)
}
