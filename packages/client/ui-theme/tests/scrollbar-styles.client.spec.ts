/**
 * Scrollbar stylesheet contract, asserted against the CSS text on disk: every
 * --dsw-alias-scrollbar-* token design-platform.css defines has a consumer,
 * scrollbar.css binds the base-surface pair through the rebindable
 * indirection and both of its rendering paths read it, the standard property
 * the iOS/Safari 14.5 baseline carries reaches every engine as the primary path
 * while the gutter-consuming pseudo-element skin stays behind the fallback
 * gate, and elevated surfaces rebind that indirection in complete pairs. The
 * expected token set is scanned out of design-platform.css, so adding,
 * renaming, or dropping a scrollbar token moves these assertions with it.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { atRuleBlock, type CssRule, packageStylesheets, parseRules, varReferences } from './stylesheet-scan.ts'

const STYLES = new URL('../src/styles/', import.meta.url)
const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, STYLES)), 'utf8')

const platformCss = read('design-platform.css')
const scrollbarCss = read('scrollbar.css')

/** Body attribute selecting the dark palette; ui-layout's ThemePresenter sets it. */
const DARK_ATTRIBUTE = '[data-ds-dark-theme]'
/** Alias tokens under test: the prefix the elevation pairs share. */
const TOKEN_PREFIX = '--dsw-alias-scrollbar-'
/** Prefix of the rebindable indirection scrollbar.css owns. */
const INDIRECTION_PREFIX = '--dsh-scrollbar-'
/** The indirection both rendering paths read, and every elevated surface rebinds. */
const THUMB_INDIRECTION = `${INDIRECTION_PREFIX}thumb`
/** The one non-token rebind value: a surface that draws no thumb at all. */
const HIDDEN_THUMB = 'transparent'
/** Selector of the global opt-out class: it goes on the scrolling element itself. */
const OPT_OUT_SELECTOR = '.no-scrollbar'
/** The elevation rebind, spelled per property: value-wholeness, not token shape. */
const ELEVATED_REBIND = new Map([
  ['--dsh-scrollbar-thumb', '--dsw-alias-scrollbar-bg-l2'],
  ['--dsh-scrollbar-thumb-hover', '--dsw-alias-scrollbar-hover-l2'],
].map(([property, token]) => [property!, `var(${token!})`]))

/**
 * Tokens a stylesheet reads through its rendering declarations, following its
 * own custom-property definitions transitively so a token reached only through
 * an indirection counts. The walk starts from the standard-property
 * declarations, so a defined-but-unread indirection contributes nothing.
 * @param rules - parsed rules of one stylesheet.
 * @returns every `--dsw-*` token the sheet's rendering declarations depend on.
 */
function tokensRendered(rules: CssRule[]): Set<string> {
  const definitions = new Map<string, string>()
  const pending: string[] = []
  for (const rule of rules) {
    for (const [property, value] of rule.declarations) {
      if (property.startsWith('--')) definitions.set(property, value)
      else pending.push(value)
    }
  }
  const reached = new Set<string>()
  const visited = new Set<string>()
  while (pending.length > 0) {
    for (const name of varReferences(pending.pop()!)) {
      if (name.startsWith('--dsw-')) reached.add(name)
      if (visited.has(name)) continue
      visited.add(name)
      const definition = definitions.get(name)
      if (definition !== undefined) pending.push(definition)
    }
  }
  return reached
}

const platformRules = parseRules(platformCss)
const scrollbarRules = parseRules(scrollbarCss)
const sorted = (names: Iterable<string>): string[] => [...names].sort()

/**
 * Scrollbar tokens defined by the rules whose selectors carry (or do not
 * carry) the dark palette attribute.
 * @param dark - true to scan the dark blocks, false to scan the light blocks.
 * @returns the scrollbar token names defined there.
 */
function definedTokens(dark: boolean): Set<string> {
  const names = new Set<string>()
  for (const rule of platformRules) {
    if (rule.selectors.every(selector => selector.includes(DARK_ATTRIBUTE)) !== dark) continue
    for (const [property] of rule.declarations) {
      if (property.startsWith(TOKEN_PREFIX)) names.add(property)
    }
  }
  return names
}

const lightTokens = definedTokens(false)
const darkTokens = definedTokens(true)
const allTokens = new Set([...lightTokens, ...darkTokens])

