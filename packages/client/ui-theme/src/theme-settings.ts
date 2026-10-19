/** Theme preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Built-in preferences accepted at the registry and settings boundaries. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** Settings namespace owned by the theme plugin. */
export const THEME_SETTINGS_NAMESPACE = 'ui-theme'

/** Field carrying the selected built-in theme preference. */
export const THEME_PREFERENCE_FIELD = 'preference'

/** Field carrying the conversation content font size. */
export const FONT_SIZE_FIELD = 'fontSize'

/**
 * Body attribute carrying the durable preference the index bootstrap painted
 * with. The theme service seeds its first snapshot from it, so the palette the
 * client activates with is the one already on screen rather than the default
 * it would otherwise hold until the Host settings answer.
 */
export const THEME_PREFERENCE_ATTRIBUTE = 'data-avn-theme-preference'

/** Theme preference persisted by the product Appearance row. */
export type ThemePreference = typeof THEME_PREFERENCES[number]

/** Default preference when the user-settings document has no override. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system'

/** Smallest accepted content font size (px). */
export const FONT_SIZE_MIN = 12

/** Largest accepted content font size (px). */
export const FONT_SIZE_MAX = 24

/** Content font size when the user-settings document has no override (px).
 *  16px matches the Aeven design-system body scale (16px/30px, 400). */
export const DEFAULT_FONT_SIZE = 16

/**
 * The secondary content font size for one body size. The tier is the step
 * under the body: one step below 14, two steps below 16 and up. Sizes 14 and
 * 15 would land on 13px, which is not a size this UI has, so the tier holds
 * the 14px floor there and equals the body size instead. The mapping lives
 * here rather than in a `min`/`max` chain because no such chain can skip a
 * single value in the middle of a ladder.
 * @param fontSize - body content font size in px.
 * @returns the secondary size in px.
 */
export function secondaryFontSize(fontSize: number): number {
  if (fontSize <= 13) return fontSize - 1
  if (fontSize >= 16) return fontSize - 2
  return 14
}

/** Durable theme section shared by the Host schema and the browser scope. */
export interface ThemeSettings {
  /** Selected built-in preference. */
  preference: ThemePreference
  /** Conversation content font size in px (integer within {@link FONT_SIZE_MIN}..{@link FONT_SIZE_MAX}). */
  fontSize: number
}

/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const ThemeSettingsSchema: z<ThemeSettings> = z.object({
  [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
  [FONT_SIZE_FIELD]: z.number().step(1).min(FONT_SIZE_MIN).max(FONT_SIZE_MAX).default(DEFAULT_FONT_SIZE),
})

/**
 * Narrow one wire or registry value to a persistable preference.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in preference.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some(preference => preference === value)
}
