/**
 * Subscriptions per account, for a Host that serves the accounts of different people. Each signed-in account signs
 * in to its own Grok Build and ChatGPT Codex subscriptions: their credentials, live model listings, and model
 * selection live under `accounts/<account>/subscriptions/` in the harness home, their model routes are that
 * account's own, and the web routes answer each request from the account that made it. Nothing is shared with the
 * Host user's own subscriptions, including their `~/.grok` sign-in.
 *
 * Subscription image and video generation, Codex search, and their tools register once per Host, so they are not
 * offered in this mode.
 * @module
 */
import { join } from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@aeven/agent'
import type {} from '@aeven/host-webserver'
import { accountHomePath } from '@aeven/home-paths'
import type {} from '@aeven/identity-user'
import { createCodingOAuthAdapter } from './adapter.ts'
import { createAvnHostAdapter } from './avn-host-adapter.ts'
import { createCodingOAuthRouteSet, registerCodingOAuthRouteHandlers, type CodingOAuthRouteSet } from './auth-routes.ts'
import { registerCapabilityRoutes } from './capability-routes.ts'
import {
  CAPABILITY_SETTINGS_NAMESPACE,
  resolveCapabilitySettings,
  type CapabilitySettingsPatch,
  type CapabilitySettingsSnapshot,
} from './capability-settings.ts'
import { codexAuthFromSession } from './codex-http.ts'
import { createCodexModelCapabilities } from './codex-model-capabilities.ts'
import { createCodexUsageReader } from './codex-usage.ts'
import { createCodexProviderUsageReader } from './codex-usage-adapter.ts'
import { createGrokUsageReader } from './grok-usage.ts'
import { CODEX_PI_PROVIDER, CODING_OAUTH_ROUTES } from './ids.ts'
import type { RetryPolicyConfig } from '@aeven/llm'
import { MODEL_SELECTION_FILENAME, ModelSelection } from './model-selection.ts'
import { startModelSync, type ModelSync } from './model-sync.ts'
import { OAUTH_PROVIDER_DEFINITIONS } from './oauth-providers.ts'
import { OAuthProviderSession, oauthModelsCachePath } from './oauth-session.ts'
import { GrokBuildSession, grokModelsCachePath } from './session.ts'
import { GrokBuildCredentialStore, grokBuildAuthPath, OAuthCredentialFileStore, oauthCredentialPath } from './store.ts'
import { subscriptionModelSelection, syncCodexModels } from './subscription-catalog.ts'
import type { UsageReader } from './usage-reader.ts'
import type { OwnerRequestPolicy } from './web-origin.ts'

/** What account mode reads from the plugin configuration. */
export interface AccountSubscriptionsOptions {
  readonly retryPolicy?: RetryPolicyConfig
  readonly capabilities?: CapabilitySettingsPatch
  readonly modelSyncIntervalMs: number
}

/** One account's subscriptions. */
interface AccountSubscriptions {
  readonly routes: CodingOAuthRouteSet
  readonly usageReaders: Readonly<Record<string, UsageReader>>
  readonly dispose: () => Promise<void>
}

/**
 * Who may call the subscription routes on such a Host: the signed-in account a request carries. A request that
 * changes something must also come from a page of this Host, so another site cannot sign a reader in or out.
 * @param ctx - Host context carrying the identity service.
 * @returns the request policy.
 */
function accountRequestPolicy(ctx: Context): OwnerRequestPolicy {
  return {
    authorize: (req: IncomingMessage) => {
      const user = ctx.get('identityUsers')?.resolve({ headers: req.headers })
      if (user === undefined) return { authorized: false, reason: 'unauthenticated' }
      if (req.method !== 'GET' && !sameOrigin(req)) return { authorized: false, reason: 'origin' }
      return { authorized: true, accessMode: 'trusted-https-proxy' }
    },
    diagnostics: () => [],
  } as unknown as OwnerRequestPolicy
}

/**
 * Whether a request's `Origin` names the host it was sent to.
 * @param req - the request.
 * @returns whether the request came from a page of this Host.
 */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  const host = req.headers.host
  if (origin === undefined || host === undefined || !URL.canParse(origin)) return false
  return new URL(origin).host === host
}

/**
 * The account a call is for: the owner of the Session whose work runs, else the signed-in caller.
 * @param ctx - Host context.
 * @returns the account, or undefined.
 */
function currentAccount(ctx: Context): string | undefined {
  return ctx.get('agents')?.currentInitiator()?.session.header.owner ?? ctx.get('identityUsers')?.actingUser()?.id
}

/**
 * Serve subscriptions per account: sign-in, status, model selection, usage, and model routes.
 * @param ctx - the plugin's owner context.
 * @param options - retry policy, capability defaults, and the model sync interval.
 */
