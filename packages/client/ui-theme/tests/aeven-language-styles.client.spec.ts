/** Central Aeven visual constants stay in one theme-owned stylesheet. */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { packageStylesheets, parseRules } from './stylesheet-scan.ts'

const css = readFileSync(
  fileURLToPath(new URL('../src/styles/aeven-language.css', import.meta.url)),
  'utf8',
)

const conversationCss = readFileSync(
  fileURLToPath(
    new URL(
      '../../ui-conversation/src/client/skeleton/ConversationRoot.module.css',
      import.meta.url,
    ),
  ),
  'utf8',
)

const inputBarCss = readFileSync(
  fileURLToPath(
    new URL(
      '../../ui-conversation/src/client/input/InputBar.module.css',
      import.meta.url,
    ),
  ),
  'utf8',
)

const buttonCss = readFileSync(
  fileURLToPath(
    new URL('../../ui-primitives/src/Button.module.css', import.meta.url),
  ),
  'utf8',
)

describe('Aeven visual language', () => {
  it('owns the shared geometry and neutral light palette', () => {
    expect(css).toContain('--dsw-aeven-chat-width: 1024px')
    expect(css).toContain('--dsw-aeven-page-inset: 24px')
    expect(css).toContain('--dsw-aeven-sidebar-width: 300px')
    expect(css).toContain('--dsw-aeven-sidebar-row-inset: 24px')
    expect(css).toContain('--dsw-aeven-sidebar-bottom-inset: 40px')
    expect(css).toContain('--dsw-aeven-sidebar-toggle-width: 68px')
    expect(css).toContain('--dsw-aeven-sidebar-panel-radius: 30px')
    expect(css).toContain('--dsw-aeven-sidebar-transition-duration: 400ms')
    expect(css).toContain('--dsw-aeven-control-size: 40px')
    expect(css).toContain('--dsw-aeven-radius-surface: 30px')
    expect(css).toContain('--dsw-aeven-radius-control: 20px')
    expect(css).toContain('--dsw-aeven-loading-mark-size: 18px')
    expect(css).toContain('--dsw-aeven-loading-mark-color: var(--dsw-alias-label-primary)')
    expect(css).toContain('--dsw-alias-bg-base: rgb(242, 242, 242)')
    expect(css).toContain('--dsw-specific-bubble: rgb(255, 255, 255)')
  })

  it('narrows the shared page inset at the Aeven mobile breakpoint', () => {
    expect(css).toMatch(
      /@media \(max-width: 640px\)[\s\S]*--dsw-aeven-page-inset: 16px/,
    )
    expect(css).toMatch(
      /@media \(max-width: 640px\)[\s\S]*--dsw-aeven-sidebar-row-inset: 16px/,
    )
  })

  it('provides shared geometry to the primary conversation surfaces', () => {
    expect(conversationCss).toContain('var(--dsw-aeven-chat-width)')
    expect(conversationCss).toContain('var(--dsw-aeven-page-inset)')
    expect(inputBarCss).toContain('var(--dsw-aeven-radius-surface)')
    expect(inputBarCss).toContain('var(--dsw-aeven-control-size)')
    expect(buttonCss).toContain('var(--dsw-aeven-radius-control)')
  })
})

/**
 * Every wait in the product draws the same loading mark, and these are the
 * sheets that draw one: a rotating mark, its ring, or a diagram cover. The
 * vendor sheets under `src/vendor/` are the older Aeven auth and account
 * styles, which `packageStylesheets` excludes wholesale.
 */
const LOADING_GEOMETRY = ['width', 'height']
/** Selectors whose width/height is the drawn mark itself rather than a box. */
const MARK_SELECTOR = /spinner|loader|--dsw-aeven-loading-mark|--hm-diagram-loader/
/** The mark's geometry when a sheet owns the size instead of reading the token. */
const MARK_SIZE = '18px'
/**
 * A literal here is correct for exactly two sheets, both of which paint before
 * any theme or plugin is guaranteed to have loaded and so cannot read the
 * product token: `boot-page.module.css` is the framework-free boot page, and
 * `preloader.css` is inlined into the document head ahead of every stylesheet.
 * Every other sheet must consume the token, which is what keeps one product
 * decision from becoming a dozen drifting sizes.
 */
const OWNS_ITS_OWN_MARK_SIZE = new Set(['boot-page.module.css', 'preloader.css'])
/** Those same sheets, by path, for the value check below. */
const MARK_SIZE_OWNERS = [
  '../../web/src/boot-page.module.css',
  '../../../../apps/web/src/preloader.css',
]

describe('the loading mark', () => {
  it('is one size everywhere, so a wait looks the same on every surface', () => {
    // Selector parts rather than whole rules: a sheet may size the mark and
    // its inner `svg` in one comma-separated rule.
    const sized = packageStylesheets().flatMap((file) => {
      const base = basename(file)
      const exempt = OWNS_ITS_OWN_MARK_SIZE.has(base)
      return parseRules(readFileSync(file, 'utf8'))
        .filter(rule => rule.selectors.some(selector => MARK_SELECTOR.test(selector)))
        .flatMap(rule => rule.declarations
          .filter(([property]) => LOADING_GEOMETRY.includes(property))
          .filter(([, value]) => !value.includes('--dsw-aeven-loading-mark-size'))
          .filter(([, value]) => !(exempt && value === MARK_SIZE))
          .map(([property, value]) => `${base} ${property}: ${value}`))
    })
    // A bare `100%` fill is not a size of its own: it defers to a parent that
    // is itself checked here, which is how the vendor icon loaders size theirs.
    expect(sized.filter(entry => !entry.endsWith(': 100%'))).toEqual([])
  })

  it('draws the one size the sheets that own it restate', () => {
    // A sheet outside the token's reach must still agree with the token's
    // value, or the preloader would be the one wait that looks different from
    // every other wait in the product.
    expect(css).toContain(`--dsw-aeven-loading-mark-size: ${MARK_SIZE}`)
    for (const owner of MARK_SIZE_OWNERS) {
      const sheet = readFileSync(fileURLToPath(new URL(owner, import.meta.url)), 'utf8')
      // The mark and its inner `svg` are sized by one rule in each sheet.
      const sized = parseRules(sheet).flatMap(rule => (
        rule.selectors.some(selector => selector.includes('.spinner'))
          ? rule.declarations.filter(([property]) => LOADING_GEOMETRY.includes(property))
          : []
      ))
      expect(sized.length).toBeGreaterThan(0)
      expect(sized.every(([, value]) => value === MARK_SIZE)).toBe(true)
    }
  })
})
