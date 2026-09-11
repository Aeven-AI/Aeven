import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { visit } from 'unist-util-visit'

import type { Root as HastRoot } from 'hast'

import { remarkMathCompatibility } from '../remark/math-compatibility.ts'
import type { MathPlugin } from '../plugin-types.ts'

/**
 * Maths through KaTeX. Requires `katex`, `remark-math` and `rehype-katex`, and
 * KaTeX's own stylesheet — import `katex/dist/katex.min.css` yourself.
 *
 * @param options - Options forwarded verbatim to rehype-katex, such as
 *   `output` or `throwOnError`.
 * @returns The maths descriptor, which registers remark-math and the
 *   unit-glyph compatibility pass on the parse, and KaTeX on the rehype pass.
 */
export function katexPlugin(options: Record<string, unknown> = {}): MathPlugin {
  return {
    type: 'math',
    name: 'katex',
    remarkPluginsBefore: [remarkMathCompatibility],
    remarkPlugin: remarkMath,
    // The preset normalizes model-friendly unit glyphs before KaTeX sees the
    // math node, then performs the regular KaTeX render.
    rehypePlugin: {
      plugins: [rehypeKatexUnicodeUnits, [rehypeKatex, options]],
    },
  }
}

/**
 * KaTeX has no glyph metrics for the single-code-point Celsius symbol and
 * logs warnings even in non-strict mode. The equivalent `°C` has full metric
 * support and also remains valid inside `\text{...}`, where a TeX command
 * replacement such as `^\circ` would not parse.
 */
function rehypeKatexUnicodeUnits() {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node) => {
      const className = String(node.properties.className ?? '')

      if (!className.includes('math')) {
        return
      }

      visit(node, 'text', (text) => {
        text.value = text.value.replaceAll('℃', '°C')
      })
    })
  }
}

export default katexPlugin
