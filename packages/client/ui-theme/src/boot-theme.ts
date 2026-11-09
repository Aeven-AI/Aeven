/**
 * Theme bootstrap row for the browser's pre-plugin interval. Each index
 * render embeds the current durable built-in preference and content font size;
 * the browser resolves only `system`, then writes the palette attribute and
 * font-size axis ui-layout's ThemePresenter owns after the client plugin tree
 * activates, plus the preference attribute the theme service seeds from. It
 * also paints the document canvas and inserts the `theme-color` meta in the
 * body's palette colour, both of which the presenter keeps current afterwards.
 */

import type { IndexInjection } from '@aeven/host-webserver'
import {
  DEFAULT_FONT_SIZE, DEFAULT_PREFERENCE, THEME_COLOR_META_ID, THEME_PREFERENCE_ATTRIBUTE, secondaryFontSize,
  type ThemePreference,
} from './theme-settings.ts'

/** Build the inline script body for one schema-validated durable theme section. */
function bootThemeScript(preference: ThemePreference, fontSize: number): string {
  return `(() => {
  const preference = ${JSON.stringify(preference)}
  const systemDark = preference === 'system'
    && typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-color-scheme: dark)').matches
  const dark = preference === 'dark' || systemDark
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.body.toggleAttribute('data-ds-dark-theme', dark)
  // The canvas and the browser chrome take the palette colour from first paint: a
  // mobile keyboard or a live resize uncovers the canvas before the shell repaints,
  // where background propagation from body is not dependable.
  const canvas = getComputedStyle(document.body).backgroundColor
  document.documentElement.style.backgroundColor = canvas
  const themeColor = document.createElement('meta')
  themeColor.name = 'theme-color'
  themeColor.id = ${JSON.stringify(THEME_COLOR_META_ID)}
  themeColor.content = canvas
  document.head.append(themeColor)
  // The preference itself, not the resolved scheme: the theme service seeds its
  // first snapshot from it, so activation cannot repaint the loading page in the
  // default palette while the Host settings answer is still in flight.
  document.body.setAttribute(${JSON.stringify(THEME_PREFERENCE_ATTRIBUTE)}, preference)
  // The root size is the whole client's typographic base: every rem below it is
  // a fraction of this number, so changing it rescales the interface rather than
  // only the conversation.
  document.documentElement.style.fontSize = ${JSON.stringify(`${fontSize}px`)}
  document.body.style.setProperty('--avn-content-font-size', ${JSON.stringify(`${fontSize}px`)})
  document.body.style.setProperty('--avn-content-font-size-secondary', ${JSON.stringify(`${secondaryFontSize(fontSize)}px`)})
})()`
}

/**
 * The theme bootstrap as an injection row: an inline script immediately after
 * the opening body tag, before the shell mount and module script.
 * @param preference - Current Host-backed built-in preference.
 * @param fontSize - Current Host-backed content font size in px.
 * @returns the body script row.
 */
export function bootThemeInjection(
  preference: ThemePreference = DEFAULT_PREFERENCE,
  fontSize: number = DEFAULT_FONT_SIZE,
): IndexInjection {
  return { kind: 'script', placement: 'body', text: bootThemeScript(preference, fontSize) }
}
