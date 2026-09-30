/**
 * Optional xAI Grok Build bundle with OAuth, account model catalog,
 * and an account section inside avn Settings.
 * @module @aeven/subscription-auth
 */

import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentStore } from '@aeven/attachment'
import type { CredentialInfo, CredentialProvider, CredentialRef } from '@aeven/credentials'
import type {} from '@aeven/host-webserver'
import { assertUsableApiKey, type RetryPolicyConfig, RetryPolicySchema } from '@aeven/llm'
import z from '@deepseek-ai/schemastery'
import { acquireCodingOAuthRuntime, CODING_OAUTH_CORE_ABI, type CodingOAuthRuntime } from 'dsh-coding-oauth-core'
import { createCodingOAuthAdapter } from './adapter.ts'
import { registerCodingOAuthRoutes } from './auth-routes.ts'
import { registerCapabilityRoutes } from './capability-routes.ts'
import {
  bindCapabilitySearch,
  bindCapabilityTools,
  type MediaCredentialReadiness,
  bindCodexFastRoute,
  CapabilityRuntimeState,
  type CapabilitySearchRegistry,
  type CapabilityToolRegistry,
} from './capability-runtime.ts'
import {
  type CapabilitySettingsPatch,
  CapabilitySettingsSchema,
  type CapabilitySettingsService,
  createCapabilitySettingsController,
  resolveCapabilitySettings,
} from './capability-settings.ts'
import {
  CODEX_IMAGE_EDIT_TOOL,
  CODEX_IMAGE_GENERATE_TOOL,
  createCapabilityTools,
  type ResolveCodexImageRoute,
  resolveCodexImageRouteFromLlm,
  type SaveArtifactToWorkspace,
} from './capability-tools.ts'
import { createClaudeUsageReader } from './claude-usage.ts'
import { codexAuthFromSession } from './codex-http.ts'
import { createCodexImageController } from './codex-images.ts'
import { createCodexModelCapabilities } from './codex-model-capabilities.ts'
import { createCodexSearchProvider } from './codex-search.ts'
import { createCodexUsageReader } from './codex-usage.ts'
import { createCodexProviderUsageReader } from './codex-usage-adapter.ts'
import { createAvnHostAdapter } from './avn-host-adapter.ts'
import {
  createGrokImagineClient,
  GROK_IMAGINE_IMAGE_TOOL,
  GROK_IMAGINE_VIDEO_STATUS_TOOL,
  GROK_IMAGINE_VIDEO_TOOL,
  GrokImagineError,
  type ImagineCredential,
  type ImagineOperation,
} from './grok-imagine.ts'
import { createGrokUsageReader } from './grok-usage.ts'
import {
  CLAUDE_PI_PROVIDER,
  CODEX_PI_PROVIDER,
  CODING_OAUTH_ROUTES,
  IMAGINE_MEDIA_STORE_DIRNAME,
  LEGACY_IMAGINE_MEDIA_STORE_DIRNAME,
  XAI_PI_PROVIDER,
} from './ids.ts'
import { registerImagineRoutes } from './imagine-routes.ts'
import { createCodexImageProvider, createImagineImageProvider, type SeamImageRegistry } from './media-provider.ts'
import { createTrustedImagineAuthz, MediaStore, migrateLegacyMediaStoreDir } from './media-store.ts'
import { OAUTH_PROVIDER_DEFINITIONS } from './oauth-providers.ts'
import { OAuthProviderSession } from './oauth-session.ts'
import { grokBuildFingerprintHeaders } from './provider.ts'
import { acquireCodingOAuthProxy } from './proxy.ts'
import { GrokBuildSession } from './session.ts'
import { GrokBuildCredentialStore } from './store.ts'
import type { UsageReader } from './usage-reader.ts'
import { createOwnerRequestPolicy, safeguardOwnerRequestPolicy } from './web-origin.ts'