export function applyAccountSubscriptions(ctx: Context, options: AccountSubscriptionsOptions): void {
  const logger = ctx.logger('avn-subscription-auth')
  const host = createAvnHostAdapter(ctx)
  const accounts = new Map<string, AccountSubscriptions>()
  let active = true
  ctx.effect(() => () => {
    active = false
    const closing = [...accounts.values()].map(account => account.dispose())
    accounts.clear()
    return Promise.all(closing).then(() => undefined)
  }, 'avn-subscription-auth: account subscriptions')

  const notifyCatalogChange = (): void => {
    if (!active) return
    try {
      ctx.emit('llm/adapters-updated')
    } catch (error) {
      logger.warn('an llm/adapters-updated listener failed')
      logger.warn(error)
    }
  }

  const create = (owner: string): AccountSubscriptions => {
    const home = accountHomePath(owner, 'subscriptions')
    let syncNow = (): void => undefined
    const signedIn = { grok: false, codex: false }
    const watchSignIn = (slug: keyof typeof signedIn, isSignedIn: () => Promise<boolean>): void => {
      void isSignedIn().then((now) => {
        const was = signedIn[slug]
        signedIn[slug] = now
        if (now && !was) syncNow()
      }, () => { signedIn[slug] = false })
    }
    const selection = new ModelSelection((slug) => {
      if (slug === 'grok') grok.notifySelectionChange()
      else codex.notifySelectionChange()
    }, join(home, MODEL_SELECTION_FILENAME))
    const grok = new GrokBuildSession(
      new GrokBuildCredentialStore(grokBuildAuthPath(home)),
      () => {
        usageReaders.grok.clear()
        notifyCatalogChange()
        watchSignIn('grok', grokSignedIn)
      },
      modelId => selection.isSelected('grok', modelId),
      grokModelsCachePath(home),
    )
    const grokSignedIn = async (): Promise<boolean> => (await grok.store.read(grok.store.providerId)) !== undefined
    const subscriptions = OAUTH_PROVIDER_DEFINITIONS.map(definition => new OAuthProviderSession(definition, {
      store: new OAuthCredentialFileStore(
        definition.nativeProviderId,
        oauthCredentialPath(definition.authFilename, home),
        definition.route,
      ),
      cacheFile: oauthModelsCachePath(definition.modelsCacheFilename, home),
      onCatalogChange: () => {
        usageReaders[definition.slug]?.clear()
        notifyCatalogChange()
        watchSignIn(definition.slug, codexSignedIn)
      },
      isSelected: modelId => selection.isSelected(definition.slug, modelId),
    }))
    const found = subscriptions.find(session => session.definition.nativeProviderId === CODEX_PI_PROVIDER)
    if (found === undefined) throw new Error(`missing built-in OAuth provider ${CODEX_PI_PROVIDER}`)
    const codex: OAuthProviderSession = found
    const codexSignedIn = async (): Promise<boolean> => (await codex.status()).authenticated
    const codexAuth = codexAuthFromSession(codex)
    const usage = createCodexUsageReader({ auth: codexAuth })
    const codexModels = createCodexModelCapabilities({ auth: codexAuth })
    const usageReaders: Record<string, UsageReader> & { grok: UsageReader } = {
      codex: createCodexProviderUsageReader({ usage, resolveToken: () => codex.resolveAccessToken() }),
      grok: createGrokUsageReader({
        resolveToken: () => grok.resolveAccessToken(),
        invalidateToken: () => grok.invalidateAccessToken(),
      }),
    }
    const routes = createCodingOAuthRouteSet(
      grok,
      subscriptions,
      accessMode => host.compatibility({ accessMode, uiOwner: 'standalone' }),
      subscriptionModelSelection(grok, codex, selection),
    )
    const adapter = createCodingOAuthAdapter(
      grok,
      subscriptions,
      () => ctx.get('attachments'),
      options.retryPolicy,
    )
    const releaseRoutes = ctx.llm.registerAdapter([...CODING_OAUTH_ROUTES], adapter, owner)
    let sync: ModelSync | undefined
    void Promise.allSettled([
      selection.load(),
      grok.loadCachedCatalog(),
      ...subscriptions.map(session => session.loadCachedModels()),
    ]).then(() => {
      if (!active) return
      grok.notifySelectionChange()
      codex.notifySelectionChange()
      sync = startModelSync({
        intervalMs: options.modelSyncIntervalMs,
        onError: () => { logger.warn('an account subscription model sync failed; the last listing stays in use') },
        providers: [
          { isSignedIn: grokSignedIn, sync: signal => grok.refreshLiveCatalog(signal) },
          {
            isSignedIn: codexSignedIn,
            sync: signal => syncCodexModels(codex, codexModels, signal),
          },
        ],
      })
      syncNow = () => { void sync?.syncNow() }
    })
    return {
      routes,
      usageReaders,
      dispose: async () => {
        sync?.dispose()
        releaseRoutes()
        await routes.dispose()
      },
    }
  }

  const accountOf = (owner: string): AccountSubscriptions => {
    let account = accounts.get(owner)
    if (account === undefined) {
      account = create(owner)
      accounts.set(owner, account)
    }
    return account
  }
  const requestAccount = (req: IncomingMessage): AccountSubscriptions | undefined => {
    const owner = ctx.get('identityUsers')?.resolve({ headers: req.headers })?.id
    return owner === undefined ? undefined : accountOf(owner)
  }

  ctx.llm.registerAccountSource(() => currentAccount(ctx), (owner) => {
    accountOf(owner)
    return Promise.resolve()
  })
  const policy = accountRequestPolicy(ctx)
  registerCodingOAuthRouteHandlers(ctx, policy, req => requestAccount(req)?.routes)
  // Capability switches are the deployment's: a person reads them and cannot change them for everyone.
  const snapshot: CapabilitySettingsSnapshot = {
    ns: CAPABILITY_SETTINGS_NAMESPACE,
    value: resolveCapabilitySettings(options.capabilities),
    ...options.capabilities === undefined ? {} : { base: options.capabilities },
    revision: 0,
    writable: false,
    applies: 'live',
    secrets: [],
  }
  const managed = (): Promise<CapabilitySettingsSnapshot> =>
    Promise.reject(new Error('subscription capabilities are managed by this deployment'))
  registerCapabilityRoutes(ctx, {
    controller: { snapshot: () => snapshot, patch: managed, replace: managed },
    usageReaders: req => requestAccount(req)?.usageReaders,
    ownerRequestPolicy: policy,
  })
}
