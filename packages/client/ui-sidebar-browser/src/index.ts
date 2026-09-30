/** Host loader entry for the right sidebar browser plugin. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@aeven/settings'
import { BROWSER_SETTINGS_NAMESPACE, BrowserSettingsSchema } from './browser-settings.ts'

export { BROWSER_SETTINGS_NAMESPACE, SEARCH_ENGINE_FIELD, type BrowserSettings } from './browser-settings.ts'

/**
 * Register the durable browser section when the settings service is composed.
 * The pane, its Settings rows, and the search engines themselves live in the
 * browser half.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(BROWSER_SETTINGS_NAMESPACE, BrowserSettingsSchema)
  })
}
