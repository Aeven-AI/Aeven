// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import MermaidDiagram from '../../../src/engine/mermaid/index.tsx'
import { clear } from '../../../src/engine/mermaid/cache.ts'
import type {
  DiagramEngine,
  DiagramPlugin,
  DiagramResult,
} from '../../../src/engine/plugin-types.ts'

let roots: ReturnType<typeof createRoot>[] = []
let observers: FakeIntersectionObserver[] = []

/**
 * Reports what the test asks it to: jsdom lays nothing out, so a real observer
 * would never report a diagram as having come into view.
 */
class FakeIntersectionObserver {
  readonly targets: Element[] = []

  constructor(readonly callback: IntersectionObserverCallback) {
    observers.push(this)
  }

  observe(target: Element): void {
    this.targets.push(target)
  }

  unobserve(target: Element): void {
    const at = this.targets.indexOf(target)
    if (at !== -1) this.targets.splice(at, 1)
  }

  disconnect(): void {
    this.targets.length = 0
  }
}

/** Bring every diagram waiting on the viewport into view. */
async function scrollIntoView(): Promise<void> {
  const waiting = observers.filter((observer) => {
    return observer.targets.some((target) => {
      return target.classList.contains('mermaid-wrapper')
    })
  })

  await act(async () => {
    waiting.forEach((observer) => {
      observer.callback(
        observer.targets.map((target) => {
          return { target, isIntersecting: true } as IntersectionObserverEntry
        }),
        observer as unknown as IntersectionObserver,
      )
    })
  })
}

/** A plugin whose engine is loaded already, recording what it is asked to draw. */
function loadedPlugin(): DiagramPlugin & { drawn: string[] } {
  const drawn: string[] = []
  const engine: DiagramEngine = {
    initialize() {},
    render(_id: string, source: string): Promise<DiagramResult> {
      drawn.push(source)
      return Promise.resolve({ svg: `<svg><text>${source}</text></svg>` })
    },
  }

  return {
    type: 'diagram',
    name: 'fake',
    language: 'mermaid',
    drawn,
    load: () => Promise.resolve(engine),
    loaded: () => engine,
  }
}

async function mount(chart: string, diagram: DiagramPlugin): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  const root = createRoot(host)

  roots.push(root)
  document.body.appendChild(host)
  await act(async () => {
    root.render(<MermaidDiagram chart={chart} diagram={diagram} />)
  })

  return host
}

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  clear()
  observers = []
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
})

afterEach(() => {
  roots.forEach((root) => {
    act(() => {
      root.unmount()
    })
  })
  roots = []
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  clear()
})

describe('drawing a diagram', () => {
  it('draws a source once, however many diagrams and mounts share it', async () => {
    const diagram = loadedPlugin()

    await mount('graph TD; A-->B', diagram)
    await mount('graph TD; A-->B', diagram)
    await mount('graph TD; B-->C', diagram)
    await scrollIntoView()

    // The repeated source reaches the engine once; the distinct one is its own.
    expect(diagram.drawn).toEqual(['graph TD; A-->B', 'graph TD; B-->C'])
  })

  it('waits for the diagram to come near the scrollport, covering the box until it does', async () => {
    const diagram = loadedPlugin()
    const host = await mount('graph TD; A-->B', diagram)

    // The cover is up from the first paint, so the box is never bare.
    expect(diagram.drawn).toEqual([])
    expect(host.querySelector('.mermaid-wrapper')?.className).not.toContain('drawn')

    await scrollIntoView()

    expect(diagram.drawn).toEqual(['graph TD; A-->B'])
    expect(host.querySelector('.mermaid-wrapper')?.className).toContain('drawn')
  })
})
