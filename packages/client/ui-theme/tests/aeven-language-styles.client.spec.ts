/** Central Aeven visual constants stay in one theme-owned stylesheet. */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { packageStylesheets, parseRules } from './stylesheet-scan.ts'
import {
  clientSheet, clientSheetCss, expectDebtStillOwed, recordedOffences, type SweepDebtRegistry,
} from './stylesheet-debt.ts'

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

/**
 * Sheets laying a leading control on the line of macOS's window controls: the
 * conversation's fold control while the left column is collapsed, the sidebar's
 * own leading control once it is open, and the image lightbox's info control.
 * The frame itself lays only the window's right-hand corner, so it consumes no
 * leading gutter.
 */
const WINDOW_CONTROLS_CONSUMERS = [
  '../../ui-conversation/src/client/skeleton/ConversationRoot.module.css',
  '../../ui-sidebar/src/client/SidebarRoot.module.css',
  '../../ui-primitives/src/ImageLightbox.module.css',
]

const authCss = readFileSync(
  fileURLToPath(
    new URL('../../ui-auth-aeven/src/vendor/aeven-auth.css', import.meta.url),
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

  it('gives the desktop window controls one gutter, one page inset past it', () => {
    expect(css).toContain('--dsw-aeven-window-controls-gutter: 84px')
    for (const consumer of WINDOW_CONTROLS_CONSUMERS) {
      const sheet = readFileSync(fileURLToPath(new URL(consumer, import.meta.url)), 'utf8')
      expect(sheet).toContain('var(--dsw-aeven-window-controls-gutter)')
    }
  })

  it('draws the auth band on the line the shell headers use', () => {
    // The auth screens render before the token sheet, so their band restates
    // this one value rather than reading it; the two must not drift.
    const token = (name: string): number => Number(new RegExp(`${name}: (\\d+)px`).exec(css)?.[1])
    const leading = token('--dsw-aeven-window-controls-gutter') + token('--dsw-aeven-page-inset')
    expect(Number.isFinite(leading)).toBe(true)
    expect(authCss).toMatch(
      new RegExp(`html\\[data-avn-traffic-lights\\][^{]*\\.auth-header \\{\\s*padding-left: ${leading}px`),
    )
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

/** One size-setting declaration carried by a rule the mark selector matches. */
interface MarkSize {
  selector: string
  property: string
  value: string
}

/**
 * The geometry declarations on every rule whose selector names a loading mark.
 * Selector parts rather than whole rules: a sheet may size the mark and its
 * inner `svg` in one comma-separated rule.
 * @param cssText - stylesheet text.
 * @returns the size-setting declarations, in source order.
 */
function markSizes(cssText: string): MarkSize[] {
  return parseRules(cssText)
    .filter(rule => rule.selectors.some(selector => MARK_SELECTOR.test(selector)))
    .flatMap(rule => rule.selectors.flatMap(selector => rule.declarations
      .filter(([property]) => LOADING_GEOMETRY.includes(property))
      .map(([property, value]): MarkSize => ({ selector, property, value }))))
}

/**
 * The size-setting declarations still off the one-size standard, as report
 * lines: the shared token's own sheets, a sheet that owns its mark size, and a
 * bare `100%` fill are all in line, and `exempt` holds the recorded debt.
 * @param cssText - stylesheet text.
 * @param exempt - selectors excused by {@link LOADING_MARK_SIZE_DEBT}.
 * @param ownsItsOwnSize - the sheet paints before the token can load and states {@link MARK_SIZE} itself.
 * @returns the declarations still off the standard.
 */
function markSizesOffStandard(cssText: string, exempt: ReadonlySet<string>, ownsItsOwnSize: boolean): string[] {
  return markSizes(cssText)
    .filter(size => !exempt.has(size.selector))
    .filter(size => !size.value.includes('--dsw-aeven-loading-mark-size'))
    .filter(size => !(ownsItsOwnSize && size.value === MARK_SIZE))
    // A bare `100%` fill is not a size of its own: it defers to a parent that
    // is itself checked here, which is how the vendor icon loaders size theirs.
    .filter(size => size.value !== '100%')
    .map(size => `${size.selector} ${size.property}: ${size.value}`)
}

/**
 * Sheets whose wait restates a size rather than consuming the product's one
 * loading mark, keyed by sheet path under packages/client/ with the selectors
 * that size it. aeven-language.css owns the token — "One loading mark for every
 * wait in the product … Surfaces consume these rather than restating a size, so
 * the mark cannot drift apart again" — and these sheets live in packages this
 * one does not own, so the debt is recorded here rather than fixed there; every
 * other rule in the same sheet, and every sheet with no entry, still fails the
 * sweep.
 */
const LOADING_MARK_SIZE_DEBT: SweepDebtRegistry = {
  // The upload tile draws its own 16px mark inside an 80px (60px above the
  // sm breakpoint) seat instead of seating the shared Spinner.
  'ui-attachment/src/UploadTray.module.css': {
    offences: ['.spinnerBox', '.spinner'],
    reason: 'tile draws its own 16px mark in an 80px/60px seat instead of the shared Spinner',
  },
  // The dictation loader draws the same glyph at its own 16px.
  'ui-voice-input/src/client/VoiceInput.module.css': {
    offences: ['.loader'],
    reason: 'dictation loader draws the mark at 16px instead of the shared size',
  },
}

describe('the loading mark', () => {
  it('is one size everywhere, so a wait looks the same on every surface', () => {
    const sized = packageStylesheets().flatMap(file => markSizesOffStandard(
      readFileSync(file, 'utf8'),
      recordedOffences(LOADING_MARK_SIZE_DEBT, clientSheet(file)),
      OWNS_ITS_OWN_MARK_SIZE.has(basename(file)),
    ))
    expect(sized).toEqual([])
    expectDebtStillOwed(LOADING_MARK_SIZE_DEBT, (sheet, selector) =>
      markSizesOffStandard(clientSheetCss(sheet), new Set(), false).some(line => line.startsWith(`${selector} `)))
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
