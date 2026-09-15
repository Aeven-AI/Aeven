// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import PanZoom from '../../src/engine/mermaid/pan-zoom.tsx'

let hosts: HTMLDivElement[] = []
let roots: ReturnType<typeof createRoot>[] = []

beforeAll(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  roots.forEach((root) => {
    act(() => {
      root.unmount()
    })
  })
  roots = []
  hosts.forEach((host) => {
    host.remove()
  })
  hosts = []
})

function wheel(target: Element, options: WheelEventInit): boolean {
  let result = true

  act(() => {
    result = target.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ...options,
    }))
  })

  return result
}

describe('Mermaid pan and zoom', () => {
  it('uses an ordinary wheel for zoom only in fullscreen', () => {
    const host = document.createElement('div')
    const root = createRoot(host)
    hosts.push(host)
    roots.push(root)
    document.body.appendChild(host)

    act(() => {
      root.render(<PanZoom enabled fullscreen={false} svg="<svg></svg>" />)
    })

    const panZoom = host.querySelector('.mermaid-pan-zoom')!
    const content = host.querySelector<HTMLElement>('.mermaid-pan-zoom-content')!

    expect(wheel(panZoom, { deltaY: 100 })).toBe(true)
    expect(content.style.transform).toBe('translate(0px, 0px) scale(1)')

    expect(wheel(panZoom, { ctrlKey: true, deltaY: -100 })).toBe(false)
    expect(content.style.transform).toBe('translate(0px, 0px) scale(1.1)')

    act(() => {
      root.render(<PanZoom enabled fullscreen svg="<svg></svg>" />)
    })

    // Fullscreen zooms on a pinch like anywhere else: an unmodified wheel is
    // left alone, so it scrolls the diagram rather than scaling it.
    expect(wheel(panZoom, { deltaY: 100 })).toBe(true)
    expect(content.style.transform).toBe('translate(0px, 0px) scale(1.1)')

    expect(wheel(panZoom, { ctrlKey: true, deltaY: -100 })).toBe(false)
    expect(content.style.transform).toBe('translate(0px, 0px) scale(1.2)')
  })
})
