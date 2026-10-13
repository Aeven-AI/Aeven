/**
 * Spinner geometry as CSS text. jsdom has no layout, so the wobble this guards
 * against cannot be reproduced in a render test: the wrapper is the rotating
 * box, and a surface that resizes the glyph from outside (`… svg {width:14px}`)
 * pulls the mark off the rotation axis. These read the declarations that keep
 * the mark on that axis whatever a consumer does to the glyph's size.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/Spinner.module.css', import.meta.url)), 'utf8')
/** Declaration text only: comments and the reduced-motion override do not declare geometry. */
const declarationText = css.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})+[^{}]*\}/g, ' ')

const rules = [...declarationText.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({
  selectors: match[1]!.split(',').map(selector => selector.trim()),
  declarations: match[2]!.split(';').map(part => part.trim()).filter(Boolean),
}))

/**
 * Read one selector's declarations across every rule that matches it, the way
 * the cascade applies them.
 * @param selector - the exact selector to find.
 * @returns its declared properties.
 */
function declarations(selector: string): string[] {
  const matching = rules.filter(candidate => candidate.selectors.includes(selector))
  if (matching.length === 0) throw new Error(`Spinner.module.css has no \`${selector}\` rule`)
  return matching.flatMap(rule => rule.declarations)
}

describe('Spinner.module.css rotation axis', () => {
  it('centres the mark in the box that rotates', () => {
    expect(declarations('.spinner')).toEqual(expect.arrayContaining([
      'display: flex',
      'align-items: center',
      'justify-content: center',
    ]))
  })

  it('sizes the rotating box and the mark inside it through one variable', () => {
    const size = 'var(--avn-spinner-size, var(--dsw-aeven-loading-mark-size, 18px))'
    for (const selector of ['.spinner', '.spinner svg']) {
      expect(declarations(selector)).toEqual(expect.arrayContaining([`width: ${size}`, `height: ${size}`]))
    }
  })

  it('stops rotating when the reader asks for reduced motion', () => {
    expect(css.replace(/\s+/g, ' ')).toContain('@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }')
  })
})
