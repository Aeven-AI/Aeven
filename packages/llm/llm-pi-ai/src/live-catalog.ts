/**
 * Live model-list refresh for a route whose provider publishes a `GET /models`
 * document.
 *
 * The installed pi-ai catalog is a snapshot regenerated on its maintainers'
 * cadence, so a route serving it lags whatever the provider currently lists.
 * This module fetches the provider's own list and turns the entries the
 * snapshot does not describe into pi-ai models.
 *
 * ADDITIVE BY CONTRACT: a live entry never replaces an installed one. The
 * snapshot carries hand-tuned `compat` and `thinkingLevelMap` values that the
 * published document does not express — reasoning dialects, developer-role
 * support, per-level wire spellings — and deriving those from `supported_
 * parameters` would silently downgrade models that work today. The refresh
 * therefore only widens the catalog; correcting an installed entry stays
 * `modelOverrides`, whose diagnostics already name a miss.
 *
 * @module avn-llm-pi-ai/live-catalog
 */

import type { Api, Model, ModelCost, ThinkingLevelMap } from '@earendil-works/pi-ai'
import type { PiAiModality } from './catalog.ts'
import { MODALITIES } from './catalog.ts'

/** Per-token prices arrive as decimal strings; pi-ai states cost per million tokens. */
const TOKENS_PER_COST_UNIT = 1_000_000

/**
 * Thinking levels offered to a live reasoning entry, mapped to the wire
 * spellings OpenRouter's `reasoning_effort` accepts. `off` carries no value
 * because not thinking is the parameter's absence.
 */
const LIVE_THINKING_LEVELS: ThinkingLevelMap = {
  off: null,
  minimal: null,
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: null,
  max: null,
}

/**
 * One entry of a published model document. Both supported layouts are read
 * from this one structure: every field is optional and separately validated,
 * so an entry from either provider passes through the same materialization.
 */
interface LiveModelEntry {
  id?: unknown
  name?: unknown
  context_length?: unknown
  architecture?: { input_modalities?: unknown } | undefined
  pricing?: { prompt?: unknown; completion?: unknown; input_cache_read?: unknown } | undefined
  top_provider?: { context_length?: unknown; max_completion_tokens?: unknown } | undefined
  supported_parameters?: unknown
  /** The `openai-models` layout nests capacities, prices, and capability tags here. */
  metadata?: {
    context_length?: unknown
    max_tokens?: unknown
    tags?: unknown
    pricing?: { input_tokens?: unknown; output_tokens?: unknown; cache_read_tokens?: unknown } | undefined
  } | undefined
}

/**
 * Which published layout a provider's document uses.
 *
 * `openrouter` states capacities, modalities, and accepted parameters at the
 * top of each entry. `openai-models` is the plain OpenAI `GET /models` listing
 * — an id and little else — which providers extend under `metadata`; DeepInfra
 * puts capacities, per-token prices, and capability tags there.
 */
export type LiveCatalogFormat = 'openrouter' | 'openai-models'

/** Every format a route may name. */
export const LIVE_CATALOG_FORMATS: readonly LiveCatalogFormat[] = ['openrouter', 'openai-models']

/** Facts a materialized live model needs from the route that requested the refresh. */
export interface LiveCatalogRoute {
  /** Provider route key stamped onto every materialized model. */
  provider: string
  /** Wire protocol every materialized model declares. */
  api: Api
  /** Endpoint every materialized model declares. */
  baseUrl: string
  /** Context window for an entry whose document states none. */
  defaultContextWindow: number
  /** Output cap for an entry whose document states none. */
  defaultMaxTokens: number
  /** Published layout this route's document uses. */
  format: LiveCatalogFormat
  /**
   * Capability tags an entry must carry to be materialized, or empty to accept
   * every entry. A provider listing image, audio, and embedding models beside
   * its chat models needs this: a text route cannot call the others, and a
   * selector listing them offers the user a request that will fail.
   */
  requireTags: readonly string[]
  /**
   * Output cap the model's own vendor states for one published id, which
   * answers when the document states no usable one.
   *
   * A gateway serving another vendor's models publishes ids naming that
   * vendor's provider and model but cannot state their output caps — DeepInfra
   * publishes its context window in the cap field and `max_output_tokens: null`
   * on the per-model document for every proxied model. The vendor's own catalog
   * entry carries the real cap, and the caller owns that lookup because it is
   * the seam between the two catalogs. Absent leaves the route default to
   * answer, as a document that sizes nothing already does.
   */
  vendorOutputCap?: (id: string) => number | undefined
}