/** Every scrollbar token any package stylesheet references, mapped to the files referencing it. */
const referencedTokens = new Map<string, string[]>()
/** Every indirection property any package stylesheet outside ui-theme declares, mapped to its declaring rules. */
const rebindRules: { file: string; rule: CssRule }[] = []
/**
 * What one stylesheet contributes to the elevated-surface question: which
 * elevated surfaces it paints, whether any rule scrolls, and whether it
 * rebinds. Kept per file rather than per rule because the elevated card and the
 * descendant that actually scrolls are separate rules in the same sheet, and
 * CSS text does not express which contains which.
 */
interface SheetSurfaces {
  /** Elevated surface tokens this sheet paints anywhere. */
  elevated: Set<string>
  /** True when some rule declares `overflow*: auto|scroll`. */
  scrolls: boolean
  /**
   * True when some rule rebinds the indirection to an ELEVATION. A rule that
   * only hides the bar (`transparent`) does not count: it states no elevation,
   * so a sheet that hides its bars and also scrolls on an elevated surface
   * still owes the l2 pair for whatever draws a thumb there.
   */
  rebindsElevation: boolean
}
const sheetSurfaces = new Map<string, SheetSurfaces>()

/** Properties whose `auto`/`scroll` value makes a rule a scroll container. */
const OVERFLOW_PROPERTIES = ['overflow', 'overflow-x', 'overflow-y']
/** Properties that paint a surface, and so identify the elevation a rule sits on. */
const SURFACE_PROPERTIES = ['background', 'background-color']
/**
 * Token families that name a SURFACE — a background an element is drawn on, and
 * so something a scrollbar can sit against. `--dsw-alias-button-*`,
 * `--dsw-alias-interactive-*`, and `--dsw-alias-markdown-*` reach the same dark
 * elevation rungs while naming a control or an inline span, which no scroll
 * container renders its bar against (ChatView's floating `.toBottom` pill,
 * CodeBlock's banner). Family, not geometry: a floating button legitimately
 * carries a radius, a shadow, and a fixed size, so shape cannot separate them.
 */
const SURFACE_TOKEN_PATTERN = /^--dsw-(?:alias-bg-|specific-)/

/**
 * The palette's own dark elevation ladder, resolved from `design-platform.css`:
 * `bg-layer-2` and `bg-layer-3` are the rungs above the base surfaces, and the
 * l1/l2 scrollbar split encodes exactly that step. Reading it from the palette
 * rather than from the sheets that happen to rebind is what lets the check flag
 * a surface NOBODY has rebound yet.
 * @returns surface tokens whose dark value sits on an elevated rung.
 */
function elevatedRungs(): Set<string> {
  const definitions = new Map<string, string>()
  for (const rule of platformRules) {
    // Dark declarations come later in the sheet and overwrite the light ones,
    // which is the palette this distinction exists in.
    for (const [property, value] of rule.declarations) definitions.set(property, value)
  }
  const resolve = (name: string): string => {
    const seen = new Set<string>()
    let current = name
    while (definitions.has(current) && !seen.has(current)) {
      seen.add(current)
      const value = definitions.get(current)!
      const [reference] = varReferences(value)
      if (reference === undefined) return value
      current = reference
    }
    return current
  }
  const rungs = new Set([resolve('--dsw-alias-bg-layer-2'), resolve('--dsw-alias-bg-layer-3')])
  const tokens = new Set<string>()
  for (const name of definitions.keys()) {
    if (SURFACE_TOKEN_PATTERN.test(name) && rungs.has(resolve(name))) tokens.add(name)
  }
  return tokens
}

const elevatedSurfaces = elevatedRungs()

