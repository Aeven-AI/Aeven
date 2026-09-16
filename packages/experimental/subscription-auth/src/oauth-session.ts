/**
 * Persistent OAuth session and model catalogue for one subscription provider.
 * @module @aeven/experimental-subscription-auth/oauth-session
 */

import { mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { resolveDshHome } from '@aeven/home-paths'
import type {
  Api,
  AuthInteraction,
  Credential,
  Model,
  MutableModels,
  OAuthCredential,
  Provider,
} from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai'
import type { OAuthProviderDefinition } from './oauth-providers.ts'
import { OAuthCredentialFileStore, oauthCredentialPath } from './store.ts'


/**
 * Oauth models cache path.
 * @param basename - Basename value.
 * @param dshHome - Dsh home value.
 * @returns The resulting oauth models cache path.
 */
export function oauthModelsCachePath(basename: string, dshHome?: string): string {
  return resolve(join(resolveDshHome(dshHome), basename))
}

/** Reported oauth provider status. */
export interface OAuthProviderStatus {
  authenticated: boolean
  expiresAt?: number
}

/** Oauth provider session implementation. */
export class OAuthProviderSession {
  /** Store implementation. */
  readonly store: OAuthCredentialFileStore
  /** Models implementation. */
  readonly models: MutableModels
  private readonly catalog: readonly Model<Api>[]
  private readonly cacheFile: string

  constructor(
    readonly definition: OAuthProviderDefinition,
    onCatalogChange?: () => void,
    store: OAuthCredentialFileStore = new OAuthCredentialFileStore(
      definition.nativeProviderId,
      oauthCredentialPath(definition.authFilename),
      definition.route,
    ),
    cacheFile: string = oauthModelsCachePath(definition.modelsCacheFilename),
  ) {
    this.store = store
    this.cacheFile = resolve(cacheFile)
    const provider = definition.providerFactory()
    this.catalog = [...provider.getModels()]
    this.models = createModels({ credentials: store })
    this.models.setProvider(provider)
    this.onCatalogChange = onCatalogChange
  }

  private onCatalogChange: (() => void) | undefined

  /**
   * Return the available models.
   * @returns The available models.
   */
  availableModels(): Model<Api>[] {
    return [...this.catalog]
  }

  /**
   * Every model the subscription grants. There is no per-provider selection:
   * a subscription's whole catalogue is offered, so this is the catalogue.
   * @returns The visible models.
   */
  visibleModels(): Model<Api>[] {
    return this.availableModels()
  }

  /**
   * Provider.
   * @returns The resulting provider.
   */
  provider(): Provider {
    return this.definition.requestProvider(this.visibleModels().map(model => model.id))
  }

  /**
   * Retained so callers keep one startup shape across session kinds; the model
   * catalogue no longer carries a persisted per-provider selection.
   */
  async loadCachedModels(): Promise<void> {
    await Promise.resolve()
  }

  /**
   * Return the current state.
   * @returns The status.
   */
  async status(): Promise<OAuthProviderStatus> {
    const credential = await this.store.read(this.definition.nativeProviderId)
    if (credential?.type !== 'oauth') return { authenticated: false }
    return { authenticated: true, expiresAt: credential.expires }
  }

  /**
   * Start the provider sign-in flow.
   * @param interaction - Interaction handler for the sign-in flow.
   * @returns The resulting login.
   */
  async login(interaction: AuthInteraction): Promise<Credential> {
    const credential = await this.models.login(this.definition.nativeProviderId, 'oauth', interaction)
    this.onCatalogChange?.()
    return credential
  }

  /**
   * Resolve access token.
   * @returns The resolved access token.
   */
  async resolveAccessToken(): Promise<string | undefined> {
    const resolved = await this.models.getAuth(this.definition.nativeProviderId)
    if (resolved === undefined) return undefined
    const credential = await this.store.read(this.definition.nativeProviderId)
    return credential?.type === 'oauth' ? credential.access : undefined
  }

  /**
	 * Backdate the stored token's expiry so the next `getAuth()` refreshes.
	 * Called after an upstream 401 rejected a locally-valid token.
	 */
  async invalidateAccessToken(): Promise<void> {
    await this.store.invalidate(this.definition.nativeProviderId)
  }

  /** Refresh host discovery after an account switch/remove without a full logout. */
  notifyCredentialChange(): void {
    this.onCatalogChange?.()
  }

  /**
   * Return the stored credential.
   * @returns The resulting stored credential.
   */
  async storedCredential(): Promise<OAuthCredential | undefined> {
    const credential = await this.store.read(this.definition.nativeProviderId)
    return credential?.type === 'oauth' ? credential : undefined
  }

  /** End the provider session and remove its stored credential. */
  async logout(): Promise<void> {
    try {
      await this.models.logout(this.definition.nativeProviderId)
      await mkdir(dirname(this.cacheFile), { recursive: true, mode: 0o700 })
      await rm(this.cacheFile, { force: true })
    } finally {
      // Credential deletion may succeed before cache cleanup fails. Always
      // refresh discovery so an open selector cannot retain stale models.
      this.onCatalogChange?.()
    }
  }

}