/**
 * Read a published per-token price into cost per million tokens. The two
 * layouts disagree on the JSON type — OpenRouter publishes decimal strings,
 * the openai-models layout publishes numbers — so both are accepted.
 * @param value - the published per-token price, or anything else.
 * @returns the per-million price, or 0 when the document states no usable number.
 */
function cost(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed * TOKENS_PER_COST_UNIT : 0
}

/**
 * Read a positive integer field.
 * @param value - the published value, or anything else.
 * @returns the integer, or undefined when the document states no usable number.
 */
function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

/**
 * The one published field the capability-tag signal lives in. Only the
 * `openai-models` layout carries it, so an entry of the other layout, or no
 * entry at all, reads as untagged.
 */
interface PublishedTags {
  metadata?: { tags?: unknown } | null | undefined
}

/**
 * Read the entry's capability tags, which only the `openai-models` layout carries.
 * @param entry - one published entry, or nothing.
 * @returns the published tags, or an empty list.
 */
function tags(entry: PublishedTags | null | undefined): readonly string[] {
  const published = entry?.metadata?.tags
  return Array.isArray(published) ? published.filter(tag => typeof tag === 'string') : []
}

/**
 * Whether one published entry carries every capability tag a route requires.
 *
 * The one home for the tag signal: the refresh filters the entries it
 * materializes through this, and draft interrogation filters the candidates it
 * offers through it, so `requireTags` selects the same models on both paths. A
 * route requiring nothing accepts every entry, including an untagged one.
 * @param entry - one published entry, or nothing.
 * @param required - tags the route requires; empty accepts every entry.
 * @returns true when the entry carries every required tag.
 */
export function carriesTags(entry: PublishedTags | null | undefined, required: readonly string[]): boolean {
  if (required.length === 0) return true
  const published = tags(entry)
  return required.every(tag => published.includes(tag))
}

/**
 * Keep an output cap that can be one, from either source.
 *
 * A cap states how much the model may emit, so a value that is not smaller than
 * the window the materialized model declares states no usable capability: no
 * model emits its entire window. DeepInfra publishes `metadata.max_tokens` as a
 * copy of `metadata.context_length` — all 131 entries carrying both fields
 * agree — and reading that copy as a capability gives the model a whole-window
 * ceiling, which pi-ai then sends as the request's `max_tokens` whenever the
 * profile configures none, and which any provider enforcing its own output
 * limit refuses outright.
 * @param candidate - a cap the document published or the vendor's catalog states, or anything else.
 * @param contextWindow - the window the materialized model will declare.
 * @returns the cap when it is smaller than that window, otherwise undefined.
 */
function publishedOutputCap(candidate: unknown, contextWindow: number): number | undefined {
  const cap = positiveInteger(candidate)
  return cap !== undefined && cap < contextWindow ? cap : undefined
}

/**
 * Read the entry's request modalities, keeping only those pi-ai accepts.
 * @param entry - one published entry.
 * @param format - the published layout.
 * @returns the accepted modalities, always including `text`.
 */
function modalities(entry: LiveModelEntry, format: LiveCatalogFormat): PiAiModality[] {
  if (format === 'openai-models') {
    // No modality list in this layout; a vision tag is the only signal that an
    // entry accepts anything beyond text.
    const seeing = tags(entry).some(tag => tag === 'vision' || tag === 'vlm')
    return seeing ? ['text', 'image'] : ['text']
  }
  const published = entry.architecture?.input_modalities
  const accepted = Array.isArray(published)
    ? MODALITIES.filter(modality => published.includes(modality))
    : []
  // Every route this refresh serves is a text route; an entry that published
  // only unsupported modalities would otherwise materialize unusable.
  return accepted.includes('text') ? accepted : ['text', ...accepted]
}

/**
 * Whether the entry advertises reasoning.
 * @param entry - one published entry.
 * @param format - the published layout.
 * @returns true when the document says the model reasons.
 */
function reasons(entry: LiveModelEntry, format: LiveCatalogFormat): boolean {
  if (format === 'openai-models') return tags(entry).includes('reasoning')
  const parameters = entry.supported_parameters
  if (!Array.isArray(parameters)) return false
  return parameters.includes('reasoning') || parameters.includes('include_reasoning')
}

/**
 * Whether the entry offers selectable reasoning levels rather than only a
 * reasoning on/off capability.
 * @param entry - one published entry.
 * @param format - the published layout.
 * @returns true when the document advertises an effort control.
 */
function offersEfforts(entry: LiveModelEntry, format: LiveCatalogFormat): boolean {
  if (format === 'openai-models') return tags(entry).includes('reasoning_effort')
  const parameters = entry.supported_parameters
  return Array.isArray(parameters) && parameters.includes('reasoning_effort')
}

