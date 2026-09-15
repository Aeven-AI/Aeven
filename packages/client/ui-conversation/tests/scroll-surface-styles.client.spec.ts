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

  it('reserves the scrollport gutter symmetrically so the seat centres on the box', () => {
    // The seat sits outside the scrollport and spans the box itself, so the
    // reservation it has to agree with is the symmetric one: an end-edge-only
    // gutter leaves the content column half a bar-width off the seat's centre on
    // every engine that still reserves a gutter — measured in chromium 151
    // against a classic 15px bar, 7.5px off with `stable` and 0 with
    // `both-edges` — where `both-edges` also reserves nothing once the bar
    // floats. The padding that used to give that width back is gone with the
    // fixed number it needed: the band is 0 on the engines that float the bar
    // and an engine value no sheet knows on the ones that do not.
    expect(declarationsFrom('.scrollBody')).toContain('scrollbar-gutter: stable both-edges')
    const seat = declarationsFrom(".root[data-phase='active'] .composerSeat")
    expect(seat.some(part => part.startsWith('padding-right:'))).toBe(false)
  })

  it('carries the transcript inset into the view chrome on both edges', () => {
    // `.viewChrome` spans the scrollport, and the controls it holds keep the
    // horizontal math they had inside it. That math is now symmetric: the
    // reserved gutter cannot pull the end edge in any further than the start
    // edge.
    expect(declarationsFrom('.viewChrome')).toContain('padding-left: var(--dsh-composer-side-clearance)')
    expect(declarationsFrom('.viewChrome')).toContain('padding-right: var(--dsh-composer-side-clearance)')
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

  it('fills the conversation column instead of the inner window', () => {
    // Absolute fill against `.body` is ConversationRoot's width and the full
    // page height of that column; a viewport-fixed layer would also cover the
    // sidebar. The seat stacks above the cover, so the input stays usable.
    const declarations = declarationsFrom('.contentLoader')
    expect(declarations).toContain('position: absolute')
    expect(declarations).toContain('inset: 0')
    expect(declarations).not.toContain('position: fixed')
  })
})
