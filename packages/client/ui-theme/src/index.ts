/** Host registration for the browser theme preference and pre-plugin palette. */

import type { Context } from '@deepseek-ai/cordis'
import type { IndexRequest } from '@aeven/host-webserver'
import type {} from '@aeven/identity-user'
import type {} from '@aeven/settings'
import { bootThemeInjection } from './boot-theme.ts'
import {
  DEFAULT_FONT_SIZE, DEFAULT_PREFERENCE, THEME_SETTINGS_NAMESPACE, ThemeSettingsSchema,
  type ThemePreference, type ThemeSettings,
} from './theme-settings.ts'

export {
  DEFAULT_FONT_SIZE, DEFAULT_PREFERENCE, FONT_SIZE_FIELD, FONT_SIZE_MAX, FONT_SIZE_MIN,
  THEME_PREFERENCE_FIELD, THEME_PREFERENCES, THEME_SETTINGS_NAMESPACE,
  secondaryFontSize,
  type ThemePreference, type ThemeSettings,
} from './theme-settings.ts'

const THEME_NAMESPACE = THEME_SETTINGS_NAMESPACE

/**
 * Read the theme the page is rendered for: the signed-in reader's own on a settings provider that keeps account
 * sections, else the registered section, else the schema defaults without a settings provider.
 * @param ctx - Host context that may hold the settings and identity services.
 * @param request - the page request, whose credential names the reader.
 * @returns the preference and font size to render.
 */
function readSection(ctx: Context, request: IndexRequest | undefined): { preference: ThemePreference; fontSize: number } {
  const fallback = { preference: DEFAULT_PREFERENCE, fontSize: DEFAULT_FONT_SIZE }
  const settings = ctx.get('settings')
  if (settings === undefined) return fallback
  const reader = request === undefined ? undefined : ctx.get('identityUsers')?.resolve(request)?.id
  const section = (reader === undefined
    ? settings.get(THEME_NAMESPACE)
    : settings.cachedValueFor(THEME_NAMESPACE, reader)) as ThemeSettings | undefined
  if (section === undefined) return fallback
  return section
}

/**
 * Register the durable theme section when the optional settings service is
 * composed, and answer every index injection collection with the current
 * theme bootstrap row. The static shell preloader follows this body injection,
 * so its palette selector applies before the first paint.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    // A person's theme: the same on every device of the account, and their own on a Host that serves several people.
    settingsCtx.settings.register(THEME_NAMESPACE, ThemeSettingsSchema, { reach: 'account' })
  })
  ctx.on('webserver/index-inject', (table, _origin, request) => {
    const section = readSection(ctx, request)
    table.push(bootThemeInjection(section.preference, section.fontSize))
  })
}
