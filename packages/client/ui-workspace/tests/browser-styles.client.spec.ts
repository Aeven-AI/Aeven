/**
 * WorkspaceBrowser spacing contract, asserted against the CSS text on disk:
 * row fills use the shell's Aeven inset, the scrollbar stays stable, and flat,
 * grouped, and search views share the source menu's continuous row rhythm.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/rows/WorkspaceBrowser.module.css', import.meta.url)), 'utf8')
const rowsCss = readFileSync(fileURLToPath(new URL('../src/client/rows/Rows.module.css', import.meta.url)), 'utf8')

/**
 * Declarations of one selector rule, keyed by property with whitespace collapsed.
 * Declaration order and trailing semicolons are normalized away.
 * @param selector - one exact selector, including a leading dot for local classes.
 * @returns the rule's declarations, or undefined when no such rule exists.
 */
function declarationsFrom(source: string, selector: string): Map<string, string> | undefined {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
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

const declarations = (selector: string): Map<string, string> | undefined => declarationsFrom(css, selector)
const rowDeclarations = (selector: string): Map<string, string> | undefined => declarationsFrom(rowsCss, selector)

describe('WorkspaceBrowser.module.css list', () => {
  const root = declarations('.root')
  const listArea = declarations('.listArea')
  const list = declarations('.list')

  it('is the scrolling region', () => {
    expect(list).toBeDefined()
    expect(list!.get('overflow-y')).toBe('auto')
  })

  it('keeps the list full-width while rows own the Aeven inset', () => {
    expect(root?.get('padding')).toBe('0')
    expect(listArea?.get('margin')).toBe('0')
    expect(listArea?.get('padding')).toBe('0')
    expect(declarations('.fade')?.get('right')).toBe('0')
    expect(list?.get('margin')).toBe('0')
    expect(list?.get('padding-left')).toBe('0')
    expect(list?.get('padding-right')).toBe('0')
    expect(rowDeclarations('.projectRow')?.get('padding')).toBe('0 0 0 var(--avn-sidebar-inline-padding)')
    expect(rowDeclarations('.sessionRow')?.get('padding')).toBe('0 0 0 var(--avn-sidebar-inline-padding)')
    expect(declarations('.list::-webkit-scrollbar')).toBeUndefined()
  })

  it('lets non-overflowing rows retain the full Aeven panel width', () => {
    expect(list!.get('scrollbar-gutter')).toBeUndefined()
  })

  it('keeps Aeven rows and workspace groups contiguous', () => {
    expect(declarations('.flatList > * + *')?.get('margin-top')).toBe('0')
    expect(declarations(".searchTree > [role='treeitem'] + [role='treeitem']")?.get('margin-top')).toBe('0')
    expect(declarations('.groupSection > * + *')?.get('margin-top')).toBe('0')
    expect(declarations('.groupSection + .groupSection')?.get('margin-top')).toBe('0')
  })

  it('draws drag targets as a leading chevron joined to the insertion line', () => {
    const listTopMarker = declarations('.listTopDropIndicator')
    const workspaceMarker = declarations('.workspaceDropBefore::before')
    const sessionMarker = rowDeclarations('.sessionRow.dropBefore::before')
    expect(listTopMarker?.get('top')).toBe('-8px')
    expect(listTopMarker?.get('left')).toBe('0')
    expect(workspaceMarker?.get('left')).toBe('0')
    expect(sessionMarker?.get('left')).toBe('0')
    for (const marker of [listTopMarker, workspaceMarker, sessionMarker]) {
      expect(marker?.get('height')).toBe('12px')
      expect(marker?.get('background')).not.toContain('radial-gradient')
      expect(marker?.get('background')).toContain('55deg')
      expect(marker?.get('background')).toContain('125deg')
      expect(marker?.get('background')).toContain('calc(50% - 1px) calc(50% + 1px)')
      expect(marker?.get('background')).toContain('0 0 / 5px 7px')
      expect(marker?.get('background')).toContain('0 5px / 5px 7px')
      expect(marker?.get('background')).toContain('4px 5px / calc(100% - 4px) 2px')
    }
  })

  it('keeps the compact fade, overflow control, search field, and row heights', () => {
    expect(declarations('.fade')?.get('height')).toBe('24px')
    expect(declarations('.sessionOverflowButton')?.get('height')).toBe('var(--dsw-aeven-control-size)')
    expect(declarations('.searchExpanded')?.get('height')).toBe('30px')
    expect(rowDeclarations('.projectRow')?.get('height')).toBe('var(--dsw-aeven-control-size)')
    expect(rowDeclarations('.sessionRow')?.get('height')).toBe('var(--dsw-aeven-control-size)')
    expect(rowDeclarations('.flatSessionRowWithoutStatus .title')?.get('margin-left')).toBe('0')
    expect(rowDeclarations('.searchResultRow')?.get('min-height')).toBe('48px')
    expect(rowDeclarations('.sessionRow.selected')?.get('background'))
      .toBe('transparent')
  })

  it('pins both rail controls to the shared left anchor during the column slide', () => {
    expect(declarations('.rail .sectionHeader')?.get('justify-content')).toBe('flex-start')
    expect(declarations('.rail .iconButton')?.get('width')).toBe('36px')
    expect(declarations('.rail .search')?.get('width')).toBe('36px')
  })

  it('inks the resting mark of the selected Session row', () => {
    // Selection paints no row fill, so the leading circle is what says which
    // Session the pane is showing; it must not stay at its resting 0.
    expect(rowDeclarations('.idleMark')?.get('opacity')).toBe('0')
    expect(rowDeclarations('.sessionRow.selected .idleMark')?.get('opacity')).toBe('1')
  })

  it('reveals a row\'s actions on hover or focus, never on selection', () => {
    // The actions cell holds its room and only fades, so revealing it costs no
    // re-measure. Blank New Session rows render no cell at all.
    expect(rowDeclarations('.rowActions')?.get('opacity')).toBe('0')
    expect(rowDeclarations('.rowActions')?.get('pointer-events')).toBe('none')
    for (const row of ['.projectRow', '.sessionRow']) {
      for (const state of [':hover', '.menuOpen']) {
        const reveal = rowDeclarations(`${row}${state} .rowActions`)
        expect(reveal?.get('opacity')).toBe('1')
        expect(reveal?.get('pointer-events')).toBe('auto')
      }
    }
    // The focused action reveals its own cell: a keyboard reader must not land
    // on an invisible button.
    expect(rowDeclarations('.rowActions:focus-within')?.get('opacity')).toBe('1')
    expect(rowDeclarations('.rowActions:focus-within')?.get('pointer-events')).toBe('auto')
    // Selection inks the row's leading circle; it does not pin its actions.
    expect(rowDeclarations('.sessionRow.selected .rowActions')).toBeUndefined()
  })
})
