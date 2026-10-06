/**
 * Generic pi-ai-backed LLM adapter plugin. One plugin instance owns a dict of
 * provider routes; a route naming an installed pi-ai provider inherits that
 * provider's endpoint, protocol, and model catalog as defaults, and a route
 * pi-ai does not ship is declared outright. Profile facts resolve per request
 * over the optional `llm-pi-ai` user-settings section and the optional
 * credential seam, so a changed key, endpoint, model, or knob reaches the next
 * request without a restart; a changed *route set* (or a route's
 * registration-captured retry policy) re-registers the same adapter instance
 * in place.
 *
 * ```yaml
 * - id: llm
 *   name: '@aeven/llm-pi-ai'
 *   config:
 *     providers:
 *       # Catalog route: everything but the credential comes from pi-ai.
 *       openai:
 *         apiKeyEnv: OPENAI_API_KEY
 *         retryPolicy:
 *           mode: normal
 *           maxRetries: 2
 *       # Catalog route with the catalog narrowed and one capacity corrected.
 *       anthropic:
 *         apiKeyEnv: ANTHROPIC_API_KEY
 *         models:
 *           - id: claude-sonnet-4-5
 *             contextWindow: 200000
 *       # Hand-declared route: pi-ai ships nothing under this key.
 *       acme-gateway:
 *         displayName: Acme Gateway
 *         apiKeyEnv: ACME_GATEWAY_API_KEY
 *         api: openai-completions
 *         baseURL: https://gateway.acme.example/v1
 *         # Reasoning dialect for a URL pi-ai cannot recognize.
 *         compat:
 *           thinkingFormat: deepseek
 *         models:
 *           - id: acme-large
 *             name: Acme Large
 *             contextWindow: 65536
 *             maxTokens: 4096
 *           - id: acme-think
 *             name: Acme Think
 *             contextWindow: 262144
 *             maxTokens: 32768
 *             # key = selectable level, value = wire spelling; only off may
 *             # leave the value empty (supported, send nothing).
 *             reasoningEfforts:
 *               off:
 *               high: high
 *               max: ultra
 * ```
 *
 * @module @aeven/llm-pi-ai
 */

import type { Api, Model } from '@earendil-works/pi-ai'
import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@aeven/launch-environment'
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess } from '@aeven/llm'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle, LlmConfigurableProvider } from '@aeven/llm'
import type {} from '@aeven/fs'
import type {} from '@aeven/settings'
import { deepEqualJson } from '@aeven/util-values'
import { PiAiAdapter } from './adapter.ts'
import { authContextFrom, credentialStoreFrom } from './auth.ts'
import { catalogModels, catalogProvider, catalogProviderIds, vendorOutputCap } from './catalog.ts'
import { KNOWN_ROUTES, knownRoute } from './known-routes.ts'
import { assertServiceable, Config, resolveProfiles } from './config.ts'
import type { ResolvedPiAiProviderProfile } from './config.ts'
import { discoverModels } from './discovery.ts'
import { fetchLiveAdditions } from './live-catalog.ts'
import type { StoredModelDiscoveryProfile } from './discovery.ts'
import { registerPiAiFlows } from './login.ts'

export { PiAiAdapter } from './adapter.ts'
export type { PiAiAdapterOptions } from './adapter.ts'
export { Config } from './config.ts'
export type {
  PiAiCompatProfile,
  PiAiModality,
  PiAiModelOverride,
  PiAiModelProfile,
  PiAiProviderProfile,
  PiAiReasoningEfforts,
  PiAiThinkingFormat,
  ResolvedPiAiProviderProfile,
} from './config.ts'
export { recordKeyFor } from './auth.ts'
export { supportedProtocols } from './provider.ts'

export const name = 'llm-pi-ai'
export const inject = ['llm']

const NS = 'llm-pi-ai'

/**
 * The registry captures these per route; a change here must re-register.
 * Sorted by provider so a settings document that merely reorders its keys is
 * not mistaken for a route change.
 */
function registrationFacts(profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>): unknown {
  return [...profiles.entries()]
    // `displayName` rides along because the registry hands it to every selector
    // through `providerInfo()`: a rename that did not re-register would leave
    // the old label showing until some unrelated fact happened to change.
    .map(([provider, profile]) => ({
      provider,
      displayName: profile.displayName,
      retryPolicy: profile.retryPolicy,
    }))
    .sort((left, right) => left.provider.localeCompare(right.provider))
}

