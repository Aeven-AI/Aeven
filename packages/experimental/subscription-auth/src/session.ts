/**
 * Shared OAuth store + live catalog for the host plugin and CLI.
 * @module @aeven/experimental-subscription-auth/session
 */

import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { writeFileAtomic } from '@aeven/atomic-write'
import { resolveDshHome } from '@aeven/home-paths'
import type { Api, Model, MutableModels, Provider } from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai'
import { xaiProvider } from '@earendil-works/pi-ai/providers/xai'
import {
  type CatalogSource,
  fetchLiveModels,
  type LiveModelDescriptor,
  materializeLiveModel,
  mergeLiveCatalog,
} from './catalog.ts'
import { GROK_BUILD_MODELS_CACHE_FILENAME, GROK_BUILD_ROUTE, XAI_PI_PROVIDER } from './ids.ts'
import { grokBuildBaselineModels, grokBuildProvider } from './provider.ts'
import { safeMessage } from './redact.ts'
import { GrokBuildCredentialStore } from './store.ts'

const MODELS_CACHE_VERSION = 2

interface ModelsCacheDocument {
  version: typeof MODELS_CACHE_VERSION
  ids: string[]
  selected?: string[]
  fetchedAt: number
}

interface ParsedCache {
  ids: string[]
  selected?: string[]
}

function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function modelsCachePath(dshHome?: string): string {
  return resolve(join(resolveDshHome(dshHome), GROK_BUILD_MODELS_CACHE_FILENAME))
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
  if (document['version'] !== 1 && document['version'] !== MODELS_CACHE_VERSION) return undefined
  const ids = parseIdList(document['ids'])
  const selected = parseIdList(document['selected'])
  if (ids.length === 0 && selected.length === 0) return undefined
  return {
    ids,
    ...(selected.length === 0 ? {} : { selected }),
  }
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
  private selectedIds: string[] | undefined
  private source: CatalogSource = 'fallback'
  private listingError: string | undefined
  private readonly cacheFile: string
  private onCatalogChange: (() => void) | undefined

  constructor(store: GrokBuildCredentialStore = new GrokBuildCredentialStore(), onCatalogChange?: () => void) {
    this.store = store
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
   * Return the selected model ids.
   * @returns The resulting selected model ids.
   */
  selectedModelIds(): string[] | undefined {
    return this.selectedIds
  }

  /**
   * Return the visible models.
   * @returns The visible models.
   */
  visibleModels(): Model<Api>[] {
    const available = this.availableModels()
    if (this.selectedIds === undefined || this.selectedIds.length === 0) return available
    const byId = new Map(available.map(model => [model.id, model]))
    return this.selectedIds.map(id => byId.get(id) ?? materializeLiveModel(id, this.baselineCatalog))
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
      if (cache.ids.length > 0) {
        this.liveIds = cache.ids
        this.liveModels = undefined
        this.source = 'cache'
      }
      this.selectedIds = cache.selected
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

  /**
   * Update selected models.
   * @param ids - Ids value.
   */
  async setSelectedModels(ids: readonly string[]): Promise<void> {
    const unique = [...new Set(ids.filter(id => id.length > 0))]
    this.selectedIds = unique.length === 0 ? undefined : unique
    await this.writeCache()
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
      this.selectedIds = undefined
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
      fetchedAt: Date.now(),
      ...(this.selectedIds === undefined ? {} : { selected: [...this.selectedIds] }),
    }
    await mkdir(dirname(this.cacheFile), { recursive: true, mode: 0o700 })
    await writeFileAtomic(this.cacheFile, `${JSON.stringify(document)}\n`, {
      mode: 0o600,
      dirMode: 0o700,
    })
  }
}