export type {
  CodingOAuthParticipant,
  CodingOAuthRuntime,
  DshHostCapabilities,
  OwnerRequestPolicy as CoreOwnerRequestPolicy,
} from 'dsh-coding-oauth-core'
export {
  acquireCodingOAuthRuntime,
  CODING_OAUTH_CORE_ABI,
} from 'dsh-coding-oauth-core'
export { createCodingOAuthAdapter, createGrokBuildAdapter, preferredGrokBuildModel } from './adapter.ts'
export type { AliasLlmRoutePolicy } from './alias-adapter.ts'
export { AliasLlmAdapter } from './alias-adapter.ts'
export type { GrokBuildAuthStatus } from './auth.ts'
export {
  grokBuildAuthStatus,
  importGrokBuildFromGrok,
  importGrokBuildSession,
  loginGrokBuild,
  loginGrokBuildSession,
  logoutGrokBuild,
} from './auth.ts'
export type {
  CodingOAuthWebStatus,
  GrokBuildLoginMethod,
  GrokBuildWebAuthStatus,
  LoginChallenge,
  SubscriptionLoginChallenge,
  SubscriptionWebAuthStatus,
} from './auth-routes.ts'
export {
  CODING_OAUTH_LOGIN_CANCEL_PATH,
  CODING_OAUTH_LOGIN_CODE_PATH,
  CODING_OAUTH_LOGIN_PATH,
  CODING_OAUTH_LOGOUT_PATH,
  CODING_OAUTH_STATUS_PATH,
  GROK_BUILD_AUTH_IMPORT_PATH,
  GROK_BUILD_AUTH_LOGIN_CANCEL_PATH,
  GROK_BUILD_AUTH_LOGIN_CODE_PATH,
  GROK_BUILD_AUTH_LOGIN_PATH,
  GROK_BUILD_AUTH_LOGOUT_PATH,
  GROK_BUILD_AUTH_STATUS_PATH,
  GrokBuildWebAuth,
  registerCodingOAuthRoutes,
  registerGrokBuildAuthRoutes,
  SubscriptionWebAuth,
} from './auth-routes.ts'
export type { CatalogSource, LiveModelDescriptor } from './catalog.ts'
export {
  extractLiveModels,
  extractModelIds,
  fetchLiveModelIds,
  fetchLiveModels,
  materializeLiveModel,
  mergeLiveCatalog,
  preferredGrokBuildModelFrom,
  thinkingLevelMapFromLiveEfforts,
} from './catalog.ts'
export { createAvnHostAdapter } from './avn-host-adapter.ts'
export type { GrokImportProbe } from './grok-import.ts'
export { grokAuthPath, importGrokAuth, parseGrokAuthDocument, probeGrokAuth } from './grok-import.ts'
export type { CodingOAuthProviderSlug, CodingOAuthRoute } from './ids.ts'
export {
  CLAUDE_CODE_OAUTH_AUTH_FILENAME,
  CLAUDE_CODE_OAUTH_MODELS_CACHE_FILENAME,
  CLAUDE_CODE_OAUTH_ROUTE,
  CLAUDE_PI_PROVIDER,
  CODEX_OAUTH_AUTH_FILENAME,
  CODEX_OAUTH_MODELS_CACHE_FILENAME,
  CODEX_OAUTH_ROUTE,
  CODEX_PI_PROVIDER,
  CODING_OAUTH_ROUTES,
  DEFAULT_GROK_BUILD_MODEL,
  GROK_BUILD_AUTH_FILENAME,
  GROK_BUILD_MODELS_CACHE_FILENAME,
  GROK_BUILD_ROUTE,
  GROK_BUILD_STREAM_IDLE_TIMEOUT_MS,
  XAI_PI_PROVIDER,
} from './ids.ts'
export type { GrokBuildOAuthErrorCode, GrokBuildOAuthParams, PkceLoginCallbacks } from './oauth.ts'
export {
  buildAuthorizeUrl,
  discoverOAuthEndpoints,
  extractCode,
  GROK_BUILD_OAUTH_CLIENT_ID,
  GROK_BUILD_OAUTH_DEFAULT_PORT,
  GROK_BUILD_OAUTH_ISSUER,
  GROK_BUILD_OAUTH_SCOPE,
  GrokBuildOAuthError,
  generatePkce,
  loginGrokBuildPkce,
  refreshGrokBuildToken,
  resolveOAuthParams,
} from './oauth.ts'
export type { OAuthProviderDefinition, SubscriptionLoginMethod, SubscriptionProviderSlug } from './oauth-providers.ts'
export {
  CLAUDE_CODE_OAUTH_PROVIDER,
  CODEX_OAUTH_PROVIDER,
  OAUTH_PROVIDER_DEFINITIONS,
  oauthProviderDefinition,
} from './oauth-providers.ts'
export type { OAuthProviderStatus } from './oauth-session.ts'
export { OAuthProviderSession, oauthModelsCachePath } from './oauth-session.ts'
export {
  GROK_BUILD_BASE_URL,
  GROK_BUILD_MODELS_URL,
  GROK_CLIENT_VERSION,
  grokBuildBaselineModels,
  grokBuildFingerprintHeaders,
  grokBuildProvider,
  grokBuildReasoningMap,
} from './provider.ts'
export type { CodingOAuthProxyOptions } from './proxy.ts'
export {
  codingOAuthProxyInEffect,
  codingOAuthProxyUnreachableHint,
  ensureCodingOAuthProxy,
  ensureGrokBuildProxy,
  grokBuildProxyInEffect,
} from './proxy.ts'
export { redactProxyUrl, safeMessage } from './redact.ts'
export { GrokBuildSession } from './session.ts'
export type {
  AccountId,
  AccountRecord,
  AccountSummary,
  AuthDocumentV2,
  LoginPersistMode,
  LoginPersistOptions,
} from './store.ts'
export {
  GrokBuildCredentialStore,
  grokBuildAuthPath,
  isValidAccountId,
  OAUTH_MAX_ACCOUNTS,
  OAuthCredentialFileStore,
  oauthCredentialPath,
  resolveAccountIdForCredential,
} from './store.ts'
export type { OwnerRequestPolicy, OwnerRequestPolicyConfig } from './web-origin.ts'
export {
  createOwnerRequestPolicy,
  LOOPBACK_OWNER_REQUEST_POLICY,
  OWNER_CSRF_HEADER,
  OWNER_PROOF_HEADER,
} from './web-origin.ts'

