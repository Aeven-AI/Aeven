/**
 * Shared OAuth store + live catalog for the host plugin and CLI.
 * @module @aeven/subscription-auth/session
 */

import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { writeFileAtomic } from '@aeven/atomic-write'
import { resolveAvnHome } from '@aeven/home-paths'
import type { Api, Model, MutableModels, Provider } from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai'
import { xaiProvider } from '@earendil-works/pi-ai/providers/xai'
import {
  type CatalogSource,
  fetchLiveModels,
  type LiveModelDescriptor,
  mergeLiveCatalog,
} from './catalog.ts'
import { GROK_BUILD_MODELS_CACHE_FILENAME, GROK_BUILD_ROUTE, XAI_PI_PROVIDER } from './ids.ts'
import { grokBuildBaselineModels, grokBuildProvider } from './provider.ts'
import { safeMessage } from './redact.ts'
import { GrokBuildCredentialStore } from './store.ts'

const MODELS_CACHE_VERSION = 3

interface ModelsCacheDocument {
  version: typeof MODELS_CACHE_VERSION
  ids: string[]
  models?: LiveModelDescriptor[]
  fetchedAt: number
}

interface ParsedCache {
  ids: string[]
  models: LiveModelDescriptor[]
}

function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function modelsCachePath(avnHome?: string): string {
  return resolve(join(resolveAvnHome(avnHome), GROK_BUILD_MODELS_CACHE_FILENAME))
}

function parseIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))]
}

function parseCache(text: string): ParsedCache | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const document = value as Record<string, unknown>
  if (document['version'] !== MODELS_CACHE_VERSION) return undefined
  const ids = parseIdList(document['ids'])
  if (ids.length === 0) return undefined
  const models = Array.isArray(document['models']) ? document['models'].flatMap(cachedDescriptor) : []
  return { ids, models }
}

/**
 * Restore one cached descriptor written by {@link GrokBuildSession.writeCache}.
 * The file is this plugin's own, so a malformed row is dropped rather than repaired.
 */
function cachedDescriptor(row: unknown): LiveModelDescriptor[] {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return []
  const value = row as Record<string, unknown>
  if (typeof value['id'] !== 'string' || value['id'].length === 0) return []
  const descriptor: LiveModelDescriptor = { id: value['id'] }
  if (typeof value['name'] === 'string') descriptor.name = value['name']
  if (typeof value['contextWindow'] === 'number') descriptor.contextWindow = value['contextWindow']
  if (typeof value['reasoning'] === 'boolean') descriptor.reasoning = value['reasoning']
  const map = value['thinkingLevelMap']
  if (typeof map === 'object' && map !== null && !Array.isArray(map)) {
    descriptor.thinkingLevelMap = map as NonNullable<LiveModelDescriptor['thinkingLevelMap']>
  }
  return [descriptor]
}

function asHarnessModels(models: readonly Model<Api>[]): Model<Api>[] {
  return models.map(model => ({ ...model, provider: GROK_BUILD_ROUTE }))
}

/** One process-local owner of the credential and the account model list. */
export class GrokBuildSession {
  /** Store implementation. */
  readonly store: GrokBuildCredentialStore
  /** Models implementation. */
  readonly models: MutableModels
  private readonly baselineCatalog: readonly Model<Api>[]
  private liveIds: string[] | undefined
  private liveModels: readonly LiveModelDescriptor[] | undefined
  private source: CatalogSource = 'fallback'
  private listingError: string | undefined
  private readonly cacheFile: string
  private onCatalogChange: (() => void) | undefined
  private readonly isSelected: (modelId: string) => boolean

  /**
   * @param store - the Grok OAuth credential file.
   * @param onCatalogChange - called whenever the served model list may have changed.
   * @param isSelected - whether the user keeps a model on; every model is on when omitted.
   */
  constructor(
    store: GrokBuildCredentialStore = new GrokBuildCredentialStore(),
    onCatalogChange?: () => void,
    isSelected: (modelId: string) => boolean = () => true,
  ) {
    this.store = store
    this.isSelected = isSelected
    this.cacheFile = modelsCachePath()
    this.baselineCatalog = grokBuildBaselineModels()
    // The built-in xai provider owns login/refresh (device flow today); the
    // credential lives in this plugin's own file via the store above.
    this.models = createModels({ credentials: store })
    this.models.setProvider(xaiProvider())
    this.onCatalogChange = onCatalogChange
  }

  /** Secret-free listing diagnostic from the last refresh. */
  get catalogError(): string | undefined {
    return this.listingError
  }

