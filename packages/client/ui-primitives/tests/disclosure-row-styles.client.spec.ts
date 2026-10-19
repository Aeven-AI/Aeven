/**
 * DisclosureRow's font-size-axis adoption as CSS text. jsdom has no layout,
 * so these read the declarations that make every flow row (tool calls, think,
 * commands) follow the Settings font-size preference: title size on the axis
 * variable, row/leading geometry on the shared px delta, and the leading
 * glyph override that scales registered icons while exempting StateDot.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/DisclosureRow.module.css', import.meta.url)), 'utf8')
const declarationText = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

/**
 * The declarations of the rule whose selector list names `selector`, whether it
 * heads the rule or shares it with a sibling selector.
 * @param selector - one selector of the rule under test.
 * @returns the rule's declarations, in source order.
 */
function declarations(selector: string): string[] {
  const rule = [...declarationText.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, selectors]) =>
    (selectors ?? '').split(',').map(part => part.trim()).includes(selector))
  if (rule === undefined) throw new Error(`DisclosureRow.module.css has no \`${selector}\` rule`)
  return (rule[2] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('DisclosureRow.module.css font-size axis', () => {
  it('sizes the title from the primary content tier on the shared row line', () => {
    // Flow-row titles read at the same size as the conversation body: a tool
    // call or think step is content the reader follows, not chrome, so the
    // secondary tier left it a step smaller than the prose around it.
    expect(declarations('.title')).toEqual(expect.arrayContaining([
      'font-size: 1rem',
      'line-height: 1.75rem',
    ]))
  })

  it('moves the row height and leading box by the same delta', () => {
    expect(declarations('.row')).toEqual(expect.arrayContaining([
      'height: 1.5rem',
    ]))
    expect(declarations('.leading')).toEqual(expect.arrayContaining([
      'width: 1rem',
      'height: 1rem',
    ]))
  })

  it('scales leading glyphs via the svg edge but exempts StateDot', () => {
    // StateDot marks itself with data-state; the :not filter keeps the status
    // mark at its fixed figma size while text-furniture icons follow the text.
    // The glyph edge is claimed on the leading box's direct children — a bare
    // registered icon and the idle wrapper that swaps for the hover chevron.
    for (const selector of ['.leading > svg:not([data-state])', '.leading > .iconIdle svg:not([data-state])']) {
      expect(declarations(selector), selector).toEqual(expect.arrayContaining([
        'width: 0.875rem',
        'height: 0.875rem',
      ]))
    }
  })
})