/** Stable Cordis plugin name. */
export const name = 'llm-grok-build-oauth'

/** Separate API-key credential used only by official xAI Imagine REST calls. */
export const XAI_API_KEY_CREDENTIAL = 'XAI_API_KEY'
/** Validate locally because `credentialRef()` is a value export of the optional credentials peer. */
const XAI_API_KEY_REF = fixedCredentialRef(XAI_API_KEY_CREDENTIAL)

function fixedCredentialRef(value: string): CredentialRef {
  /* v8 ignore next -- XAI_API_KEY is a compile-time identifier that matches CredentialRef */
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    throw new TypeError(`invalid credential reference ${JSON.stringify(value)}`)
  }
  return value as CredentialRef
}

/** Owner-private artifact directory below the resolved AVN home. */
export { IMAGINE_MEDIA_STORE_DIRNAME } from './ids.ts'

/** Optional host services are acquired inside the elected child fiber. */
export const inject = ['webServer']

/** Plugin configuration; every field is optional. */
export interface Config {
  /** HTTP(S) proxy URL for the audited coding-subscription host allowlist. */
  proxy?: string
  /**
	 * Optional provider retry policy override for the four OAuth routes. When
	 * omitted, the plugin retries transient failures (rate limit, server,
	 * timeout, transport, empty response) plus AUTH — the latter is safe because
	 * the stored credential is invalidated on every AUTH finish, so the retried
	 * step refreshes before reuse. Quota exhaustion is never retried.
	 */
  retryPolicy?: RetryPolicyConfig
  /** Secret-free composition/YAML defaults below live user settings. */
  capabilities?: CapabilitySettingsPatch
  /**
	 * Which upstream Imagine calls authorize against. `auto` (the default) uses
	 * `XAI_API_KEY` against the developer API when that credential is configured
	 * and otherwise takes the Grok Build chat proxy with the subscription's OAuth
	 * access token, which is the route the official Grok CLI takes and requires a
	 * SuperGrok tier. `xai-api` and `grok-build` pin one route and fail loudly
	 * when its credential is missing.
	 */
  imagineTransport?: 'auto' | 'xai-api' | 'grok-build'
  /**
   * Imagine API request timeout. The subscription route proxies generation
   * through the Grok Build chat proxy, which is slower than the direct xAI API,
   * so the ceiling is deployment-varying rather than fixed.
   */
  imagineApiTimeoutMs?: number
  /** Owner-only request authorization for loopback, SSH tunnels, and trusted HTTPS proxies. */
  ownerRequest?: {
    /** Whether a loopback caller is the operator directly, or arrives over an SSH tunnel. */
    loopbackAccessMode?: 'loopback' | 'ssh-tunnel'
    /** Accept owner requests forwarded by a proxy that proves itself with the fields below. */
    trustedProxy?: {
      /** Peer addresses whose forwarded requests may be considered at all. */
      peers?: string[]
      /** Origins the forwarded request may declare. */
      origins?: string[]
      /** Shared secret the proxy sends to prove it speaks for the operator. */
      ownerProof?: string
      /** Token the proxy echoes on state-changing requests, defeating cross-site forgery. */
      csrfToken?: string
    }
  }
}

export const Config: z<Config> = z.object({
  proxy: z.string(),
  retryPolicy: RetryPolicySchema,
  capabilities: CapabilitySettingsSchema,
  imagineTransport: z.union([z.const('auto'), z.const('xai-api'), z.const('grok-build')]).default('auto'),
  imagineApiTimeoutMs: z.number().min(1000).default(180_000),
  ownerRequest: z.object({
    loopbackAccessMode: z.union([z.const('loopback'), z.const('ssh-tunnel')]),
    trustedProxy: z.object({
      peers: z.array(z.string()),
      origins: z.array(z.string()),
      ownerProof: z.string(),
      csrfToken: z.string(),
    }),
  }),
})

const CODEX_TOOL_NAMES = new Set<string>([CODEX_IMAGE_GENERATE_TOOL, CODEX_IMAGE_EDIT_TOOL])
const IMAGINE_TOOL_NAMES = new Set<string>([
  GROK_IMAGINE_IMAGE_TOOL,
  GROK_IMAGINE_VIDEO_TOOL,
  GROK_IMAGINE_VIDEO_STATUS_TOOL,
])

function requireSubscription(
  subscriptions: readonly OAuthProviderSession[],
  nativeProviderId: string,
): OAuthProviderSession {
  const session = subscriptions.find(candidate => candidate.definition.nativeProviderId === nativeProviderId)
  if (session === undefined) throw new Error(`missing built-in OAuth provider ${nativeProviderId}`)
  return session
}

/**
 * Whether a signed-in OAuth session currently backs one provider.
 * Read synchronously by the tool gate, so it reflects the last refresh rather
 * than issuing a token exchange per reconcile.
 */
