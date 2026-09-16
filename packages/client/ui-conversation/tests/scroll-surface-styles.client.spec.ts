/**
 * Scrollport declarations that jsdom cannot exercise: it has no layout and no
 * elastic overscroll, so the rules that decide how the column scrolls and which
 * layer paints over which are asserted as CSS text instead. The structural half
 * of that contract — one scroller holding the header, the transcript, and the
 * composer seat — lives in skeleton specs.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  fileURLToPath(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url)),
  'utf8',
)

/** The active phase's seat rule; the sheet spells attribute values in double quotes. */
const ACTIVE_SEAT = '.root[data-phase="active"] .composerSeat'

function declarationsFrom(selector: string): string[] {
  const declarationText = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const rule = new RegExp(`(?:^|[{}])\\s*${selector.replace(/[.[\]():*+^$\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(declarationText)
  if (rule === null) throw new Error(`no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

/** Whether one rule takes a stacking level of its own. */
function takesLevel(selector: string): boolean {
  return declarationsFrom(selector).some(part => part.startsWith('z-index:'))
}

describe('conversation composer seat styles', () => {
  it('sticks the seat to the floor of the column\'s one scroller', () => {
    // The seat is a child of the scroller now, laid out in the same content box
    // as the transcript and the header: a scrollbar shortens all three by the
    // same width, and the wheel over the footer moves the flow for free because
    // the footer is part of the scrolling surface. `.composerSeat` keeps
    // `flex: none` for the two phases that lay the seat out in a flex column —
    // the hero's centring box and a view's composer overlay.
    expect(declarationsFrom(ACTIVE_SEAT)).toContain('position: sticky')
    expect(declarationsFrom(ACTIVE_SEAT)).toContain('bottom: 0')
    expect(declarationsFrom('.composerSeat')).toContain('flex: none')
  })

  it('reserves no scrollport gutter, because the seat rides the transcript\'s content box', () => {
    // The reservation this box used to carry needed `scrollbar-gutter`, which no
    // Safari release implements and the iOS 14.5 baseline bans: the declaration
    // is dropped whole, so the axis it was holding is left to whatever the bar
    // does ([gate](../../../../scripts/verify-css-baseline.ts)). One scroller
    // holding the header, the transcript, and the seat needs no reservation — a
    // bar that takes width shortens all three identically — and the seat has no
    // band to give back either.
    const body = declarationsFrom('.scrollBody')
    expect(body.some(part => part.startsWith('scrollbar-gutter:'))).toBe(false)
    expect(body).toContain('overflow-y: scroll')
    expect(declarationsFrom(ACTIVE_SEAT).some(part => part.startsWith('padding-right:'))).toBe(false)
  })

  it('carries the transcript inset into the view chrome on both edges', () => {
    // `.viewChrome` spans the column against `.root`, outside the scroller, and
    // the controls it holds keep the horizontal math they had inside it. That
    // math is symmetric, and so is the scroller's content box: no reserved
    // gutter can pull one edge in further than the other.
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
    expect(stackLevel('.contentLoader')).toBeLessThan(stackLevel(ACTIVE_SEAT))
  })

  it('clears the transcript from one level, with nothing else in the scroller taking one', () => {
    // The scroller holds the seat as well as the transcript, so it cannot be a
    // stacking context of its own: a level there caps the resident seat and
    // paints the cover over the input card, which is the remount the seat's own
    // rule exists to prevent. Nothing else the scroller holds takes a level
    // either, so the cover's single number decides it against the transcript's
    // rows, while the two layers that must stay visible — the header and the
    // chrome layers — keep higher ones.
    expect(takesLevel('.scrollBody')).toBe(false)
    expect(takesLevel('.transcriptHold')).toBe(false)
    expect(stackLevel('.contentLoader')).toBeLessThan(stackLevel('.header'))
    expect(stackLevel('.contentLoader')).toBeLessThan(stackLevel('.viewChrome'))
  })

  it('fills the conversation column instead of the inner window', () => {
    // Absolute fill against `.root` is ConversationRoot's width and the full
    // page height of that column; a viewport-fixed layer would also cover the
    // sidebar. The seat stacks above the cover, so the input stays usable.
    const declarations = declarationsFrom('.contentLoader')
    expect(declarations).toContain('position: absolute')
    expect(declarations).toContain('inset: 0')
    expect(declarations).not.toContain('position: fixed')
  })
})
