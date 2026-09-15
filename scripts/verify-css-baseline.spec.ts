import { describe, expect, it } from 'vitest'
import { findBaselineViolations, governedStylesheets } from './verify-css-baseline.ts'

function ids(source: string): string[] {
  return findBaselineViolations('packages/client/ui-example/src/View.module.css', source).map(v => v.id)
}

describe('CSS baseline check', () => {
  it('rejects the value-level features the floor cannot render', () => {
    expect(ids(`
      .a { background: color-mix(in srgb, var(--tok) 70%, transparent); }
      .b { accent-color: red; }
      .c { scrollbar-color: red transparent; }
      .d { scrollbar-gutter: stable both-edges; }
      .e { max-height: calc(100dvh - 48px); }
    `)).toEqual(['color-mix', 'accent-color', 'scrollbar-color', 'scrollbar-gutter', 'viewport-unit-dvh'])
  })

  it('rejects the selector and at-rule features no build step can lower', () => {
    expect(ids(`
      .a:has(.b) { display: none; }
      @container (max-width: 460px) { .c { display: none; } }
      .d { container-type: inline-size; }
      @property --tok { syntax: '<length>'; inherits: true; initial-value: 0px; }
    `)).toEqual(['has-selector', 'container-query', 'container-type', 'property-registration'])
  })

  it('rejects nested selectors, which the floor parses as an unknown declaration', () => {
    expect(ids(`
      .card {
        font-size: 14px;
        &:hover { font-size: 16px; }
      }
    `)).toEqual(['css-nesting'])
  })

  it('accepts the supported spellings those features are converted to', () => {
    expect(ids(`
      .a { background: rgba(255, 255, 255, 0.7); }
      .b { max-height: calc(100vh - 48px); max-height: calc(100dvh - 48px); }
      .c[data-shown='6'] > .d { display: block; }
      @media (max-width: 460px) { .e { display: none; } }
      .f { scrollbar-width: none; }
      .g::-webkit-scrollbar-thumb { background: #888; }
      .h { display: flex; gap: 8px; }
      .i { backdrop-filter: blur(4px); }
    `)).toEqual([])
  })

  it('reports each occurrence with the line that carries it', () => {
    const violations = findBaselineViolations('a.css', '.a {\n  color: red;\n}\n.b:has(.c) { color: blue; }\n')
    expect(violations).toHaveLength(1)
    expect(violations[0]?.line).toBe(4)
  })

  it('governs the client stylesheets and excludes vendored sheets', () => {
    const sheets = governedStylesheets()
    expect(sheets.length).toBeGreaterThan(120)
    expect(sheets.every(sheet => !sheet.includes('/vendor/'))).toBe(true)
    expect(sheets.some(sheet => sheet.startsWith('packages/client/'))).toBe(true)
  })
})