function hasStoredOAuth(session: { store: { read(providerId: string): Promise<unknown> } }, providerId: string): Promise<boolean> {
  return session.store
    .read(providerId)
    .then(credential => credential !== undefined)
    .catch(() => false)
}

async function describeImagineCredential(credentials: CredentialProvider | undefined): Promise<CredentialInfo> {
  if (credentials === undefined) return { configured: false, writable: false }
  return credentials.describe(XAI_API_KEY_REF)
}

/**
 * Resolve the credential and upstream for one Imagine call.
 * `xai-api` carries `XAI_API_KEY` to the developer API. `grok-build` carries
 * the session's refreshed OAuth access token to the chat proxy under the same
 * client fingerprint the chat route sends, which is the route the official Grok
 * CLI takes and which requires a SuperGrok tier. `auto` prefers a configured
 * `XAI_API_KEY` and otherwise takes the subscription route.
 * @param credentials - AVN credential provider holding `XAI_API_KEY`.
 * @param grok - Grok Build session owning the refreshed OAuth access token.
 * @param transport - configured route selection.
 * @param sessionId - stable per-process id sent as `x-grok-session-id`.
 * @param operation - Imagine operation named in the failure message.
 * @returns the bearer token and the upstream it authorizes.
 */
async function resolveImagineCredential(
  credentials: CredentialProvider,
  grok: GrokBuildSession,
  transport: 'auto' | 'xai-api' | 'grok-build',
  sessionId: string,
  operation: ImagineOperation,
): Promise<ImagineCredential> {
  if (transport !== 'grok-build') {
    const resolved = await credentials.resolve(XAI_API_KEY_REF)
    if (resolved !== undefined) {
      return {
        token: assertUsableApiKey(resolved.value, '@aeven/subscription-auth', XAI_API_KEY_CREDENTIAL),
        transport: 'xai-api',
      }
    }
    if (transport === 'xai-api') {
      throw new GrokImagineError(
        'MISSING_CREDENTIAL',
        `${XAI_API_KEY_CREDENTIAL} is not configured for ${operation}.` +
					' Set it, or leave imagineTransport at "auto" to use the Grok Build subscription route.',
      )
    }
  }
  const access = (await grok.models.getAuth(XAI_PI_PROVIDER))?.auth.apiKey
  if (access === undefined || access.length === 0) {
    throw new GrokImagineError(
      'MISSING_CREDENTIAL',
      `no signed-in Grok Build session is available for ${operation}; sign in or configure ${XAI_API_KEY_CREDENTIAL}.`,
    )
  }
  return {
    token: assertUsableApiKey(access, '@aeven/subscription-auth', 'the Grok Build OAuth access token'),
    transport: 'grok-build',
    headers: { ...grokBuildFingerprintHeaders(), 'x-grok-session-id': sessionId },
  }
}

/** Subdirectory each media kind lands in, matching the official Grok CLI layout. */
const WORKSPACE_ARTIFACT_DIRS = { image: 'images', video: 'videos' } as const

/**
 * Build the workspace writer for generated artifacts, or `undefined` when this
 * deployment mounts no sandbox policy and therefore names no workspace root.
 * The root is the same boundary the file sandbox enforces, so a generated image
 * lands where the session's own file tools can already read and write. Both the
 * Codex and Imagine tool registrations use this; only the Imagine one produces
 * video, so `media` is omitted on the Codex path.
 * @param ctx - the injected tool context.
 * @param attachments - store holding generated image bytes.
 * @param media - store holding completed video artifacts; omit where no tool produces one.
 * @returns a writer returning workspace-relative paths, or `undefined`.
 */
function createWorkspaceArtifactWriter(
  ctx: Context,
  attachments: AttachmentStore,
  media?: MediaStore,
): SaveArtifactToWorkspace {
  return async (exec, artifact) => {
    // Resolved per call, not captured at registration: `ctx.get` yields
    // undefined until the providing fiber reaches ACTIVE, and this plugin's
    // tools register before the sandbox policy is guaranteed to be up. By
    // execute time the tree is loaded.
    const sandboxPolicy = ctx.get('sandboxPolicy') as
      | { resolve: (request: { session?: unknown }) => { workspaceRoot: string } }
      | undefined
    if (sandboxPolicy === undefined) return undefined
    const session = exec.agent?.session
    const root = sandboxPolicy.resolve(session === undefined ? {} : { session }).workspaceRoot
    /* v8 ignore next -- the Codex-only writer is never given a video artifact */
    if (artifact.kind === 'video' && media === undefined) {
      throw new Error('workspace writer received a video artifact but this registration mounts no media store')
    }
    const stored =
      artifact.kind === 'image' || media === undefined
        ? await attachments.readImage((artifact as Extract<typeof artifact, { kind: 'image' }>).attachment, exec.signal)
        : await media.openDownload(artifact.artifactId, createTrustedImagineAuthz({ authorized: true }))
    const { data, id, mediaType } =
      'ref' in stored
        ? { data: stored.data, id: stored.ref.attachmentId, mediaType: stored.ref.mediaType }
        : { data: stored.body, id: stored.meta.artifactId, mediaType: stored.meta.mediaType }
    const directory = WORKSPACE_ARTIFACT_DIRS[artifact.kind]
    const relative = join(directory, `${id}${mediaTypeExtension(mediaType)}`)
    const absolute = resolve(root, relative)
    // The name is store-owned and id-shaped, but the root is deployment-owned:
    // refuse anything that canonicalizes outside it rather than trusting join.
    if (absolute !== resolve(root, relative) || !absolute.startsWith(resolve(root) + sep)) {
      throw new Error('workspace artifact path escaped the workspace root')
    }
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, data)
    return relative
  }
}

