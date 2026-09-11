import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { katexPlugin } from '../../src/engine/plugins/math.ts'
import Renderer from '../../src/engine/renderer.tsx'

import type { RendererOptions } from '../../src/engine/types.ts'

// What a delta shows must not depend on where its boundaries happened to fall.
// The same buffer, delivered whole or a character at a time, has to reach the
// same rendered state.
function streamed(source: string, size: number, options: RendererOptions = {}) {
  const renderer = new Renderer({ streaming: true, animation: false, ...options })

  for (let index = 0; index < source.length; index += size) {
    renderer.streamMd(source.slice(index, index + size), true, false, false)
  }

  return renderToStaticMarkup(renderer.render())
}

const asText = (markup: string) =>
  markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

describe('chunking does not change what a delta shows', () => {
  const cases: Array<[string, string, RendererOptions]> = [
    ['closed blocks then an open fence', 'intro\n\n```\nfirst\n```\n\n```ts\nopen', {}],
    ['closed blocks then an open math fence', 'intro\n\n```\nfirst\n```\n\n```math\n\\sqrt{2}', { plugins: { math: katexPlugin() } }],
    ['closed blocks then an open paragraph', 'intro\n\n```\nfirst\n```\n\ntrailing prose', {}],
  ]

  for (const [name, source, options] of cases) {
    it(name, () => {
      const whole = asText(streamed(source, source.length, options))

      for (const size of [1, 3, 7, 40]) {
        expect(asText(streamed(source, size, options))).toBe(whole)
      }
    })
  }

  it("keeps an indented code block's chrome however the delta is cut", () => {
    const source = 'Intro line:\n\n    def indented():\n        pass\n\nAfter.\n\nend'

    for (const size of [1, 5, 13, source.length]) {
      expect(streamed(source, size)).toContain('codeblock-wrapper')
    }
  })
})