for (const file of packageStylesheets()) {
  const rules = parseRules(readFileSync(file, 'utf8'))
  const surfaces: SheetSurfaces = { elevated: new Set(), scrolls: false, rebindsElevation: false }
  for (const rule of rules) {
    let rebinds = false
    let rebindsElevation = false
    const ruleSurfaces: string[] = []
    for (const [property, value] of rule.declarations) {
      if (property.startsWith(INDIRECTION_PREFIX) && file !== fileURLToPath(new URL('scrollbar.css', STYLES))) {
        rebinds = true
        if (value !== HIDDEN_THUMB) rebindsElevation = true
      }
      if (OVERFLOW_PROPERTIES.includes(property) && /\b(?:auto|scroll)\b/.test(value)) surfaces.scrolls = true
      if (SURFACE_PROPERTIES.includes(property)) ruleSurfaces.push(...varReferences(value))
      for (const token of varReferences(value)) {
        if (!token.startsWith(TOKEN_PREFIX)) continue
        referencedTokens.set(token, [...referencedTokens.get(token) ?? [], file])
      }
    }
    for (const token of ruleSurfaces) {
      if (elevatedSurfaces.has(token)) surfaces.elevated.add(token)
    }
    if (rebinds) rebindRules.push({ file, rule })
    if (rebindsElevation) surfaces.rebindsElevation = true
  }
  sheetSurfaces.set(file, surfaces)
}

describe('design-platform.css scrollbar tokens', () => {
  it('defines the same scrollbar token set in the light and the dark block', () => {
    // A token present only in the light block silently keeps its light value
    // under the dark palette, since the dark block only overrides.
    expect(allTokens.size).toBeGreaterThan(0)
    expect(sorted(lightTokens)).toEqual(sorted(allTokens))
    expect(sorted(darkTokens)).toEqual(sorted(allTokens))
  })

  it('resolves every scrollbar token to a static scale value, not to another alias', () => {
    // The alias layer is the only indirection in the token sheet: an alias
    // pointing at a second alias makes the dark override order-dependent.
    for (const rule of platformRules) {
      for (const [property, value] of rule.declarations) {
        if (!property.startsWith(TOKEN_PREFIX)) continue
        for (const reference of varReferences(value)) {
          expect(reference, `${property}: ${value}`).toMatch(/^--dsw-static-/)
        }
      }
    }
  })
})

describe('scrollbar token consumers', () => {
  it('every defined scrollbar token is referenced by some package stylesheet', () => {
    // Before scrollbar.css existed these tokens had no consumer at all and
    // every scroll container rendered the unthemed UA bar. A fifth token, or a
    // rename on one side only, leaves the new name unreferenced here.
    expect(sorted(referencedTokens.keys())).toEqual(sorted(allTokens))
  })

  it('every referenced scrollbar token is defined in design-platform.css', () => {
    // A dangling var() renders the UA default instead of failing loudly, so a
    // rename has to move the reference and the definition together.
    for (const [token, files] of referencedTokens) {
      expect(allTokens, files.join(', ')).toContain(token)
    }
  })
})

describe('scrollbar.css base-surface binding', () => {
  const rendered = tokensRendered(scrollbarRules)

  it('renders the l1 pair through the rebindable indirection', () => {
    // l1 is the base-surface default the indirection resolves to; the
    // indirection only counts as bound when a rendering declaration reads it.
    expect(rendered).toContain(`${TOKEN_PREFIX}bg-l1`)
    expect(rendered).toContain(`${TOKEN_PREFIX}hover-l1`)
  })

  it('routes both rendering paths through the one thumb indirection', () => {
    // A rebind on an elevated container has to move the standard and the WebKit
    // rendering together, which only holds while both read the one variable: the
    // indirection this sheet declares, and that every rebinding rule outside it
    // targets.
    const declared = scrollbarRules
      .filter(rule => rule.selectors.some(selector => selector.startsWith('body')))
      .flatMap(rule => rule.declarations)
      .findLast(([property]) => property === THUMB_INDIRECTION)
    expect(declared?.[1], 'the indirection the elevated surfaces rebind').toBe(`var(${TOKEN_PREFIX}bg-l1)`)
    // The WebKit thumb, the surviving rendering path: a direct token reference
    // here would keep the base-surface colour under every rebind.
    const thumb = scrollbarRules
      .filter(rule => rule.selectors.includes('::-webkit-scrollbar-thumb'))
      .flatMap(rule => rule.declarations)
      .findLast(([property]) => property === 'background')
    expect(varReferences(thumb?.[1] ?? '')).toEqual([THUMB_INDIRECTION])
  })
})