/** Filename extension for one stored media type; unknown types keep no extension. */
function mediaTypeExtension(mediaType: string): string {
  switch (mediaType) {
    case 'image/png':
      return '.png'
    case 'image/jpeg':
      return '.jpg'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
    case 'video/mp4':
      return '.mp4'
    case 'video/webm':
      return '.webm'
    default:
      return ''
  }
}

function optionalWorkspaceWriter(
  writer: SaveArtifactToWorkspace | undefined,
): { readonly saveToWorkspace?: SaveArtifactToWorkspace } {
  /* v8 ignore next -- a composition without sandboxPolicy omits the writer */
  if (writer === undefined) return {}
  return { saveToWorkspace: writer }
}

/* v8 ignore start -- Codex-only tool registration never invokes Imagine */
function unavailableImagineClient(): {
  generateImage(): Promise<never>
  startVideo(): Promise<never>
  videoStatus(): Promise<never>
} {
  // oxlint-disable-next-line typescript/require-await -- keeps this seam's failure a rejection, not a synchronous throw
  const unavailable = async (): Promise<never> => {
    throw new GrokImagineError('MISSING_CREDENTIAL', 'Grok Imagine services are not composed')
  }
  return { generateImage: unavailable, startVideo: unavailable, videoStatus: unavailable }
}
/* v8 ignore stop */

/**
 * Register the `grok-build` LLM route with a provider-native OAuth store.
 * @param ctx - plugin context carrying the LLM registry plus optional web server.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const host = createAvnHostAdapter(ctx)
  const lease: CodingOAuthRuntime = acquireCodingOAuthRuntime(host.scope(), {
    id: '@aeven/subscription-auth',
    role: 'standalone',
    coreAbi: CODING_OAUTH_CORE_ABI,
    async activate() {
      let ownerMounted = false
      const fiber = ctx.inject([], (injected) => {
        applyOwned(injected, config)
        ownerMounted = true
        return () => {
          ownerMounted = false
        }
      })
      try {
        await fiber.await()
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- set from the inject closure above
        if (!ownerMounted) throw new Error('standalone Coding OAuth owner fiber did not activate')
      } catch (error) {
        try {
          await fiber.dispose()
        } catch {
          // Preserve the startup error; Cordis already logs cleanup failures.
        }
        throw error
      }
      return {
        async dispose() {
          await fiber.dispose()
        },
      }
    },
  })
  ctx.effect(() => () => lease.release(), 'avn-subscription-auth: release shared runtime ownership')
}

/**
 * Owner runtime that survives optional LLM service churn. OAuth sessions and
 * same-origin Web routes are deliberately owned here, rather than by the LLM
 * child fiber, so a transient LLM unload cannot make account recovery vanish.
 */
