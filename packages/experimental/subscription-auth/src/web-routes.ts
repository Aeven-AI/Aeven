/**
 * Atomic registration helper for plugin-owned Web routes.
 * `webServer.register()` is not fiber-scoped, so a later registration failure
 * must release every earlier route before the setup error escapes.
 * @module @aeven/experimental-subscription-auth/web-routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  registerAtomicallySynchronously as registerCoreAtomically,
  setupAtomicallySynchronously as setupCoreAtomically,
} from 'dsh-coding-oauth-core'

/** Plugin web route. */
export interface PluginWebRoute {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** Registry used by plugin web route. */
export interface PluginWebRouteRegistry {
  register(route: PluginWebRoute): () => void
}

/**
 * Run imperative route setup or roll every successful registration back.
 * @param registry - Registry that owns the contribution.
 * @param setup - Setup value.
 * @returns A disposer that removes the registration.
 */
export function registerWebRouteSetupAtomically(
  registry: PluginWebRouteRegistry,
  setup: (tracked: PluginWebRouteRegistry) => unknown,
): () => void {
  return setupCoreAtomically(registry, setup)
}

/**
 * Register all routes or leave the registry exactly as it was.
 * @param registry - Registry that owns the contribution.
 * @param routes - Routes value.
 * @returns A disposer that removes the registration.
 */
export function registerWebRoutesAtomically(
  registry: PluginWebRouteRegistry,
  routes: readonly PluginWebRoute[],
): () => void {
  return registerCoreAtomically(registry, routes)
}
