/** Sidebar shell style contracts shared with its slot-owned controls. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SidebarRoot.module.css', import.meta.url)), 'utf8')

/**
 * Declarations of one exact selector at the sheet's top level, keyed by
 * property. Rules nested in an at-rule are skipped: the reduced-motion block
 * restates several of these selectors, and folding it in here would report the
 * override in place of the base value each test is asking about.
 * @param selector - exact selector text.
 * @returns the normalized declarations, or undefined when absent.
 */
function declarations(selector: string): Map<string, string> | undefined {
  const withoutComments = css
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ' ')
  const found = new Map<string, string>()
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
  }
  return found.size === 0 ? undefined : found
}

describe('SidebarRoot.module.css', () => {
  it('uses the Aeven panel and row geometry', () => {
    expect(declarations('.root')?.get('--avn-sidebar-inline-padding')).toBe('var(--dsw-aeven-sidebar-row-inset)')
    expect(declarations('.content')?.get('padding-top')).toBe('8px')
    const panel = declarations('.panel')
    expect(panel?.get('border-top-right-radius')).toBe('var(--dsw-aeven-sidebar-panel-radius)')
    expect(panel?.get('background')).toBe('var(--dsw-specific-sidebar-fill)')
    expect(panel?.get('opacity')).toBe('0')
    expect(declarations('.visible .panel')?.get('opacity')).toBe('1')
    // The opaque fill alone separates the panel from the conversation: the
    // drop shadow it carries is fully transparent.
    expect(panel?.get('filter')).toBe('drop-shadow(0 4px 16px rgba(0, 0, 0, 0))')
    expect(panel?.get('bottom')).toBe('-2px')
    // Rows take Aeven's control height and the shell's shared inline inset.
    expect(declarations('.newSession')?.get('height')).toBe('var(--dsw-aeven-control-size)')
    expect(declarations('.newSession')?.get('padding')).toBe('0 var(--avn-sidebar-inline-padding)')
    expect(declarations('.regionArea')?.get('margin')).toBe('0')
    expect(declarations('.regionArea')?.get('padding')).toBe('0')
  })

  it('collapses by clipping its seats in place, never repositioning them', () => {
    // The content column carries the whole collapse, and the column itself
    // travels with it, so nothing switches to fixed positioning mid-slide.
    expect(declarations('.content')?.get('position')).toBe('absolute')
    expect(declarations('.content')?.get('width')).toBe('var(--avn-sidebar-open-width)')
    expect(declarations('.root')?.get('--avn-sidebar-open-width')).toBe('0px')
    expect(declarations('.root')?.get('width')).toBe('0')
    expect(declarations('.root.visible')?.get('--avn-sidebar-open-width')).toBe('var(--dsw-aeven-sidebar-width)')
    expect(declarations('.root.visible')?.get('width')).toBe('var(--dsw-aeven-sidebar-width)')
    // Clipped, not unmounted or moved: the header row's seats shrink with the
    // column, and the row itself stays inert so no strip of it stands over the
    // conversation's own band while the column is folded away.
    expect(declarations('.header')?.get('pointer-events')).toBe('none')
    expect(declarations('.headerLeading')?.get('overflow')).toBe('hidden')
    expect(declarations('.headerActions')?.get('overflow')).toBe('hidden')
    expect(declarations('.headerLeading > *')?.get('pointer-events')).toBe('auto')
    expect(declarations('.headerActions > *')?.get('pointer-events')).toBe('auto')
    expect(declarations('.sideContent')?.get('overflow-y')).toBe('auto')
  })

  it('animates every collapsing box on Aeven\'s single duration and curve', () => {
    const eased = 'width var(--dsw-aeven-sidebar-transition-duration) var(--dsw-aeven-sidebar-transition-timing)'
    expect(declarations('.root')?.get('transition')).toBe(eased)
    expect(declarations('.content')?.get('transition')).toBe(eased)
    expect(declarations('.panel')?.get('transition')).toBe(
      `${eased}, opacity var(--dsw-aeven-sidebar-transition-duration) var(--dsw-aeven-sidebar-transition-timing)`,
    )
    // Aeven fades the body linearly against the eased slide.
    expect(declarations('.sideContent')?.get('transition')).toBe(
      `${eased}, opacity var(--dsw-aeven-sidebar-transition-duration) linear`,
    )
    // The header's cluster fades with the body below it.
    expect(declarations('.headerActions')?.get('transition'))
      .toBe('opacity var(--dsw-aeven-sidebar-transition-duration) linear')
  })

  it('keeps the slotted brand row at the full artwork height', () => {
    expect(declarations('.brandIdentity')?.get('height')).toBe('24px')
    expect(declarations('.brandName')?.get('height')).toBe('24px')
    expect(declarations('.brandName')?.get('line-height')).toBe('1.5rem')
    expect(declarations('.brandName')?.get('font-size')).toBe('1.125rem')
  })
})
