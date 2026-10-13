// @vitest-environment jsdom
/**
 * Language selection for the pre-plugin sign-in screens. The gate runs before
 * `ctx.locale` exists, so these screens pick a dictionary from the browser by
 * the same primary-subtag rule the locale plugin applies.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { en, t, zh } from '../src/client/locales.ts'

afterEach(() => { vi.unstubAllGlobals() })

/** Present the browser as reporting `languages`, plus a single `language`. */
function browserLanguages(languages: readonly string[] | undefined, language: string): void {
  vi.stubGlobal('navigator', languages === undefined ? { language } : { languages, language })
}

describe('auth.aeven locale selection', () => {
  it('reads the fallback dictionary outside a browser', () => {
    // Node exposes a global `navigator` reporting the machine's language; a
    // non-browser run must not let it decide the reader's language.
    vi.stubGlobal('window', undefined)
    expect(t('action.ok')).toBe(en['action.ok'])
  })

  it('matches a requested tag against a dictionary id exactly', () => {
    browserLanguages(['zh'], 'zh')
    expect(t('action.ok')).toBe(zh['action.ok'])
  })

  it('matches a regional tag by its primary subtag', () => {
    // `zh-CN` names no dictionary of its own and must still reach `zh`.
    browserLanguages(['zh-CN'], 'zh-CN')
    expect(t('action.ok')).toBe(zh['action.ok'])
  })

  it('walks the preference list in order and skips tags it ships no copy for', () => {
    browserLanguages(['fr-FR', 'zh-Hant-TW'], 'fr-FR')
    expect(t('action.ok')).toBe(zh['action.ok'])
  })

  it('falls back where the reader asks for no shipped language', () => {
    browserLanguages(['fr-FR', 'de'], 'fr-FR')
    expect(t('action.ok')).toBe(en['action.ok'])
  })

  it('reads `navigator.language` where the embedder omits `languages`', () => {
    // Embedders and older WebViews may not expose the DOM-typed property.
    browserLanguages(undefined, 'zh-CN')
    expect(t('action.ok')).toBe(zh['action.ok'])
  })
})
