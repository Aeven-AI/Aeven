/**
 * Provider routes this harness knows how to configure although the installed
 * pi-ai catalog ships nothing about them.
 *
 * pi-ai's builtin catalog is what puts a provider in the configurable-provider
 * directory: a person adds a key on the Models page and the route works,
 * because the protocol, endpoint, and model list all come from the catalog. A
 * provider pi-ai has never heard of has none of that, so today it is reachable
 * only by hand-declaring the whole route — protocol, endpoint, and every model
 * — in settings.
 *
 * A known route closes that gap without shipping a running provider. It
 * contributes the directory entry and the route defaults, so supplying a
 * credential is still the entire user-facing step, while `catalogRefresh`
 * supplies the models the catalog cannot. Nothing here registers a route:
 * which adapters exist stays composition, and which providers run stays the
 * user's settings document.
 *
 * @module avn-llm-pi-ai/known-routes
 */

import type { PiAiCatalogRefresh } from './catalog.ts'

/** Route defaults a known provider contributes to a profile that omits them. */
export interface KnownRoute {
  /** Human-readable name for the directory and selectors. */
  displayName: string
  /** Wire protocol every model on the route speaks. */
  api: string
  /** Endpoint every model on the route addresses. */
  baseURL: string
  /** Credential reference a profile gets when it names none. */
  apiKeyEnv: string
  /** Live model-list refresh, which is where this route's models come from. */
  catalogRefresh: Required<Pick<PiAiCatalogRefresh, 'url' | 'format' | 'requireTags'>>
}

/**
 * The known routes, keyed by provider route name.
 *
 * A route earns a place here only when its models can be maintained without a
 * person editing configuration — that is, when the provider publishes a model
 * document this package can read. A provider whose models would have to be
 * hand-listed belongs in a deployment's own settings, not in this table, where
 * the list would rot exactly as the pi-ai snapshot does.
 */
export const KNOWN_ROUTES: Readonly<Record<string, KnownRoute>> = {
  deepinfra: {
    // Cased like the catalog's own provider names, which the directory shows beside it.
    displayName: 'DeepInfra',
    api: 'openai-completions',
    baseURL: 'https://api.deepinfra.com/v1/openai',
    apiKeyEnv: 'DEEPINFRA_API_KEY',
    catalogRefresh: {
      url: 'https://api.deepinfra.com/v1/openai/models',
      format: 'openai-models',
      // The same document lists image, video, speech, and embedding models,
      // which this route's protocol cannot call.
      requireTags: ['chat'],
    },
  },
}

/**
 * The known route for one provider key.
 * @param provider - provider route key.
 * @returns its defaults, or undefined when this package knows nothing about it.
 */
export function knownRoute(provider: string): KnownRoute | undefined {
  return Object.hasOwn(KNOWN_ROUTES, provider) ? KNOWN_ROUTES[provider] : undefined
}