function applyOwned(ctx: Context, config: Config): void {
  const host = createAvnHostAdapter(ctx)
  const ownerRequestPolicy = safeguardOwnerRequestPolicy(
    host.ownerRequestPolicy() ?? createOwnerRequestPolicy(config.ownerRequest),
  )
  const proxyLease = acquireCodingOAuthProxy(
    config.proxy,
  )
  ctx.effect(() => () => proxyLease.release(), 'avn-subscription-auth: scoped proxy policy')
  const logger = ctx.logger(name)
  const baseCapabilities = resolveCapabilitySettings(config.capabilities)
  const runtime = new CapabilityRuntimeState(baseCapabilities, () => {
    logger.warn('an optional capability listener failed')
  })
  let active = true
  ctx.effect(
    () => () => {
      active = false
    },
    'avn-subscription-auth: startup lifetime',
  )
  /* v8 ignore next -- replaced synchronously before any credential-change listener can run */
  let invalidateOptionalAuthState = (): void => undefined
  const notifyCatalogChange = (): void => {
    if (!active) return
    try {
      ctx.emit('llm/adapters-updated')
    } catch (error) {
      // Catalog observers are advisory; a broken listener must not turn an
      // already-persisted OAuth login/logout into an apparent auth failure.
      logger.warn('an llm/adapters-updated listener failed')
      logger.warn(error)
    }
  }
  const grok = new GrokBuildSession(new GrokBuildCredentialStore(), () => {
    usageReaders['grok']?.clear()
    refreshMediaReadiness()
    notifyCatalogChange()
  })
  const subscriptions = OAUTH_PROVIDER_DEFINITIONS.map(
    definition =>
      new OAuthProviderSession(definition, () => {
        if (definition.nativeProviderId === CODEX_PI_PROVIDER) invalidateOptionalAuthState()
        // Every provider's usage answer is keyed to the account that was
        // signed in when it was read, including a settled "this plan has
        // no subscription" answer, so a credential change retires it.
        usageReaders[definition.slug]?.clear()
        refreshMediaReadiness()
        notifyCatalogChange()
      }),
  )
  const codex = requireSubscription(subscriptions, CODEX_PI_PROVIDER)
  const claude = requireSubscription(subscriptions, CLAUDE_PI_PROVIDER)
  const codexAuth = codexAuthFromSession(codex)
  const usage = createCodexUsageReader({ auth: codexAuth })
  const codexModels = createCodexModelCapabilities({ auth: codexAuth })
  const usageReaders: Record<string, UsageReader> = {
    codex: createCodexProviderUsageReader({ usage, resolveToken: () => codex.resolveAccessToken() }),
    claude: createClaudeUsageReader({
      resolveToken: () => claude.resolveAccessToken(),
      invalidateToken: () => claude.invalidateAccessToken(),
    }),
    grok: createGrokUsageReader({
      resolveToken: () => grok.resolveAccessToken(),
      invalidateToken: () => grok.invalidateAccessToken(),
    }),
  }
  /**
   * Cached media-credential view behind the tool gate. Media generation is
   * always enabled, so a missing credential — not a setting — is what must
   * withdraw the tools; without this the model spends a turn discovering it.
   */
  const mediaReadiness = { imagine: false, codex: false }
  const refreshMediaReadiness = (): void => {
    void Promise.all([
      (async (): Promise<boolean> => {
        const credentials = ctx.get('credentials')
        if (credentials !== undefined && (await credentials.resolve(XAI_API_KEY_REF)) !== undefined) return true
        return hasStoredOAuth(grok, XAI_PI_PROVIDER)
      })(),
      hasStoredOAuth(codex, CODEX_PI_PROVIDER),
    ])
      .then(([imagine, codexReady]) => {
        if (!active) return
        if (mediaReadiness.imagine === imagine && mediaReadiness.codex === codexReady) return
        mediaReadiness.imagine = imagine
        mediaReadiness.codex = codexReady
        runtime.refresh()
      })
      .catch(() => {
        // A readiness probe failure leaves the last view in place; the tools
        // keep their current advertisement rather than flapping on a blip.
      })
  }

  invalidateOptionalAuthState = () => {
    usage.clear()
    codexModels.clear()
    refreshMediaReadiness()
    runtime.refresh()
  }

  refreshMediaReadiness()
  // The shipped catalogues are what each subscription offers; nothing asks a
  // provider for its model list on its own.
  void Promise.allSettled([grok.loadCachedCatalog(), ...subscriptions.map(session => session.loadCachedModels())])
    .then((results) => {
      if (!active) return
      if (results.some(result => result.status === 'rejected')) {
        logger.warn('one or more OAuth model caches could not be loaded; using in-memory fallbacks')
      }
    })
    .catch(() => {
      // Contain every startup refresh failure so plugin activation cannot leave
      // an unhandled rejection. The static provider catalogs remain usable.
      if (active) logger.warn('background OAuth model catalog initialization failed; using static fallbacks')
    })

  let settingsOwner = 0
  const createFallbackCapabilityController = (): ReturnType<typeof createCapabilitySettingsController> =>
    createCapabilitySettingsController({
      ...(config.capabilities === undefined ? {} : { base: config.capabilities }),
      /* v8 ignore next -- fallback controller has no subscribers while settings is absent */
      onListenerError: () =>{  logger.warn('a capability settings listener failed') },
    })
  let capabilityController = createFallbackCapabilityController()
  const capabilityRoutesController = {
    snapshot: () => capabilityController.snapshot(),
    patch: (patch: CapabilitySettingsPatch, expectedRevision: number) =>
      capabilityController.patch(patch, expectedRevision),
    replace: (section: CapabilitySettingsPatch, expectedRevision: number) =>
      capabilityController.replace(section, expectedRevision),
  }
  let releaseActiveSettings = (): void => undefined
  ctx.effect(
    () => () => {
      releaseActiveSettings()
      capabilityController.dispose()
    },
    'avn-subscription-auth: capability settings bridge',
  )
  ctx.inject(['settings'], (settingsCtx) => {
    // Re-injection may happen before Cordis runs the previous child effect's
    // disposer. Release it synchronously so an obsolete watcher cannot race a
    // newly attached settings service.
    releaseActiveSettings()
    const owner = ++settingsOwner
    const previousController = capabilityController
    const controller = createCapabilitySettingsController({
      settings: settingsCtx.get('settings') as CapabilitySettingsService,
      ...(config.capabilities === undefined ? {} : { base: config.capabilities }),
      onListenerError: () =>{  logger.warn('a capability settings listener failed') },
    })
    capabilityController = controller
    previousController.dispose()
    runtime.set(controller.current())
    const unsubscribe = controller.subscribe((snapshot) => {
      runtime.set(snapshot.value)
    })
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      unsubscribe()
      controller.dispose()
      /* v8 ignore next -- Cordis disposes the dependent before a new owner injects, so a stale owner never reaches here */
      if (owner !== settingsOwner) return
      releaseActiveSettings = (): void => undefined
      capabilityController = createFallbackCapabilityController()
      runtime.set(capabilityController.current())
    }
    releaseActiveSettings = release
    settingsCtx.effect(() => release, 'avn-subscription-auth: capability settings')
  })


  registerCapabilityRoutes(ctx, {
    controller: capabilityRoutesController,
    usageReaders,
    credentialInfo: () => describeImagineCredential(ctx.get('credentials')),
    ownerRequestPolicy,
  })
  registerCodingOAuthRoutes(ctx, grok, subscriptions, ownerRequestPolicy, accessMode =>
    host.compatibility({
      accessMode,
      uiOwner: 'standalone',
      diagnostics: ownerRequestPolicy.diagnostics(),
    }),
  )

  const search = createCodexSearchProvider({
    auth: codexAuth,
    // Login, import, model selection, and catalog refreshes can all change the
    // first visible Codex model after plugin startup.
    model: () => codex.visibleModels()[0]?.id ?? '',
  })
  ctx.inject(['web'], (webCtx) => {
    const web = webCtx.get('web') as CapabilitySearchRegistry
    webCtx.effect(() => bindCapabilitySearch(runtime, web, search), 'avn-subscription-auth: Codex search')
  })

  ctx.inject(['tools', 'attachments', 'credentials', 'webServer'], async (toolCtx) => {
    const tools = toolCtx.get('tools') as CapabilityToolRegistry
    const attachments = toolCtx.get('attachments') as AttachmentStore
    const credentials = toolCtx.get('credentials') as CredentialProvider
    // The chat proxy correlates Imagine calls by `x-grok-session-id`. One id
    // per plugin instance groups this deployment's calls without carrying any
    // chat session's identifier onto the media API.
    const imagineSessionId = randomUUID()
    const stateDir = dirname(grok.store.filename)
    const mediaRoot = join(stateDir, IMAGINE_MEDIA_STORE_DIRNAME)
    // Artifacts written before the rename live under the name core still
    // publishes; move them once so an upgrade keeps its stored videos.
    try {
      if (await migrateLegacyMediaStoreDir(mediaRoot, join(stateDir, LEGACY_IMAGINE_MEDIA_STORE_DIRNAME))) {
        logger.info('moved stored Imagine artifacts into the renamed media directory')
      }
    } catch {
      logger.warn(
        'the legacy Imagine media directory could not be moved; stored artifacts stay under the previous name',
      )
    }
    const media = new MediaStore(mediaRoot, {
      retentionMs: runtime.current().videoArtifactTtlMs,
    })
    const routeRegistry = registerImagineRoutes(toolCtx, {
      attachments,
      media: { readForDownload: (artifactId, authz) => media.openDownload(artifactId, authz) },
      ownerRequestPolicy,
    })
    const imagine = createGrokImagineClient({
      resolveApiKey: operation =>
        resolveImagineCredential(credentials, grok, config.imagineTransport ?? 'auto', imagineSessionId, operation),
      attachments,
      media,
      ...(config.imagineApiTimeoutMs === undefined ? {} : { apiTimeoutMs: config.imagineApiTimeoutMs }),
    })
    const routedImagine = {
      async generateImage(input: Parameters<typeof imagine.generateImage>[0], signal?: AbortSignal) {
        const result = await imagine.generateImage(input, signal)
        routeRegistry.rememberImages(result.images.map(image => image.attachment))
        return result
      },
      startVideo: (input: Parameters<typeof imagine.startVideo>[0], signal?: AbortSignal) =>
        imagine.startVideo(input, signal),
      async videoStatus(requestId: string, options?: Parameters<typeof imagine.videoStatus>[1]) {
        const result = await imagine.videoStatus(requestId, options)
        /* v8 ignore next -- pending/failed video status has no artifact to remember */
        if (result.artifact !== undefined) routeRegistry.rememberArtifact(result.artifact)
        return result
      },
    }
    // Offer this subscription's image model through the generated-media seam
    // as well, so one model-facing tool can list it beside every API-key
    // provider. Optional: a composition without `ctx.media` keeps only the
    // standalone tools below.
    toolCtx.inject(['media'], (mediaCtx) => {
      // `ctx.media` is untyped here because the seam package is not a
      // dependency of this plugin; the structural registry is what this
      // provider needs and all it is used for.
      const registry = mediaCtx.get('media') as unknown as SeamImageRegistry | undefined
      if (registry === undefined) return
      mediaCtx.effect(
        () => registry.registerImageProvider(createImagineImageProvider({ imagine: routedImagine })),
        'avn-subscription-auth: Imagine image provider',
      )
      mediaCtx.effect(
        () =>
          registry.registerImageProvider(
            createCodexImageProvider({
              // The seam carries a prompt and no conversation, so this
              // controller derives no messages; `codex_image_generate`
              // remains the surface that does.
              createController: () =>
                createCodexImageController({
                  auth: codexAuth,
                  attachments,
                  session: {
                    /* v8 ignore next -- the generated-media seam carries no conversation */
                    deriveMessages: () => [],
                  },
                  routePolicy: 'any',
                }),
              imageCount: () => runtime.current().imageCount,
            }),
          ),
        'avn-subscription-auth: Codex image provider',
      )
    })

    const saveToWorkspace = createWorkspaceArtifactWriter(toolCtx, attachments, media)
    const definitions = (
      await createCapabilityTools({
        current: () => runtime.current(),
        auth: codexAuth,
        attachments,
        imagine: routedImagine,
        ...optionalWorkspaceWriter(saveToWorkspace),
      })
    ).filter(definition => IMAGINE_TOOL_NAMES.has(definition.name))
    const releaseRetention = runtime.subscribe((settings) => {
      return media
        .applyRetentionMs(settings.videoArtifactTtlMs)
        .then(() => undefined)
        .catch(() =>{  logger.warn('Imagine media retention cleanup failed') })
    })
    toolCtx.effect(
      () => bindCapabilityTools(runtime, tools, definitions, () => mediaReadiness),
      'avn-subscription-auth: Grok Imagine tools',
    )
    toolCtx.effect(
      () => async () => {
        // Abort new/in-flight work before cleanup regardless of Cordis disposer
        // ordering. GrokImagineClient.dispose() is intentionally idempotent.
        imagine.dispose()
        releaseRetention()
        try {
          await media.cleanup()
        } catch {
          logger.warn('Imagine media cleanup failed')
        }
      },
      'avn-subscription-auth: Imagine client and media lifetime',
    )
  })

  // Only adapters and LLM-backed model resolution depend on this service. Its
  // child fiber may unload and reload without disturbing OAuth/Web ownership.
  ctx.inject(['llm'], (llmCtx) =>{
    applyOwnedLlm(llmCtx, config, { grok, subscriptions, runtime, codexAuth, codexModels, mediaReadiness, logger }) },
  )
}

