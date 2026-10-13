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

function declarations(selector: string): string[] {
  const rule = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]():*+^$\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(declarationText)
  if (rule === null) throw new Error(`DisclosureRow.module.css has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('DisclosureRow.module.css font-size axis', () => {
  it('sizes the title from the primary content tier on the shared row line', () => {
    // Flow-row titles read at the same size as the conversation body: a tool
    // call or think step is content the reader follows, not chrome, so the
    // secondary tier left it a step smaller than the prose around it.
    expect(declarations('.title')).toEqual(expect.arrayContaining([
      'font-size: var(--avn-content-font-size, 16px)',
      'line-height: calc(28px + var(--avn-content-font-delta, 0px))',
    ]))
  })

  it('moves the row height and leading box by the same delta', () => {
    expect(declarations('.row')).toEqual(expect.arrayContaining([
      'height: calc(24px + var(--avn-content-font-delta, 0px))',
    ]))
    expect(declarations('.leading')).toEqual(expect.arrayContaining([
      'width: calc(16px + var(--avn-content-font-delta, 0px))',
      'height: calc(16px + var(--avn-content-font-delta, 0px))',
    ]))
  })

  it('scales leading glyphs via the svg edge but exempts StateDot', () => {
    // StateDot marks itself with data-state; the :not filter keeps the status
    // mark at its fixed figma size while text-furniture icons follow the text.
    expect(declarations('.leading svg:not([data-state])')).toEqual(expect.arrayContaining([
      'width: calc(14px + var(--avn-content-font-delta, 0px))',
      'height: calc(14px + var(--avn-content-font-delta, 0px))',
    ]))
  })
})
