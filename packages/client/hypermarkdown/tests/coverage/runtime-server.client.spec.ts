// This file deliberately uses the node environment to cover the SSR adapters.
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { currentPath, onViewportScroll, watchStickyHeader } from '../../src/engine/runtime.ts'
import { portalFullscreen } from '../../src/engine/fullscreen-portal.tsx'
import MermaidDiagram from '../../src/engine/mermaid/index.tsx'
import '../../src/index.ts'

describe('runtime SSR adapters', () => {
  it('owns the stylesheet the engine renders with', () => {
    const entry = readFileSync(new URL('../../src/HyperMarkdown.tsx', import.meta.url), 'utf8')
    expect(entry).toContain("import './styles/hypermarkdown.css'")
  })

  it('returns inert browser integrations when there is no window', () => {
    expect(currentPath()).toBe('')
    const handler = vi.fn()
    const stop = onViewportScroll(handler)
    expect(() =>{  stop() }).not.toThrow()
    expect(handler).not.toHaveBeenCalled()
    const watch = watchStickyHeader(() => null, () => null, () => false)
    expect(() => {
      watch.update()
      watch.stop()
    }).not.toThrow()
  })

  it('renders diagrams without a DOM sandbox during SSR', () => {
    // Without a document the diagram has nowhere to lay out, so rendering it
    // to a string must still produce markup rather than reaching for one.
    const render = vi.fn(async () => ({ svg: '<svg/>' }))
    const diagram: any = { loaded: () => ({ render }), load: vi.fn() }

    expect(() =>
      renderToStaticMarkup(
        createElement(MermaidDiagram, { chart: 'graph', diagram }),
      ),
    ).not.toThrow()
  })

  it('leaves an expanded block where it stands when there is no body to lift it onto', () => {
    // A block is only expanded by a reader's click, so no server render carries
    // one; the lift still has to answer without a document rather than reach
    // for one.
    const tree = createElement('div', { className: 'codeblock-wrapper fullscreen' })

    expect(portalFullscreen(tree, 'codeblock-wrapper', 10)).toBe(tree)
  })

  it('loads in a fresh browser-like module realm', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {},
    })
    vi.resetModules()

    try {
      await import('../../src/index.ts')
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, 'window', descriptor)
      } else {
        delete (globalThis as any).window
      }
    }
  })
})
