/**
 * Platform-singleton module seed. These are the ONLY entities the shell
 * shares into the module table — fetch bundles resolve their externals against
 * exactly this set through the loader's require. Keys come from the platform
 * constant module ({@link ./platform.ts}, the single source of truth with the
 * tsdown client externals). Immediate values are static imports; UI primitives
 * resolves once before the module system snapshots the completed table.
 */
import * as React from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import * as ReactDom from 'react-dom'
import * as ReactDomClient from 'react-dom/client'
import * as Cordis from '@deepseek-ai/cordis'
import * as ClientStore from '@aeven/client-store'
import * as UiSlots from '@aeven/client-ui-slots'
import type { PlatformModule } from './platform.ts'

type UiPrimitivesModule = typeof import('@aeven/client-ui-primitives')
type ImmediatePlatformModule = Exclude<PlatformModule, '@aeven/client-ui-primitives'>

/**
 * Start the rendering family with the shell without placing it on the shell's
 * execution path. The rejection is captured immediately so an unauthenticated
 * page can keep presenting sign-in even when an application-only chunk fails.
 */
const uiPrimitivesLoad: Promise<{ module: UiPrimitivesModule } | { error: unknown }> = import(
  '@aeven/client-ui-primitives',
).then(
  module => ({ module }),
  (error: unknown) => ({ error }),
)

/**
 * Build the immediate module table and return the rendering-family request.
 * @returns The mutable table and the captured result of the eager request.
 */
export function startStaticModules(): {
  table: Record<string, unknown>
  rendering: Promise<{ module: UiPrimitivesModule } | { error: unknown }>
} {
  // The satisfies pin is the projection contract: a word added to
  // PLATFORM_MODULES without a static import here (or vice versa) fails to
  // compile instead of drifting into a runtime require miss.
  const table: Record<string, unknown> = {
    'react': React,
    'react/jsx-runtime': ReactJsxRuntime,
    'react-dom': ReactDom,
    'react-dom/client': ReactDomClient,
    '@deepseek-ai/cordis': Cordis,
    '@aeven/client-store': ClientStore,
    '@aeven/client-ui-slots': UiSlots,
  } satisfies Record<ImmediatePlatformModule, unknown>
  return { table, rendering: uiPrimitivesLoad }
}