/**
 * The configurable-provider directory: every installed catalog route, plus
 * every route the current profiles declare. A hand-declared route has no
 * catalog entry, so without this union it would have no settings address and
 * configuration surfaces could neither show nor edit it.
 * @param profiles - the currently resolved provider profiles.
 * @returns the directory entries ordered by display name.
 */
function directoryEntries(
  profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>,
): LlmConfigurableProvider[] {
  const catalog = new Set(catalogProviderIds())
  const entries = new Map<string, LlmConfigurableProvider>()
  const declare = (provider: string, displayName: string): void => {
    entries.set(provider, {
      provider,
      displayName,
      settingsNs: NS,
      settingsPath: ['providers', provider],
      // First-party knowledge, not membership of the settings document:
      // narrowing a shipped provider's models stores a profile too, and that
      // route is still one pi-ai knows. A known route counts as first-party
      // for the same reason — this package supplies its protocol, endpoint,
      // and model document, so a stored profile there is a credential, not a
      // route someone had to describe.
      declared: !catalog.has(provider) && knownRoute(provider) === undefined,
    })
  }
  for (const provider of catalog) declare(provider, catalogProvider(provider)?.name ?? provider)
  // Known routes join the directory beside the catalog's own: pi-ai ships
  // nothing about them, but this package supplies the protocol, endpoint, and
  // model document, so adding a credential is the whole step here too.
  for (const [provider, route] of Object.entries(KNOWN_ROUTES)) declare(provider, route.displayName)
  for (const [provider, profile] of profiles) declare(provider, profile.displayName)
  // Ordered for reading rather than by how the entries were gathered: catalog
  // first, then known routes, then configured profiles is an assembly order,
  // and it put every route this package adds at the end of the list.
  return [...entries.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName, undefined, { numeric: true, sensitivity: 'base' }))
}