  /** Catalog source implementation. */
  get catalogSource(): CatalogSource {
    return this.source
  }

  /**
   * Return the available models.
   * @returns The available models.
   */
  availableModels(): Model<Api>[] {
    return mergeLiveCatalog(this.baselineCatalog, this.liveIds, this.liveModels)
  }

  /**
   * The models the user keeps selected, in catalog order.
   * @returns The selected subset of {@link availableModels}.
   */
  visibleModels(): Model<Api>[] {
    return this.availableModels().filter(model => this.isSelected(model.id))
  }

  /**
   * Provider whose id matches the harness route so PiAiAdapter can list models.
   * @returns The resulting provider.
   */
  provider(): Provider {
    const visible = this.visibleModels()
    const base = grokBuildProvider(visible)
    return {
      ...base,
      getModels: () => asHarnessModels(this.visibleModels()),
    }
  }

  /** Load cached catalog. */
  async loadCachedCatalog(): Promise<void> {
    try {
      const cache = parseCache(await readFile(this.cacheFile, 'utf8'))
      if (cache === undefined) return
      // The last live listing serves until the next sync replaces it.
      this.liveIds = cache.ids
      this.liveModels = cache.models
      this.source = 'cache'
    } catch (error) {
      if (!isENOENT(error)) throw error
    }
  }

  /**
   * Refresh live catalog.
   * @param signal - Cancellation signal for the operation.
   */
  async refreshLiveCatalog(signal?: AbortSignal): Promise<void> {
    try {
      const auth = await this.models.getAuth(XAI_PI_PROVIDER)
      const access = auth?.auth.apiKey
      if (access === undefined || access.length === 0) {
        this.listingError = undefined
        return
      }
      const live = await fetchLiveModels(access, signal)
      this.liveIds = live.map(model => model.id)
      this.liveModels = live
      this.source = 'live'
      this.listingError = undefined
      await this.writeCache()
    } catch (error) {
      this.listingError = safeMessage(error)
      if (this.liveIds === undefined) this.source = 'fallback'
    } finally {
      // Login must reveal the fallback catalog even when auth refresh or live listing fails.
      this.onCatalogChange?.()
    }
  }

  /** Tell model discovery that the selection changed. */
  notifySelectionChange(): void {
    this.onCatalogChange?.()
  }

  /**
	 * Resolve the stored OAuth access token, refreshing it first when the
	 * provider decides it is due. Mirrors `OAuthProviderSession` so both session
	 * kinds satisfy the same token seam.
	 * @returns the access token, or undefined when no OAuth credential is stored.
	 */
  async resolveAccessToken(): Promise<string | undefined> {
    const resolved = await this.models.getAuth(XAI_PI_PROVIDER)
    if (resolved === undefined) return undefined
    const credential = await this.store.read(XAI_PI_PROVIDER)
    return credential?.type === 'oauth' ? credential.access : undefined
  }

  /**
	 * Backdate the stored token's expiry so the next `getAuth()` refreshes.
	 * Called after an upstream 401 rejected a locally-valid token.
	 */
  async invalidateAccessToken(): Promise<void> {
    await this.store.invalidate(XAI_PI_PROVIDER)
  }

  /** Refresh host discovery after an account switch/remove without a full logout. */
  notifyCredentialChange(): void {
    this.onCatalogChange?.()
  }

  /** End the provider session and remove its stored credential. */
  async logout(): Promise<void> {
    try {
      await this.store.delete(XAI_PI_PROVIDER)
      this.liveIds = undefined
      this.liveModels = undefined
      this.source = 'fallback'
      this.listingError = undefined
      await mkdir(dirname(this.cacheFile), { recursive: true, mode: 0o700 })
      await rm(this.cacheFile, { force: true })
    } finally {
      // Credential deletion may succeed before cache cleanup fails. Always
      // refresh discovery so an open selector cannot retain stale models.
      this.onCatalogChange?.()
    }
  }

  private async writeCache(): Promise<void> {
    const document: ModelsCacheDocument = {
      version: MODELS_CACHE_VERSION,
      ids: this.liveIds === undefined ? [] : [...this.liveIds],
      ...(this.liveModels === undefined ? {} : { models: [...this.liveModels] }),
      fetchedAt: Date.now(),
    }
    await mkdir(dirname(this.cacheFile), { recursive: true, mode: 0o700 })
    await writeFileAtomic(this.cacheFile, `${JSON.stringify(document)}\n`, {
      mode: 0o600,
      dirMode: 0o700,
    })
  }
}
