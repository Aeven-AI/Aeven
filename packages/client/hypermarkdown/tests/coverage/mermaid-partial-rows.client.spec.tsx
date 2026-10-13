// @vitest-environment jsdom
import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import MermaidDiagram from '../../src/engine/mermaid/index.tsx'
import { clear } from '../../src/engine/mermaid/cache.ts'

let frames: FrameRequestCallback[] = []
let idle: Array<() => void> = []

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  }) as any
})

afterEach(() => {
  document.body.replaceChildren()
  frames = []
  idle = []
  vi.unstubAllGlobals()
  // Rendered diagrams outlive the components that drew them, so a case that
  // counts what reaches the engine starts from an empty cache.
  clear()
})

beforeEach(() => {
  // jsdom never becomes idle; the cache draws a queued diagram once it does.
  vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
    idle.push(callback)

    return idle.length
  })
})

/**
 * Let the cache draw what it queued. It lays a diagram out in a later browser
 * task, and jsdom never goes idle on its own, so a drawing reaches the engine
 * only once these run — the frames a fence is held back on queue nothing.
 */
async function runLayouts() {
  do {
    const pending = idle.splice(0)

    await act(async () => {
      pending.forEach((callback) =>{  callback() })
    })
  } while (idle.length > 0)
}

function flushFrames() {
  const pending = frames
  frames = []
  pending.forEach((frame) =>{  act(() =>{  frame(0) }) })
}

function mount(ui: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() =>{  root.render(ui) })
  flushFrames()
  return { host, root }
}

function fakePlugin() {
  const render = vi.fn(async (_id: string, chart: string) => ({
    svg: `<svg><text>${chart}</text></svg>`,
  }))

  return {
    render,
    plugin: {
      type: 'diagram',
      name: 'fake',
      language: 'mermaid',
      loaded: () => ({ initialize: vi.fn(), render }),
      load: vi.fn(),
    } as any,
  }
}

const header = 'gantt\n    dateFormat  YYYY-MM-DD\n    section Section'

describe('a diagram whose rows are still arriving', () => {
  it('never hands the engine a gantt it would draw out of shape', async () => {
    const { render, plugin } = fakePlugin()

    // The fence as it streams: a header, then a task arriving character by
    // character. Only the frame with a placeable task reaches the engine.
    const { root, host } = mount(
      <MermaidDiagram chart={header} diagram={plugin} />,
    )
    await runLayouts()
    expect(render).not.toHaveBeenCalled()

    act(() =>{
      root.render(
        <MermaidDiagram chart={`${header}\n  A task :2024-01-01`} diagram={plugin} />,
      ) },
    )
    await runLayouts()
    expect(render).not.toHaveBeenCalled()

    act(() =>{
      root.render(
        <MermaidDiagram
          chart={`${header}\n  A task :2024-01-01, 30d`}
          diagram={plugin}
        />,
      ) },
    )
    await runLayouts()
    expect(render).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.mermaid-svg svg')?.textContent).toContain('30d')
  })

  it('keeps the drawn diagram while a further row is typed', async () => {
    const { render, plugin } = fakePlugin()
    const drawn = `${header}\n  A task :2024-01-01, 30d`

    const { root, host } = mount(
      <MermaidDiagram chart={drawn} diagram={plugin} />,
    )
    await runLayouts()
    expect(render).toHaveBeenCalledTimes(1)

    // A second task lands half-written. The engine is not asked again, and the
    // diagram already on screen stays.
    act(() =>{
      root.render(
        <MermaidDiagram chart={`${drawn}\n  Next :2024-02-01`} diagram={plugin} />,
      ) },
    )
    await runLayouts()
    expect(render).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.mermaid-svg svg')?.textContent).toContain('30d')
  })

  it('holds a pie back until a slice has its number', async () => {
    const { render, plugin } = fakePlugin()

    const { root } = mount(
      <MermaidDiagram chart={'pie title Pets\n    "Dogs" :'} diagram={plugin} />,
    )
    await runLayouts()
    expect(render).not.toHaveBeenCalled()

    act(() =>{
      root.render(
        <MermaidDiagram
          chart={'pie title Pets\n    "Dogs" : 386'}
          diagram={plugin}
        />,
      ) },
    )
    await runLayouts()
    expect(render).toHaveBeenCalledTimes(1)
  })
})
