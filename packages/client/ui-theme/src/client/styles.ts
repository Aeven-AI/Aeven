import type { Context } from '@deepseek-ai/cordis'
import base from '../styles/base.css?inline'
import designPlatform from '../styles/design-platform.css?inline'
import scrollbar from '../styles/scrollbar.css?inline'
import gradientShadowText from '../styles/gradient-shadow-text.css?inline'
import aevenLanguage from '../styles/aeven-language.css?inline'
import highlight from '../styles/highlight.css?inline'

const PLUGIN_ID = '@aeven/client-ui-theme'

const STYLES = [
  ['base.css', base],
  ['design-platform.css', designPlatform],
  ['scrollbar.css', scrollbar],
  ['gradient-shadow-text.css', gradientShadowText],
  ['aeven-language.css', aevenLanguage],
  ['highlight.css', highlight],
] as const

/**
 * Append one theme sheet to the document head.
 * @param name - File name the sheet is tagged with.
 * @param css - Sheet text.
 * @returns Removes the sheet again.
 */
function appendSheet(name: string, css: string): () => void {
  const tag = document.createElement('style')
  tag.dataset.plugin = PLUGIN_ID
  tag.dataset.pluginCss = `${PLUGIN_ID}/${name}`
  tag.textContent = css
  document.head.appendChild(tag)
  return () => { tag.remove() }
}

/**
 * Mount the global theme sheets for exactly the owning plugin lifetime.
 * @param ctx - Owning plugin context.
 */
export function installThemeStyles(ctx: Context): void {
  if (typeof document === 'undefined') return
  for (const [name, css] of STYLES) {
    ctx.effect(() => appendSheet(name, css), `ui-theme: ${name} stylesheet`)
  }
}

/**
 * Mount the same sheets with no plugin to own them, for the sign-in screens
 * that render before the plugin tree exists and show ui-primitives popups.
 * The caller removes them before the application boots, and the plugin
 * mounts its own.
 * @returns Removes every sheet this call mounted.
 */
export function mountThemeStyles(): () => void {
  const removers = STYLES.map(([name, css]) => appendSheet(name, css))
  return () => { for (const remove of removers) remove() }
}
