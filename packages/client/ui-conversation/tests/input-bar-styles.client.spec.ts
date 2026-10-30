/**
 * The composer card's no-workspace trigger state as CSS text. jsdom paints no
 * pseudo-elements, so the decorative half of that contract is asserted against
 * the stylesheet: the card is a pick-a-workspace target (clickable, cursor) but
 * wears no stroke of its own.
 *
 * A dashed ring lived here until it read as an input artifact rather than an
 * affordance: it drew a dotted outline around an empty composer in exactly the
 * state a reader reaches by archiving their last Session, where no workspace
 * picker had been asked for.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  fileURLToPath(new URL('../src/client/input/InputBar.module.css', import.meta.url)),
  'utf8',
)
const declarationText = source.replace(/\/\*[\s\S]*?\*\//g, ' ')

/** Every rule whose selector mentions the no-workspace trigger state. */
const triggerRules = [...declarationText.matchAll(/([^{}]*cardWorkspaceTrigger[^{}]*)\{([^{}]*)\}/g)]
  .map(match => ({ selector: (match[1] ?? '').trim(), body: match[2] ?? '' }))

describe('composer card no-workspace trigger styles', () => {
  it('stays flat: no ring pseudo-element over the card', () => {
    // The ring was an ::after overlay on the card, at rest and on hover; either
    // rule surviving would paint the dotted outline this state must not have.
    expect(triggerRules.map(rule => rule.selector)).toEqual(['.cardWorkspaceTrigger', '.cardWorkspaceTrigger :disabled'])
    expect(declarationText).not.toContain('dasharray')
  })

  it('keeps the whole capsule clickable and the toolbar inert', () => {
    const trigger = triggerRules.find(rule => rule.selector === '.cardWorkspaceTrigger')
    expect(trigger?.body).toContain('cursor: pointer')
    // Disabled controls fall through to the card's own click handler, so the
    // pick target stays the full capsule rather than the controls' islands.
    const disabled = triggerRules.find(rule => rule.selector === '.cardWorkspaceTrigger :disabled')
    expect(disabled?.body).toContain('pointer-events: none')
  })
})

/** Declarations of one exact selector, comments already stripped. */
function bodyOf(selector: string): string {
  const rule = [...declarationText.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .find(match => (match[1] ?? '').trim() === selector)
  return rule?.[2] ?? ''
}

describe('composer control row spacing', () => {
  it('packs both clusters flush and keeps the 8px on the outer controls', () => {
    // The leading cluster (attach, options, mode chips) and the trailing one
    // (model, activity, send) pack their icons together; the attach circle
    // carries the 8px after it and the send circle the 8px before it, so the
    // glyph clusters read 8px away from the control that brackets them.
    expect(bodyOf('.tools')).toContain('gap: 0')
    expect(bodyOf('.trailing')).toContain('gap: 0')
    expect(bodyOf('.add')).toContain('margin-right: 8px')
    expect(bodyOf('.primary')).toContain('margin-left: 8px')
  })
})