/**
 * Materialize one published entry as a pi-ai model.
 * @param entry - one published entry.
 * @param route - the requesting route's protocol, endpoint, and fallbacks.
 * @returns the model, or undefined when the entry states no usable id.
 */
export function liveModel(entry: LiveModelEntry, route: LiveCatalogRoute): Model<Api> | undefined {
  const id = entry.id
  if (typeof id !== 'string' || id.length === 0) return undefined
  // A route that names required tags accepts only entries carrying them all,
  // which is how a chat route skips the image, audio, and embedding models a
  // provider lists in the same document.
  if (!carriesTags(entry, route.requireTags)) return undefined
  const reasoning = reasons(entry, route.format)
  const openAiLayout = route.format === 'openai-models'
  const modelCost: ModelCost = openAiLayout
    ? {
      input: cost(entry.metadata?.pricing?.input_tokens),
      output: cost(entry.metadata?.pricing?.output_tokens),
      cacheRead: cost(entry.metadata?.pricing?.cache_read_tokens),
      cacheWrite: 0,
    }
    : {
      input: cost(entry.pricing?.prompt),
      output: cost(entry.pricing?.completion),
      cacheRead: cost(entry.pricing?.input_cache_read),
      cacheWrite: 0,
    }
  // The window the model will declare, which is what a published cap must fit
  // inside. An entry that publishes none leaves the cap judged against the
  // route's own assumption, since that is the window this model will serve.
  const publishedContextWindow = openAiLayout
    ? positiveInteger(entry.metadata?.context_length)
    : positiveInteger(entry.top_provider?.context_length) ?? positiveInteger(entry.context_length)
  const contextWindow = publishedContextWindow ?? route.defaultContextWindow
  const maxTokens = publishedOutputCap(
    openAiLayout ? entry.metadata?.max_tokens : entry.top_provider?.max_completion_tokens,
    contextWindow,
  ) ?? publishedOutputCap(route.vendorOutputCap?.(id), contextWindow)
  return {
    id,
    name: typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : id,
    api: route.api,
    baseUrl: route.baseUrl,
    provider: route.provider,
    reasoning,
    input: modalities(entry, route.format),
    cost: modelCost,
    contextWindow,
    maxTokens: maxTokens ?? route.defaultMaxTokens,
    // Only what the published document actually implies. Everything a tuned
    // snapshot entry would hand-state stays absent rather than guessed; a
    // deployment that needs more states it on a `models` entry. Levels are
    // offered only where the document advertises an effort control, so a model
    // that merely reasons is not given a selector it would reject.
    ...reasoning
      ? {
        compat: { thinkingFormat: 'openrouter' as const },
        ...offersEfforts(entry, route.format) ? { thinkingLevelMap: LIVE_THINKING_LEVELS } : {},
      }
      : {},
  }
}

/**
 * Materialize every published entry the installed snapshot does not describe.
 * @param document - the parsed `GET /models` body.
 * @param installed - ids the installed catalog already serves.
 * @param route - the requesting route's protocol, endpoint, and fallbacks.
 * @returns the added models, in published order.
 */
export function liveAdditions(
  document: unknown,
  installed: ReadonlySet<string>,
  route: LiveCatalogRoute,
): Model<Api>[] {
  const data = (document as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) {
    throw new Error('model document has no "data" array')
  }
  const added: Model<Api>[] = []
  const seen = new Set<string>()
  for (const entry of data as LiveModelEntry[]) {
    const model = liveModel(entry, route)
    // A published id the snapshot already carries keeps the snapshot's entry;
    // a duplicate inside one document keeps its first occurrence.
    if (model === undefined || installed.has(model.id) || seen.has(model.id)) continue
    seen.add(model.id)
    added.push(model)
  }
  return added
}

/**
 * Fetch and materialize one route's live additions.
 * @param url - absolute URL of the provider's model document.
 * @param timeoutMs - abort the request after this many milliseconds.
 * @param installed - ids the installed catalog already serves.
 * @param route - the requesting route's protocol, endpoint, and fallbacks.
 * @param signal - caller cancellation, composed with the timeout.
 * @returns the added models; a rejection means the route keeps the snapshot.
 */
export async function fetchLiveAdditions(
  url: string,
  timeoutMs: number,
  installed: ReadonlySet<string>,
  route: LiveCatalogRoute,
  signal?: AbortSignal,
): Promise<Model<Api>[]> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const composed = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  const response = await fetch(url, { signal: composed, headers: { accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`model document request failed with HTTP ${String(response.status)}`)
  }
  return liveAdditions(await response.json(), installed, route)
}
