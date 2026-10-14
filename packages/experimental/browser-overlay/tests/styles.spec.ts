import { describe, expect, it } from 'vitest'
import {
  ACCENT,
  BASE_ROTATION_DEG,
  CLASS_PREFIX,
  cls,
  CURSOR_BOX,
  CURSOR_GLOW_FILTER,
  CURSOR_NUDGE,
  CURSOR_SPRITE,
  overlayStyles,
} from '../src/styles.ts'

/** Every element class the overlay creates, in the order its own stylesheet declares them. */
const ELEMENT_CLASSES = [
  'cursor-layer',
  'cursor',
  'cursor-sprite',
  'box',
  'label',
  'ripple',
  'flash',
  'caret',
] as const

/** Quotes a selector so a class name cannot be matched as a prefix of a longer one. */
function classSelector(name: string): RegExp {
  return new RegExp(`\\.${cls(name)}(?![\\w-])`)
}

/** Rule selectors in the stylesheet: `{`-terminated lines that are neither at-rules nor keyframe stops. */
function selectorsOf(styles: string): string[] {
  return styles
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.endsWith('{'))
    .map(line => line.slice(0, -1).trim())
    .filter(selector => !selector.startsWith('@') && !/^[\d,]/.test(selector))
}

const styles = overlayStyles()

describe('class names', () => {
  it('namespaces every generated class under the shared prefix', () => {
    for (const name of ELEMENT_CLASSES) {
      expect(cls(name)).toBe(`${CLASS_PREFIX}-${name}`)
    }
  })

  it('gives every element a distinct class', () => {
    expect(new Set(ELEMENT_CLASSES.map(cls)).size).toBe(ELEMENT_CLASSES.length)
  })
})

describe('stylesheet', () => {
  it('scopes every rule under the overlay root', () => {
    const selectors = selectorsOf(styles)
    expect(selectors.length).toBeGreaterThan(ELEMENT_CLASSES.length)
    for (const selector of selectors) {
      expect(selector).toContain(`.${CLASS_PREFIX}`)
    }
  })

  it('declares a rule for every element the overlay creates', () => {
    const selectors = selectorsOf(styles)
    for (const name of ELEMENT_CLASSES) {
      expect(selectors.some(selector => classSelector(name).test(selector))).toBe(true)
    }
  })

  it('sizes the cursor box and pins the sprite against a page img rule', () => {
    const sprite = styles.slice(styles.indexOf(cls('cursor-sprite')))
    expect(styles).toContain(`width: ${CURSOR_BOX}px;`)
    expect(styles).toContain(`height: ${CURSOR_BOX}px;`)
    expect(sprite).toContain('max-width: none;')
    expect(sprite).toContain('max-height: none;')
    expect(sprite).toContain(`width: ${CURSOR_SPRITE.width}px !important;`)
    expect(sprite).toContain(`height: ${CURSOR_SPRITE.height}px !important;`)
  })

  it('nudges the sprite to the reference origin and rests it through the compensating rotation', () => {
    // Both numbers are the reference artwork's own: the sprite is placed at that
    // origin rather than centred by the half-difference of the two sizes.
    expect(CURSOR_NUDGE).toEqual({ x: 12, y: -2.5 })
    expect(CURSOR_SPRITE).toEqual({ width: 23, height: 24 })
    // The motion model rests at the base angle and the sprite rotates the other
    // way by the same amount, so the drawn arrow rests in the orientation it
    // should be seen in.
    expect(BASE_ROTATION_DEG).toBe(-44)
    const spriteRules = styles.slice(styles.indexOf(`.${cls('cursor-sprite')}`), styles.indexOf(`.${cls('box')}`))
    expect(spriteRules).toContain(`transform: translate3d(${CURSOR_NUDGE.x}px, ${CURSOR_NUDGE.y}px, 0);`)
    expect(spriteRules).toContain(`transform: rotate(${String(-BASE_ROTATION_DEG)}deg) scale(1);`)
    expect(spriteRules).toContain('transform-origin: 0 0;')
  })

  it('glows through two drop shadows a host can re-tint', () => {
    expect(CURSOR_GLOW_FILTER.match(/drop-shadow\(/g)).toHaveLength(2)
    expect(CURSOR_GLOW_FILTER).toContain(`var(--${CLASS_PREFIX}-glow, ${ACCENT})`)
  })

  it('rings a hover target in the accent and flattens a text selection', () => {
    const box = selectorsOf(styles).filter(selector => classSelector('box').test(selector))
    expect(box.length).toBeGreaterThan(1)
    for (const name of ['hover', 'region', 'text']) {
      expect(box.some(selector => selector.includes(`[data-kind="${name}"]`))).toBe(true)
    }
    expect(styles).toContain(`border: 2px solid ${ACCENT};`)
  })

  it('stops every animation when the page asks for reduced motion', () => {
    const reduced = styles.slice(styles.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).not.toBe('')
    for (const name of ['ripple', 'flash', 'caret']) {
      expect(reduced).toContain(`.${cls(name)}`)
    }
    expect(reduced).toContain('animation: none;')
  })

  it('draws no scroll glyph: the pointer travelling is the whole affordance', () => {
    expect(styles).not.toContain(cls('scroll'))
    expect(styles).not.toContain(`${CLASS_PREFIX}-scroll-`)
  })
})
