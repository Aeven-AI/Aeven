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
    expect(css).toContain('--dsw-alias-bg-base: var(--dsw-aeven-well)')
    expect(css).toContain('--dsw-specific-bubble: var(--dsw-aeven-surface)')
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

/**
 * The light scheme's whole neutral vocabulary: three ink steps, one disabled
 * step, and three surfaces. `aeven-language.css` states them once and every
 * alias picks one, so the scheme cannot drift back to a dozen near-identical
 * greys. Alias values are held to this set; translucent tints and the state
 * blends may tint them but cannot introduce another opaque neutral.
 */
const LIGHT_NEUTRAL_RAMP = [
  ['--dsw-aeven-ink', '#000000'],
  ['--dsw-aeven-ink-muted', 'rgb(80, 80, 80)'],
  ['--dsw-aeven-ink-faint', 'rgb(150, 150, 150)'],
  ['--dsw-aeven-ink-disabled', 'rgb(205, 205, 205)'],
  ['--dsw-aeven-surface', 'rgb(255, 255, 255)'],
  ['--dsw-aeven-well', 'rgb(242, 242, 242)'],
  ['--dsw-aeven-raised', 'rgb(235, 235, 235)'],
] as const

/** Channel spread below which a colour reads as neutral rather than tinted. */
const NEUTRAL_SPREAD = 14

/** Custom-property families that carry the scheme's surfaces and ink. */
const PALETTE_ALIAS = /^--dsw-(?:alias|specific)-/

/** One `body` block of a theme sheet, in source order. */
interface BodyRule {
  /** Whether the block selects the dark palette. */
  dark: boolean
  /** The block's `--dsw-*` declarations, in source order. */
  declarations: [property: string, value: string][]
}

/**
 * Every `body` block a sheet declares, including those nested in a media query.
 * @param css - stylesheet text.
 * @returns the blocks in source order, tagged with the palette they select.
 */
function bodyRules(css: string): BodyRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...text.matchAll(/(?<![-\w.#])body([^{}]*)\{/g)].map((match) => {
    const start = (match.index ?? 0) + match[0].length
    let depth = 1
    let end = start
    for (; end < text.length && depth > 0; end += 1) {
      if (text[end] === '{') depth += 1
      else if (text[end] === '}') depth -= 1
    }
    const declarations = text.slice(start, end - 1).split(';')
      .map(part => part.trim())
      .filter(part => part.startsWith('--dsw-') && part.includes(':'))
      .map((part): [string, string] => [
        part.slice(0, part.indexOf(':')).trim(),
        part.slice(part.indexOf(':') + 1).trim(),
      ])
    return { dark: (match[1] ?? '').trim() === '[data-ds-dark-theme]', declarations }
  })
}

/**
 * The light palette as the cascade resolves it: the sheets in mount order, light
 * blocks only, later declarations winning.
 * @returns every `--dsw-*` property the light scheme declares.
 */
function lightPalette(): Map<string, string> {
  const palette = new Map<string, string>()
  // Mount order, from `client/styles.ts`: the upstream platform palette first,
  // then the Aeven layer that overrides it.
  for (const sheet of ['design-platform.css', 'aeven-language.css']) {
    for (const rule of bodyRules(readFileSync(fileURLToPath(new URL(`../src/styles/${sheet}`, import.meta.url)), 'utf8'))) {
      if (rule.dark) continue
      for (const [property, value] of rule.declarations) palette.set(property, value)
    }
  }
  return palette
}

/**
 * Resolve one custom property through its `var()` chain.
 * @param palette - the declarations of one scheme.
 * @param name - property to resolve.
 * @returns the literal the chain ends at, or undefined when it leaves the palette.
 */
function resolveIn(palette: ReadonlyMap<string, string>, name: string): string | undefined {
  let current = name
  for (let hops = 0; hops < 8; hops += 1) {
    const value = palette.get(current)
    if (value === undefined) return undefined
    const reference = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value)
    if (reference === null) return value
    current = reference[1] ?? ''
  }
  return undefined
}

/**
 * The channels of an opaque colour literal.
 * @param value - declaration value.
 * @returns `[r, g, b]`, or undefined for a translucent, named, or computed value.
 */
function opaqueChannels(value: string): [number, number, number] | undefined {
  const text = value.trim().toLowerCase()
  const rgb = /^rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)\s*\)$/.exec(text)
  if (rgb !== null) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  const hex = /^#([0-9a-f]{6})$/.exec(text)
  if (hex !== null) {
    const digits = hex[1] ?? ''
    return [0, 2, 4].map(offset => parseInt(digits.slice(offset, offset + 2), 16)) as [number, number, number]
  }
  return undefined
}

describe('the light scheme neutral ramp', () => {
  const palette = lightPalette()
  const ramp = new Set(LIGHT_NEUTRAL_RAMP.map(([, value]) => (opaqueChannels(value) ?? []).join(',')))

  it('states each ramp step once, as its own literal', () => {
    expect(ramp.size).toBe(LIGHT_NEUTRAL_RAMP.length)
    for (const [name, value] of LIGHT_NEUTRAL_RAMP) {
      expect(palette.get(name), `${name} states a ramp step`).toBe(value)
    }
  })

  it('resolves every surface and ink alias to a ramp step, not a grey of its own', () => {
    const stray: string[] = []
    for (const [name, declared] of palette) {
      if (!PALETTE_ALIAS.test(name)) continue
      const resolved = resolveIn(palette, name) ?? declared
      const channels = opaqueChannels(resolved)
      if (channels === undefined) continue
      if (Math.max(...channels) - Math.min(...channels) > NEUTRAL_SPREAD) continue
      if (!ramp.has(channels.join(','))) stray.push(`${name}: ${resolved}`)
    }
    expect(stray).toEqual([])
  })
})