/** Register one generic pi-ai adapter for all configured provider routes. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let lastRaw: Config | undefined
  let memoized: ReadonlyMap<string, ResolvedPiAiProviderProfile> | undefined
  /**
   * The resolved profiles for the current configuration, memoized by the raw
   * snapshot's identity — which is also what makes the adapter's own snapshot
   * stable across operations that observe no change.
   *
   * No fallback for an unserviceable snapshot lives here: the section schema
   * resolves the whole profile set, so a write that could not be served is
   * refused where it is written, and the settings seam keeps a namespace's
   * last good value for a stored section that fails. Anything reaching this
   * point has already resolved once.
   */
  // Models a completed live refresh added, by route. Empty until a refresh
  // resolves, so the first resolution — and every resolution on a deployment
  // that configures no refresh — serves the installed snapshot alone.
  const liveModels = new Map<string, readonly Model<Api>[]>()
  /** Routes a refresh has already been attempted for, so an edit does not re-fetch them. */
  const attempted = new Set<string>()
  const profiles = (): ReadonlyMap<string, ResolvedPiAiProviderProfile> => {
    const raw = current()
    if (raw === lastRaw && memoized !== undefined) return memoized
    const next = resolveProfiles(raw.providers, liveModels)
    lastRaw = raw
    memoized = next
    return next
  }
  profiles()

  const resolveApiKey = async (
    provider: string,
    profile: ResolvedPiAiProviderProfile,
  ): Promise<string | undefined> => {
    const ref = profile.apiKeyEnv
    // Only a profile that names no credential at all defers to pi-ai's
    // provider-native discovery. Once one is named, a miss must fail loud:
    // handing pi-ai `undefined` would let it pick up an unrelated ambient key
    // (OPENAI_API_KEY and friends), billing another tenant for a request the
    // deployment meant to authenticate differently.
    if (ref === undefined) return undefined
    const credentials = ctx.get('credentials')
    const hit = credentials !== undefined
      ? (await credentials.resolve(ref))?.value
      // Without the seam the environment is the whole credential plane.
      : launchEnvironmentOf(ctx).get(ref)?.value
    if (hit !== undefined && hit.length > 0) return assertUsableApiKey(hit, 'llm-pi-ai', ref)
    throw new LlmError(
      `llm-pi-ai: no credential for provider route "${provider}"; its profile resolves ${ref}, which is not`
      + ` set — store ${ref} through the credentials service (the web Models page writes it) or export it,`
      + ' and remove apiKeyEnv only if this provider should authenticate from pi-ai\'s own environment discovery',
      'MISSING_CREDENTIAL',
    )
  }

  // One store and one ambient context for the whole plugin instance: both read
  // through `ctx` per call, so they stay correct across the collection rebuilds
  // a configuration change causes, and a sign-in survives one.
  const auth = { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) }
  const adapter = new PiAiAdapter({
    profiles,
    resolveApiKey,
    auth,
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
    onReplayDegrade: ({ provider, model, reason }) => {
      ctx.logger.warn(
        `llm-pi-ai: unusable replay state on assistant history for route "${provider}/${model}";`
        + ` sending that message as provider-neutral content (${reason})`,
      )
    },
  })
  // Independent of the route set: signing in is what makes a route worth
  // adding, so the flows are offered before any profile names their provider.
  // Scoped to the authorization seam rather than injected outright, because a
  // composition without it (headless, ACP) simply has no surface to sign in
  // from, while everything else this plugin does still works.
  ctx.inject(['authorization'], (authorized) => { registerPiAiFlows(authorized, auth) })
  // The full installed catalog is configurable from the moment the plugin
  // mounts — dormant or not — so configuration surfaces can offer every
  // pi-ai provider before any route exists. Hand-declared routes join it as
  // profiles appear, and leave with them.
  let directory: DirectoryRegistrationHandle | undefined
  let directoryFacts: unknown
  const ensureDirectory = (): void => {
    const entries = directoryEntries(profiles())
    if (deepEqualJson(entries, directoryFacts)) return
    // Atomic replace, never dispose-then-register: a route another adapter
    // family already declares (a profile keyed `deepseek-official`) would
    // otherwise leave this plugin's whole directory withdrawn and the Models
    // page empty. The candidate set is validated first, so a collision keeps
    // the previous entries serving and only costs a diagnostic.
    if (directory === undefined) {
      directory = ctx.llm.registerConfigurableProviders(entries)
    } else {
      directory.replace(entries)
    }
    directoryFacts = entries
  }
  ensureDirectory()
  /** Host-owned request inputs for discovery of one configured route. */
  const storedDiscoveryProfile = (
    provider: string | undefined,
  ): StoredModelDiscoveryProfile | undefined => {
    if (provider === undefined) return undefined
    const profile = profiles().get(provider)
    if (profile === undefined) return undefined
    return {
      headers: profile.headers,
      resolveApiKey: () => resolveApiKey(provider, profile),
    }
  }
  // Interrogating an endpoint is a configuration-time action over a draft, so
  // it is offered for the whole namespace rather than per route: the provider
  // a surface is adding does not exist yet. The draft is the whole request
  // except the stored credential and deployment-owned headers: the curated UI
  // accepts neither, so an already-configured route supplies both inside the
  // Host rather than widening the discovery request.
  ctx.llm.registerModelDiscovery(NS, (request, signal) => discoverModels(
    { ...request, ...signal === undefined ? {} : { signal } },
    () => storedDiscoveryProfile(request.provider),
  ))
  // Route effects bind to this apply fiber via the stable `ctx` reference,
  // even when a swap runs inside the scoped settings callback below. A bare
  // mount (zero routes) is the dormant posture: nothing registers until a
  // settings section supplies profiles, and routes drop when it empties.
  let registration: AdapterRegistrationHandle | undefined
  let registeredFacts: unknown
  const ensureRegistrationFacts = (): void => {
    const facts = registrationFacts(profiles())
    if (deepEqualJson(facts, registeredFacts)) return
    // The registry captures the route set and each route's retry policy at
    // registration, so a change to either must re-register. The swap is
    // atomic (same adapter instance, validated before anything moves): a
    // conflicting route leaves the previous routes serving requests, and
    // `registeredFacts` only advances once the registry actually holds the
    // new set — so returning to a working configuration always re-applies.
    const routes = [...profiles().keys()]
    if (registration === undefined) {
      // Dormant bare mount: nothing is registered until a section supplies
      // profiles, and an empty section keeps it that way.
      if (routes.length === 0) {
        registeredFacts = facts
        return
      }
      registration = ctx.llm.registerAdapter(routes, adapter)
    } else {
      registration.replace(routes)
    }
    registeredFacts = facts
  }
  ensureRegistrationFacts()

  /**
   * Re-register the routes and the directory from the current profiles.
   *
   * Both callers — a settings change and a completed catalog refresh — keep
   * the previously registered routes when the swap is refused, so a
   * configuration that cannot serve never takes the working one down with it.
   */
  const rebuildRoutes = (): void => {
    // Named here rather than left to the settings watcher: `assertServiceable`
    // cannot see the llm registry, so a profile claiming a route another
    // adapter family owns is stored successfully and only fails at this swap.
    // Without its own diagnostic that refusal reaches the operator as a
    // generic "settings: watcher failed", naming neither the route nor why it
    // is not serving.
    try {
      ensureRegistrationFacts()
    } catch (error) {
      ctx.logger.error('llm-pi-ai: keeping the previously registered routes after a refused update')
      ctx.logger.error(error)
    }
    // The directory follows the profiles the registry accepted, so a route
    // that failed to register is not advertised as configurable. A refused
    // directory swap is contained for the same reason the registry's is: the
    // previous entries keep serving, and `directoryFacts` stays put so
    // returning to a working configuration re-applies.
    try {
      ensureDirectory()
    } catch (error) {
      ctx.logger.error('llm-pi-ai: keeping the previously advertised configurable routes after a refused update')
      ctx.logger.error(error)
    }
  }

  /**
   * Fetch every configured route's live model document once, then re-resolve
   * so the added models reach the catalog. Refresh is best-effort by design:
   * a route whose document is unreachable, slow, or malformed keeps serving
   * the installed snapshot, because a provider's list being briefly
   * unavailable must not take the route down with it.
   */
  const refreshCatalogs = async (signal: AbortSignal): Promise<void> => {
    let added = false
    for (const [provider, profile] of profiles()) {
      const refresh = profile.catalogRefresh
      // One attempt per route per configuration: routes arrive from settings
      // after mount, so this runs again on every change, and a route already
      // tried must not re-fetch on an unrelated edit.
      if (refresh === undefined || attempted.has(provider)) continue
      attempted.add(provider)
      const catalog = catalogModels(provider)
      const installed = new Set(catalog.keys())
      const baseUrl = profile.baseURL ?? catalogProvider(provider)?.baseUrl
      // Added models must declare a protocol and an endpoint. The route's own
      // configuration answers first; otherwise the installed catalog answers,
      // but only when its models agree — a route spanning two protocols has no
      // single answer to give a model it has never described.
      const apis = new Set([...catalog.values()].map(model => model.api))
      const api = profile.api ?? (apis.size === 1 ? [...apis][0] : undefined)
      if (baseUrl === undefined || api === undefined) {
        ctx.logger.warn(
          `llm-pi-ai: provider route "${provider}" configures catalogRefresh but resolves no single`
          + ' baseURL and api for models the installed catalog does not describe; name both on the route',
        )
        continue
      }
      try {
        const models = await fetchLiveAdditions(refresh.url, refresh.timeoutMs, installed, {
          provider,
          api,
          baseUrl,
          defaultContextWindow: refresh.defaultContextWindow,
          defaultMaxTokens: refresh.defaultMaxTokens,
          format: refresh.format,
          requireTags: refresh.requireTags,
          vendorOutputCap,
        }, signal)
        if (models.length === 0) continue
        liveModels.set(provider, models)
        added = true
        ctx.logger.info(
          `llm-pi-ai: provider route "${provider}" added ${String(models.length)} model(s)`
          + ` from ${refresh.url} beyond the ${String(installed.size)} the installed catalog ships`,
        )
      } catch (error) {
        if (signal.aborted) return
        ctx.logger.warn(
          `llm-pi-ai: provider route "${provider}" could not refresh its model list from ${refresh.url};`
          + ' serving the installed catalog instead',
        )
        ctx.logger.warn(error)
      }
    }
    // One invalidation for the whole pass: the memo keys on the raw snapshot's
    // identity, which a refresh does not change, so it is cleared explicitly.
    if (added) {
      lastRaw = undefined
      memoized = undefined
      // A widened catalog only reaches selectors once the routes and the
      // directory are rebuilt from the re-resolved profiles.
      rebuildRoutes()
    }
  }

  // One controller for every pass: the routes present once settings have been
  // installed, and the ones that arrive from later edits, share the plugin's
  // cancellation.
  const refreshes = new AbortController()

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, NS, Config, config, {
      // Refuse an unserviceable section where it is written: without this a
      // schema-valid profile the adapter cannot serve would be stored and then
      // silently disable every route in this namespace.
      validate: assertServiceable,
      setSource: (source) => {
        current = source
      },
      onChange: () => {
        // A route configuring a refresh usually arrives here rather than at
        // mount: the shipped posture is dormant, and settings supply the
        // profiles. Routes already attempted are skipped inside, and a pass
        // after disposal finds its signal already aborted.
        void refreshCatalogs(refreshes.signal)
        rebuildRoutes()
      },
    })
  })

  // Registered after the settings section: a profile stored on disk reaches
  // `current` during that install, and a pass before it would see the dormant
  // route set and never revisit a route the file already configured.
  ctx.effect(() => {
    void refreshCatalogs(refreshes.signal)
    return () => { refreshes.abort() }
  }, 'llm-pi-ai: live catalog refresh')
}
