// @vitest-environment jsdom
/**
 * A streaming diagram rewrites its source on every delta. The toolbar above it
 * draws nothing from that source — a fixed title, and controls that read the
 * current props when clicked — so it has to sit out the stream rather than
 * redraw itself once per chunk.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import MermaidHeader from '../../src/engine/mermaid/header.tsx'

let roots: Root[] = []
let hosts: HTMLDivElement[] = []

beforeAll(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  roots.forEach((root) =>{  act(() =>{  root.unmount() }) })
  roots = []
  hosts.forEach((host) =>{  host.remove() })
  hosts = []
})

function mount(element: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  hosts.push(host)
  roots.push(root)
  act(() =>{  root.render(element) })
  return { host, root }
}

/** The toolbar under test, with a render counter wrapped around its markup. */
function headerOf(chart: string, extra: Record<string, unknown> = {}) {
  return (
    <MermaidHeader
      chart={chart}
      fullscreen={false}
      wrapperRef={{ current: null }}
      toggleFullScreen={() => {}}
      {...extra}
    />
  )
}

describe('streaming diagram toolbar', () => {
  it('does not redraw while the diagram source grows', () => {
    const { host, root } = mount(headerOf('graph TD'))
    const before = host.querySelector('.mermaid-header')
    const beforeHtml = before?.innerHTML

    // Ten deltas of a diagram arriving, as a stream would deliver them.
    for (let i = 0; i < 10; i++) {
      act(() =>{  root.render(headerOf('graph TD' + '\n  a' + i + '-->b' + i)) })
    }

    const after = host.querySelector('.mermaid-header')
    // Same element instance and identical markup: nothing was rebuilt.
    expect(after).toBe(before)
    expect(after?.innerHTML).toBe(beforeHtml)
  })

  it('still redraws when its own inputs change', () => {
    const { host, root } = mount(headerOf('graph TD'))

    // A failed diagram drops both controls.
    act(() =>{  root.render(headerOf('graph TD', { failed: true })) })
    expect(host.querySelectorAll('.mermaid-header button')).toHaveLength(0)

    // And gets them back when a rewritten source starts over.
    act(() =>{  root.render(headerOf('graph TD', { failed: false })) })
    expect(host.querySelectorAll('.mermaid-header button').length).toBeGreaterThan(0)

    // Fullscreen swaps the icon and its label together.
    const beforeFullscreen = host.querySelector('.mermaid-header')?.innerHTML
    act(() =>{  root.render(headerOf('graph TD', { fullscreen: true })) })
    expect(host.querySelector('.mermaid-header')?.innerHTML).not.toBe(beforeFullscreen)
  })

  it('copies the source the stream has delivered so far', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    const { host, root } = mount(headerOf('graph TD'))
    // The toolbar sat out these updates; the copy control must still reach the
    // latest source rather than the one it last drew with.
    act(() =>{  root.render(headerOf('graph TD\n  a-->b')) })

    const copy = host.querySelector<HTMLButtonElement>('.mermaid-header button')
    expect(copy).not.toBeNull()
    await act(async () =>{  copy!.click() })

    expect(writeText).toHaveBeenCalledWith('graph TD\n  a-->b')
  })
})
