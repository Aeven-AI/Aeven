/**
 * Scrollport declarations that jsdom cannot exercise: it has no layout and no
 * elastic overscroll, so the rules that keep the input card still under a
 * rubber-band are asserted as CSS text instead. The structural half of that
 * contract — the seat is not inside the scrollport — lives in skeleton specs.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  fileURLToPath(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url)),
  'utf8',
)

function declarationsFrom(selector: string): string[] {
  const declarationText = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const rule = new RegExp(`(?:^|[{}])\\s*${selector.replace(/[.[\]():*+^$\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(declarationText)
  if (rule === null) throw new Error(`no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('conversation composer seat styles', () => {
  it('docks the seat by flex order instead of sticking it inside the scrollport', () => {
    // Sticky positioning is what made the card ride the overscroll: a sticky
    // box still moves with the contents its scroller translates.
    const declarations = declarationsFrom(".root[data-phase='active'] .composerSeat")
    expect(declarations).toContain('flex: none')
    expect(declarations).not.toContain('position: sticky')
    expect(declarations).not.toContain('bottom: 0')
  })

  it('reserves the scrollport gutter on the seat so both centre on one axis', () => {
    // `.scrollBody` keeps `scrollbar-gutter: stable`, so its content column
    // centres inside a narrower box; the seat is outside that box now and has
    // to give back the same width or the card sits half a bar-width right.
    expect(declarationsFrom('.scrollBody')).toContain('scrollbar-gutter: stable')
    expect(declarationsFrom(".root[data-phase='active'] .composerSeat"))
      .toContain('padding-right: var(--dsh-scrollbar-width)')
  })
})

describe('conversation content cover styles', () => {
  /** The numeric `z-index` of a rule, as an integer. */
  function stackLevel(selector: string): number {
    const declaration = declarationsFrom(selector).find(part => part.startsWith('z-index:'))
    if (declaration === undefined) throw new Error(`no \`z-index\` on \`${selector}\``)
    return Number(declaration.slice('z-index:'.length).trim())
  }

  it('keeps the cover behind the composer seat', () => {
    // The seat stays mounted across a Session switch, so a cover that outranks
    // it paints the resident input card out and back in and the switch reads
    // as a remount.
    expect(stackLevel('.contentLoader'))
      .toBeLessThan(stackLevel(".root[data-phase='active'] .composerSeat"))
  })

  it('covers the whole scrollport group with one level', () => {
    // `.scrollArea` is a stacking context, so outranking it clears the
    // transcript, the CodeBlock sticky banners inside it, and the view chrome
    // at once — no per-element z-index race, and nothing in the group can tie.
    expect(stackLevel('.contentLoader')).toBeGreaterThan(stackLevel('.scrollArea'))
    expect(stackLevel('.viewChrome')).toBeGreaterThan(stackLevel('.scrollArea'))
  })

  it('spans the full column instead of stopping at the composer', () => {
    // Bounding the cover to the scrollport would shrink it to the band above
    // the input; it stays full-height and passes behind the seat instead.
    const declarations = declarationsFrom('.contentLoader')
    expect(declarations).toContain('position: fixed')
    expect(declarations).toContain('top: 0')
    expect(declarations).toContain('bottom: 0')
  })
})
