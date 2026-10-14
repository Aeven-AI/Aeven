/**
 * Persistent OAuth session and model catalogue for one subscription provider.
 * @module @aeven/subscription-auth/oauth-session
 */

import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { writeFileAtomic } from '@aeven/atomic-write'
import { resolveAvnHome } from '@aeven/home-paths'
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
import { parseModelsCache } from './models-cache.ts'
import { OAuthCredentialFileStore, oauthCredentialPath } from './store.ts'


/**
 * Oauth models cache path.
 * @param basename - Basename value.
 * @param avnHome - Avn home value.
 * @returns The resulting oauth models cache path.
 */
export function oauthModelsCachePath(basename: string, avnHome?: string): string {
  return resolve(join(resolveAvnHome(avnHome), basename))
}

/** One model the provider's live listing reports. */
export interface LiveSubscriptionModel {
  readonly id: string
  /** Display name, when the listing states one. */
  readonly name?: string
  /** Whether the model accepts image input, when the listing states it. */
  readonly imageInput?: boolean
}

/** Options for {@link OAuthProviderSession}. */
export interface OAuthProviderSessionOptions {
  /** Called whenever the served model list may have changed. */
  readonly onCatalogChange?: () => void
  /** Whether the user keeps a model on; every model is on when omitted. */
  readonly isSelected?: (modelId: string) => boolean
  readonly store?: OAuthCredentialFileStore
  /** Live listing cache path; defaults under `${AVN_HOME}`. */
  readonly cacheFile?: string
}

const MODELS_CACHE_VERSION = 1

function parseLiveModels(text: string): LiveSubscriptionModel[] | undefined {
  const document = parseModelsCache(text)
  if (document === undefined) return undefined
  if (document['version'] !== MODELS_CACHE_VERSION || !Array.isArray(document['models'])) return undefined
  const models: LiveSubscriptionModel[] = []
  for (const row of document['models'] as unknown[]) {
    if (typeof row !== 'object' || row === null) continue
    const entry = row as Record<string, unknown>
    if (typeof entry['id'] !== 'string' || entry['id'].length === 0) continue
    models.push({
      id: entry['id'],
      ...(typeof entry['name'] === 'string' ? { name: entry['name'] } : {}),
      ...(typeof entry['imageInput'] === 'boolean' ? { imageInput: entry['imageInput'] } : {}),
    })
  }
  return models.length === 0 ? undefined : models
}

function sameLiveModels(a: readonly LiveSubscriptionModel[] | undefined, b: readonly LiveSubscriptionModel[]): boolean {
  if (a === undefined || a.length !== b.length) return false
  return a.every((model, index) => {
    const other = b[index]
    return other !== undefined && model.id === other.id && model.name === other.name && model.imageInput === other.imageInput
  })
}

/**
 * Turn one live listing row into a pi-ai model. A catalog entry with the same
 * id keeps its tuned metadata; an id the catalog does not know inherits the
 * newest catalog entry's transport and limits under its own id and name.
 * @param live - the listing row.
 * @param catalog - the shipped catalog of the same provider.
 * @returns the model to serve, or undefined when the catalog is empty.
 */
export function materializeSubscriptionModel(
  live: LiveSubscriptionModel,
  catalog: readonly Model<Api>[],
): Model<Api> | undefined {
  const exact = catalog.find(model => model.id === live.id)
  const template = exact ?? catalog.at(-1)
  if (template === undefined) return undefined
  const input: Model<Api>['input'] =
    live.imageInput === undefined ? template.input : live.imageInput ? ['text', 'image'] : ['text']
  return {
    ...template,
    id: live.id,
    name: live.name ?? (exact === undefined ? live.id : template.name),
    input,
  }
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
  private readonly onCatalogChange: (() => void) | undefined
  private readonly isSelected: (modelId: string) => boolean
  private live: readonly LiveSubscriptionModel[] | undefined

  /**
   * @param definition - the provider this session signs in to.
   * @param options - change notification, selection, and storage overrides.
   */
  constructor(
    readonly definition: OAuthProviderDefinition,
    options: OAuthProviderSessionOptions = {},
  ) {
    const store = options.store ?? new OAuthCredentialFileStore(
      definition.nativeProviderId,
      oauthCredentialPath(definition.authFilename),
      definition.route,
    )
    this.store = store
    this.cacheFile = resolve(options.cacheFile ?? oauthModelsCachePath(definition.modelsCacheFilename))
    const provider = definition.providerFactory()
    this.catalog = [...provider.getModels()]
    this.models = createModels({ credentials: store })
    this.models.setProvider(provider)
    this.onCatalogChange = options.onCatalogChange
    this.isSelected = options.isSelected ?? (() => true)
  }

  /**
   * Every model the account offers: the last live listing when one was read,
   * otherwise the shipped catalog.
   * @returns The available models.
   */
  availableModels(): Model<Api>[] {
    if (this.live === undefined) return [...this.catalog]
    return this.live.flatMap(model => materializeSubscriptionModel(model, this.catalog) ?? [])
  }

  /**
   * The models the user keeps selected, in listing order.
   * @returns The selected subset of {@link availableModels}.
   */
  visibleModels(): Model<Api>[] {
    return this.availableModels().filter(model => this.isSelected(model.id))
  }

  /**
   * Replace the live listing. An unchanged listing neither writes the cache nor notifies.
   * @param models - the provider's current listing; an empty listing is ignored so a bad answer cannot empty the picker.
   */
  async setLiveModels(models: readonly LiveSubscriptionModel[]): Promise<void> {
    if (models.length === 0 || sameLiveModels(this.live, models)) return
    this.live = [...models]
    await writeFileAtomic(
      this.cacheFile,
      `${JSON.stringify({ version: MODELS_CACHE_VERSION, models: this.live, fetchedAt: Date.now() })}\n`,
      { mode: 0o600, dirMode: 0o700 },
    )
    this.onCatalogChange?.()
  }

  /** Tell model discovery that the selection changed. */
  notifySelectionChange(): void {
    this.onCatalogChange?.()
  }

  /**
   * Provider.
   * @returns The resulting provider.
   */
  provider(): Provider {
    return this.definition.requestProvider(this.visibleModels())
  }

  /** Restore the last live listing, which serves until the next sync replaces it. */
  async loadCachedModels(): Promise<void> {
    let text: string
    try {
      text = await readFile(this.cacheFile, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return
      throw error
    }
    const models = parseLiveModels(text)
    if (models === undefined) return
    this.live = models
    this.onCatalogChange?.()
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
      this.live = undefined
      await mkdir(dirname(this.cacheFile), { recursive: true, mode: 0o700 })
      await rm(this.cacheFile, { force: true })
    } finally {
      // Credential deletion may succeed before cache cleanup fails. Always
      // refresh discovery so an open selector cannot retain stale models.
      this.onCatalogChange?.()
    }
  }

}
