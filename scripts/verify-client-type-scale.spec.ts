import { describe, expect, it } from 'vitest'
import { findTypeScaleViolations } from './verify-client-type-scale.ts'

const FILE = 'packages/client/ui-example/src/client/View.module.css'

function texts(css: string): string[] {
  return findTypeScaleViolations(FILE, css).map(violation => violation.text)
}

describe('Client type-scale check', () => {
  it('rejects pixel font sizes, line heights and font shorthands', () => {
    expect(texts(`
      .a { font-size: 14px; }
      .b { line-height: 22px; }
      .c { font: 400 14px/22px var(--dsw-font-family); }
      .d {
        font-size: 12px;
      }
    `)).toEqual([
      'font-size: 14px',
      'line-height: 22px',
      'font: 400 14px/22px var(--dsw-font-family)',
      'font-size: 12px',
    ])
  })

  it('rejects a font token that carries pixels', () => {
    expect(texts(`
      body {
        --dsw-font-markdown-base: 400 16px/28px var(--dsw-font-family);
        --dsw-font-markdown-h1-font-size: 34px;
      }
    `)).toEqual([
      '--dsw-font-markdown-base: 400 16px/28px var(--dsw-font-family)',
      '--dsw-font-markdown-h1-font-size: 34px',
    ])
  })

  it('rejects type carried in custom properties, under any type name', () => {
    expect(texts(`
      .row {
        --dsl-terminal-line-height: 22px;
        --dsl-code-block-banner-font: 400 11px/18px var(--dsw-font-family);
        --hm-code-size: 12px;
        --avn-control-size: 36px;
      }
    `)).toEqual([
      '--dsl-terminal-line-height: 22px',
      '--dsl-code-block-banner-font: 400 11px/18px var(--dsw-font-family)',
    ])
  })

  it('admits rem, em, and zero, and leaves spacing in pixels', () => {
    expect(texts(`
      .a { font-size: 0.875rem; line-height: 1.375rem; }
      .b { font-size: 1em; font-size: 0; }
      .c { padding: 16px 0; gap: 8px; border-radius: 12px; width: 40px; }
      .d { box-shadow: 0 2px 4px rgb(0 0 0 / 5%); }
    `)).toEqual([])
  })

  it('admits a media query condition, which states a viewport width', () => {
    expect(texts(`
      @media (max-width: 480px) {
        .a { font-size: 0.875rem; }
      }
    `)).toEqual([])
  })

  it('admits a line that states its exception and its reason', () => {
    expect(texts(`
      .a { font-size: 14px; } /* type-scale-allow: fixed by a third-party embed */
      .b { font-size: 12px; }
    `)).toEqual(['font-size: 12px'])
  })

  it('reports the line the declaration is on', () => {
    const violations = findTypeScaleViolations(FILE, '\n\n.x {\n  font-size: 13px;\n}')
    expect(violations.map(violation => violation.line)).toEqual([4])
    expect(violations[0]?.file).toBe(FILE)
  })
})