describe('scrollbar.css rendering paths', () => {
  /** The fallback gate, spelled exactly as the sheet must spell it for the split to exist. */
  const GATE = '@supports not (scrollbar-width: thin)'
  const withoutComments = scrollbarCss.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const gate = atRuleBlock(withoutComments, GATE)
  /** The standard path's property: the one that leaves a scrolling box its full width. */
  const STANDARD_PROPERTY = 'scrollbar-width'
  /**
   * The standard property the iOS/Safari 14.5 baseline does not carry. It is
   * asserted absent rather than asserted out of the gate: a declaration inside
   * would never reach Firefox, and one outside it would reach Safari, where the
   * stylesheet must keep `::-webkit-scrollbar-thumb` as the only themed path.
   */
  const BASELINE_UNPARSED = 'scrollbar-color'

  /** Offsets of every rule selector that starts with `::-webkit-scrollbar`. */
  function webkitRuleOffsets(css: string): number[] {
    return [...css.matchAll(/::-webkit-scrollbar/g)]
      .map(match => match.index)
      .filter(offset => css.slice(offset).search(/^[\w:-]*\s*[,{]/) === 0)
  }

  it('declares the standard property outside the fallback gate, and only the one the floor parses', () => {
    // It is the path that gives a scrolling box its width back, so the engines
    // that parse it must take it: a `::-webkit-scrollbar` width is what forces
    // the bar into a gutter and takes 8px off every scrolling box with it.
    // Measured in chromium 151 on the running app, one scroller stated both
    // ways: `offsetWidth - clientWidth` is 8 with the pseudo-element width and 0
    // with the standard property.
    expect(gate, GATE).toBeDefined()
    const offsets = [...withoutComments.matchAll(new RegExp(String.raw`(^|[;{\s])${STANDARD_PROPERTY}\s*:`, 'g'))]
      .map(match => match.index)
    expect(offsets.length, STANDARD_PROPERTY).toBeGreaterThan(0)
    for (const offset of offsets) {
      expect(offset > gate!.start && offset < gate!.end, `${STANDARD_PROPERTY} inside ${GATE}`).toBe(false)
    }
    // The pair's other half is what the floor cannot render: the baseline gate
    // bans `scrollbar-color` (Safari 18.2), so the sheet states none and the
    // pseudo-element skin below is the sole themed path on WebKit.
    expect([...withoutComments.matchAll(new RegExp(String.raw`(^|[;{\s])${BASELINE_UNPARSED}\s*:`, 'g'))]
      .map(match => match.index), `${BASELINE_UNPARSED} is not part of the iOS/Safari 14.5 baseline`)
      .toEqual([])
  })

  it('keeps the WebKit pseudo-element skin inside the fallback gate', () => {
    // Reach, stated rather than inherited from the suppression. A non-`auto`
    // `scrollbar-width` or `scrollbar-color` makes chromium and Safari discard
    // every `::-webkit-scrollbar*` rule for that element, so an ungated skin
    // would be dropped by the engines this gate exists to keep it away from and
    // read as dead CSS; gated, the rule states which engines own it. The one
    // pseudo-element rule outside is the opt-out below, which the engines that
    // need it are exactly the ones that cannot suppress it.
    expect(gate, GATE).toBeDefined()
    const inside = withoutComments.slice(gate!.start, gate!.end)
    expect(webkitRuleOffsets(inside).length, 'skin rules inside the gate').toBeGreaterThan(0)
    const outside = withoutComments.slice(0, gate!.start) + withoutComments.slice(gate!.end)
    for (const offset of webkitRuleOffsets(outside)) {
      const selectorStart = Math.max(0, offset - OPT_OUT_SELECTOR.length)
      expect(outside.slice(selectorStart, offset), 'unscoped skin rule outside the gate')
        .toBe(OPT_OUT_SELECTOR)
    }
  })

  it('declares the no-scrollbar opt-out on both rendering paths', () => {
    // Surfaces opt out by class name, so a rule that goes missing — or lands on
    // the wrong side of the gate — leaves the bar rendering with nothing to
    // report it: the class in the markup has no other contract. Both halves sit
    // outside the gate: the standard half is what the modern engines read, and
    // the pseudo-element half is what the engines without it read.
    const rules = parseRules(scrollbarCss)
    expect(rules.find(rule => rule.selectors.includes('.no-scrollbar'))?.declarations)
      .toContainEqual(['scrollbar-width', 'none'])
    expect(rules.find(rule => rule.selectors.includes('.no-scrollbar::-webkit-scrollbar'))?.declarations)
      .toContainEqual(['display', 'none'])
  })

  it('renders the hover token only through the fallback path', () => {
    // The standard path has no hover counterpart — scrollbar-color states one
    // thumb colour and the engine derives its own hover treatment — so the hover
    // indirection renders exactly where the pseudo-element skin does, and
    // nowhere else.
    const hoverOffsets = [...withoutComments.matchAll(new RegExp(String.raw`var\(\s*${INDIRECTION_PREFIX}thumb-hover`, 'g'))]
      .map(match => match.index)
    expect(hoverOffsets.length).toBeGreaterThan(0)
    for (const offset of hoverOffsets) {
      expect(offset > gate!.start && offset < gate!.end, 'hover indirection read outside the fallback gate').toBe(true)
    }
  })
})

describe('scrollbar.css selectors', () => {
  /** Selectors declaring the standard property, which is the sheet's rendering path. */
  const standardPropertySelectors = scrollbarRules
    .filter(rule => rule.declarations.some(([property]) => property === 'scrollbar-width'))
    .flatMap(rule => rule.selectors)

  it('declares the standard property on descendants, where the body-scoped tokens are visible', () => {
    // design-platform.css defines the alias tokens on `body`, and custom
    // properties inherit downward only, so the rendering declarations have to
    // sit at or below `body`: the same declaration on `html` or `:root`
    // resolves to the guaranteed-invalid value, which computes the thumb to the
    // engine default and drops the theming entirely. The root element draws no
    // scrollbar and nothing inherits the property from it, so a declaration
    // there would be one no element reads.
    // The `.no-scrollbar` opt-out is the one exception: it is a global class a
    // surface puts on its own scrolling element, so where it sits in the tree is
    // the matching surface's business rather than this sheet's.
    expect(standardPropertySelectors.length).toBeGreaterThan(0)
    for (const selector of standardPropertySelectors) {
      if (selector === OPT_OUT_SELECTOR) continue
      expect(selector, selector).toMatch(/^body\b/)
    }
    expect(standardPropertySelectors).toContain('body *')
    expect(standardPropertySelectors).not.toContain('html')
    expect(standardPropertySelectors).not.toContain(':root')
  })

  it('defines the indirection where the alias tokens are visible', () => {
    const definesIndirection = ([property, value]: [string, string]): boolean =>
      property.startsWith(INDIRECTION_PREFIX) && value.includes(TOKEN_PREFIX)
    const hosts = scrollbarRules
      .filter(rule => rule.declarations.some(definesIndirection))
      .flatMap(rule => rule.selectors)
    expect(hosts.length).toBeGreaterThan(0)
    for (const selector of hosts) expect(selector, selector).toMatch(/^body\b/)
  })

  it('re-declares the standard property per element rather than leaving it to inherit', () => {
    // scrollbar-width is not an inherited property at all: stated once on `body`
    // it reaches no scroller that actually overflows, and the whole sheet falls
    // back to the engine default. `body *` is what every scrolling element in
    // the client matches. The `.no-scrollbar` opt-out carries the same property
    // and outranks it by specificity, on the scrolling element itself.
    expect(standardPropertySelectors).toContain('body *')
    expect(scrollbarRules.find(rule => rule.selectors.includes('.no-scrollbar'))?.declarations)
      .toContainEqual(['scrollbar-width', 'none'])
  })
})

describe('elevated surface rebinds', () => {
  it('at least one surface rebinds the indirection', () => {
    expect(rebindRules.length).toBeGreaterThan(0)
  })

  it('each rebinding rule sets the thumb and the hover variable together', () => {
    // A surface rebinding only the resting colour keeps the l1 hover colour,
    // so the elevation is wrong only while the pointer is over the thumb.
    for (const { file, rule } of rebindRules) {
      const properties = rule.declarations.map(([property]) => property).filter(property => property.startsWith(INDIRECTION_PREFIX))
      expect(sorted(properties), `${file} ${rule.selectors.join(', ')}`).toEqual([
        `${INDIRECTION_PREFIX}thumb-hover`, `${INDIRECTION_PREFIX}thumb`,
      ].sort())
    }
  })

  it('each rebinding rule binds the indirection names scrollbar.css renders', () => {
    // A misspelled property name declares an unused variable, and the surface
    // silently keeps the base-surface colour.
    const rendered = new Set(
      scrollbarRules
        .flatMap(rule => rule.declarations)
        .filter(([property]) => !property.startsWith('--'))
        .flatMap(([, value]) => varReferences(value))
        .filter(name => name.startsWith(INDIRECTION_PREFIX)),
    )
    for (const { file, rule } of rebindRules) {
      for (const [property] of rule.declarations) {
        if (property.startsWith(INDIRECTION_PREFIX)) expect(rendered, `${file}: ${property}`).toContain(property)
      }
    }
  })

  it('rebinds the pair to one target: the l2 elevation pair, or transparent', () => {
    // The rule as a whole, not each declaration on its own. Per-declaration
    // checking accepts a MIXED rule — `thumb: transparent` beside
    // `thumb-hover: var(--dsw-alias-scrollbar-hover-l2)` — which repaints the
    // bar the moment the pointer reaches it while passing a gate that claims
    // the two targets are exclusive.
    //
    // The elevation half compares the whole value against the pair's canonical
    // spelling rather than checking that every token it mentions ends in `-l2`.
    // A shape check admits `color-mix(…, var(--dsw-alias-scrollbar-bg-l2) 85%,
    // white)` and a crossed pair (the hover token bound to the resting
    // property); neither is what the contract says.
    for (const { file, rule } of rebindRules) {
      const rebinds = rule.declarations.filter(([property]) => property.startsWith(INDIRECTION_PREFIX))
      const where = `${file} ${rule.selectors.join(', ')}`
      if (rebinds.every(([, value]) => value === HIDDEN_THUMB)) continue
      expect(rebinds.some(([, value]) => value === HIDDEN_THUMB), `${where}: mixes ${HIDDEN_THUMB} with an elevation`).toBe(false)
      for (const [property, value] of rebinds) {
        expect(value, `${where}: ${property}`).toBe(ELEVATED_REBIND.get(property))
      }
    }
  })

  it('resolves the elevated surface set from the palette ladder', () => {
    // The set has to come from the palette, not from the sheets that happen to
    // rebind: derived from rebinds it can only confirm what someone already
    // remembered, and a surface nobody has rebound yet — the case the check
    // exists for — would define itself as unelevated. Anchoring it here means a
    // new palette token on an elevated rung is in scope the moment it is
    // defined. `--dsw-specific-tip` is the regression that proved the point: it
    // resolves to the same dark rung as the menu surface, and the Todo panel
    // scrolled on it unrebound while a rebind-derived set stayed green.
    expect(elevatedSurfaces).toContain('--dsw-alias-bg-layer-2')
    expect(elevatedSurfaces).toContain('--dsw-alias-bg-layer-3')
    expect(elevatedSurfaces).toContain('--dsw-specific-menu')
    expect(elevatedSurfaces).toContain('--dsw-specific-input-major')
    expect(elevatedSurfaces).toContain('--dsw-specific-tip')
    // Base surfaces stay out, or every scroll container would be in scope and
    // the check would say nothing.
    expect(elevatedSurfaces).not.toContain('--dsw-alias-bg-base')
    expect(elevatedSurfaces).not.toContain('--dsw-alias-bg-layer-1')
  })

  it('every sheet that scrolls on an elevated surface rebinds', () => {
    // The failure this closes: a scroll container on an elevated surface that
    // nobody remembered to rebind renders the l1 thumb, which differs from l2
    // only in the dark palette and only for that one surface — invisible both in
    // review and in a light-palette screenshot. Four sheets shipped that way
    // (ui-primitives Menu, InputBar, QuestionComposer, TodoPanel) and review
    // caught them by hand, which is what this replaces.
    //
    // Surface-level, not element-level: the elevated card and the descendant
    // that scrolls are separate rules, and CSS text does not say which contains
    // which. What keeps that from over-reporting is the token FAMILY: only
    // `--dsw-alias-bg-*` and `--dsw-specific-*` name a surface, so a floating
    // button or an inline code span reaching the same rung is out of scope
    // (ChatView's `.toBottom`, CodeBlock's banner). Geometry cannot make that
    // call — a floating button carries a radius, a shadow, and a fixed size.
    for (const [file, surfaces] of sheetSurfaces) {
      if (!surfaces.scrolls || surfaces.rebindsElevation) continue
      expect([...surfaces.elevated], `${file} scrolls on an elevated surface without rebinding`).toEqual([])
    }
  })
})
