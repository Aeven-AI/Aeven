/**
 * Platform-singleton module seed. These are the ONLY entities the shell
 * shares into the module table — fetch bundles resolve their externals against
 * exactly this set through the loader's require. Keys come from the platform
 * constant module ({@link ./platform.ts}, the single source of truth with the
 * tsdown client externals). Immediate values are static imports; the rendering
 * family (UI primitives, and the xterm terminal emulator with its stylesheet)
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

/** Platform modules the rendering family supplies once its background request settles. */
type RenderingModule = '@aeven/client-ui-primitives' | '@xterm/xterm' | '@xterm/addon-fit'
type ImmediatePlatformModule = Exclude<PlatformModule, RenderingModule>
/** The settled rendering family, keyed by platform module specifier. */
type RenderingModules = Record<RenderingModule, unknown>

/**
 * Start the rendering family with the shell without placing it on the shell's
 * execution path. The rejection is captured immediately so an unauthenticated
 * page can keep presenting sign-in even when an application-only chunk fails.
 */
const renderingLoad: Promise<{ modules: RenderingModules } | { error: unknown }> = Promise.all([
  import('@aeven/client-ui-primitives'),
  import('@xterm/xterm'),
  import('@xterm/addon-fit'),
  import('@xterm/xterm/css/xterm.css'),
]).then(
  ([primitives, xterm, xtermFit]) => ({
    modules: { '@aeven/client-ui-primitives': primitives, '@xterm/xterm': xterm, '@xterm/addon-fit': xtermFit },
  }),
  (error: unknown) => ({ error }),
)

/**
 * Build the immediate module table and return the rendering-family request.
 * @returns The mutable table and the captured result of the eager request.
 */
export function startStaticModules(): {
  table: Record<string, unknown>
  rendering: Promise<{ modules: RenderingModules } | { error: unknown }>
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
  return { table, rendering: renderingLoad }
}