interface OwnedLlmDependencies {
  readonly grok: GrokBuildSession
  readonly subscriptions: readonly OAuthProviderSession[]
  readonly runtime: CapabilityRuntimeState
  readonly codexAuth: ReturnType<typeof codexAuthFromSession>
  readonly codexModels: ReturnType<typeof createCodexModelCapabilities>
  /** Live media-credential view; the Codex image tools are withdrawn when it is false. */
  readonly mediaReadiness: MediaCredentialReadiness
  readonly logger: ReturnType<Context['logger']>
}

/** LLM-only child runtime, independently restarted by Cordis when LLM changes. */
function applyOwnedLlm(ctx: Context, config: Config, owner: OwnedLlmDependencies): void {
  createAvnHostAdapter(ctx).assertCompatible()
  const resolveCodexImageRoute: ResolveCodexImageRoute = exec =>
    resolveCodexImageRouteFromLlm(exec, (provider, model, signal) => ctx.llm.resolveModelInfo(provider, model, signal))
  const adapterRegistration = ctx.llm.registerAdapter(
    [...CODING_OAUTH_ROUTES],
    createCodingOAuthAdapter(owner.grok, owner.subscriptions, () => ctx.get('attachments'), config.retryPolicy, {
      codexFast: {
        isEligible: modelId => owner.runtime.current().codexFast && owner.codexModels.isPriorityEligible(modelId),
      },
    }),
  )
  ctx.effect(() => adapterRegistration, 'avn-subscription-auth: OAuth LLM adapters')
  ctx.effect(
    () =>
      bindCodexFastRoute(owner.runtime, owner.codexModels, adapterRegistration, {
        /* v8 ignore next -- Fast eligibility refresh failures are contained */
        onError: () =>{  owner.logger.warn('Codex Fast eligibility refresh failed closed') },
      }),
    'avn-subscription-auth: Codex Fast route',
  )
  ctx.inject(['tools', 'attachments'], async (toolCtx) => {
    const tools = toolCtx.get('tools') as CapabilityToolRegistry
    const attachments = toolCtx.get('attachments') as AttachmentStore
    // No media store here: this registration exposes only the Codex image
    // tools, and Codex produces no video artifact.
    const saveToWorkspace = createWorkspaceArtifactWriter(toolCtx, attachments)
    const definitions = (
      await createCapabilityTools({
        current: () => owner.runtime.current(),
        auth: owner.codexAuth,
        attachments,
        imagine: unavailableImagineClient(),
        resolveCodexImageRoute,
        ...optionalWorkspaceWriter(saveToWorkspace),
      })
    ).filter(definition => CODEX_TOOL_NAMES.has(definition.name))
    toolCtx.effect(
      () => bindCapabilityTools(owner.runtime, tools, definitions, () => owner.mediaReadiness),
      'avn-subscription-auth: Codex image tools',
    )
  })
}
