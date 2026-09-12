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
