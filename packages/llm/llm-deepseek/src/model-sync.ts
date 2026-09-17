/**
 * Automatic model-list sync for the DeepSeek platform.
 *
 * The provider publishes which models it serves at its own `GET /models`, and
 * that document is ids and nothing else: no display name, no context window, no
 * output cap, no capability. Capabilities therefore stay shipped knowledge —
 * `DEFAULT_MODELS` — while the id list is the platform's to change.
 *
 * The sync is **additive**: a published id the catalog does not describe joins
 * it as an id-named entry that the profile's own fallbacks size, and no entry
 * the deployment wrote is dropped or rewritten. Retiring an id the platform
 * stopped listing would take a model out from under a session or a pinned
 * default model, and a listing is not a contract that an id has stopped
 * working.
 *
 * @module avn-llm-deepseek/model-sync
 */

import type { DeepSeekCatalogModel } from './adapter.ts'

/** Wait for the platform's model document before keeping the shipped catalog. */
export const DEFAULT_MODEL_SYNC_TIMEOUT_MS = 10_000

/**
 * Read the model ids a listing document publishes.
 *
 * A missing, malformed, or empty document yields `undefined`, which is what
 * keeps the shipped catalog: a provider whose list is briefly unavailable must
 * not take its own models away.
 * @param document - the parsed `GET /models` body.
 * @returns the published ids in document order, or `undefined` when the document states none.
 */
export function parseModelIds(document: unknown): readonly string[] | undefined {
  const data = (document as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return undefined
  const ids: string[] = []
  const seen = new Set<string>()
  for (const entry of data as readonly { id?: unknown }[]) {
    const id = entry.id
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids.length === 0 ? undefined : ids
}

/**
 * Fetch and read one route's published model ids.
 * @param url - absolute URL of the platform's model document.
 * @param timeoutMs - abort the request after this many milliseconds.
 * @param apiKey - credential for this request alone.
 * @param signal - caller cancellation, composed with the timeout.
 * @returns the published ids; a rejection means the shipped catalog stays.
 */
export async function fetchModelIds(
  url: string,
  timeoutMs: number,
  apiKey: string,
  signal?: AbortSignal,
): Promise<readonly string[] | undefined> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const composed = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  const response = await fetch(url, {
    signal: composed,
    headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
  })
  if (!response.ok) {
    throw new Error(`model document request failed with HTTP ${String(response.status)}`)
  }
  return parseModelIds(await response.json())
}

/**
 * Add the published ids a catalog does not describe.
 *
 * A model the deployment sized and named keeps every field of its entry, and a
 * published id already described is left alone: the synced list widens what a
 * selector offers, never what an existing entry says. An added id is named by
 * itself, because the platform publishes no display name and inventing one
 * would state a version nobody verified.
 * @param models - the resolved catalog, in configuration order.
 * @param platformIds - ids the platform published, or `undefined` when it stated none.
 * @returns the catalog plus any published id it does not describe.
 */
export function withSyncedModels(
  models: readonly DeepSeekCatalogModel[],
  platformIds: readonly string[] | undefined,
): DeepSeekCatalogModel[] {
  if (platformIds === undefined) return [...models]
  const described = new Set(models.map(model => model.id))
  const added = platformIds
    .filter(id => !described.has(id))
    .map(id => ({ id, name: id }))
  return [...models, ...added]
}
