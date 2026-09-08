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
