// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import MermaidDiagram from '../../../src/engine/mermaid/index.tsx'
import { clear, render, watchScroll } from '../../../src/engine/mermaid/cache.ts'
import type {
  DiagramEngine,
  DiagramPlugin,
  DiagramResult,
} from '../../../src/engine/plugin-types.ts'

let roots: ReturnType<typeof createRoot>[] = []
let observers: FakeIntersectionObserver[] = []
let idle: Array<() => void> = []

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

/**
 * Run every layout the cache queued for an idle moment, until it stops asking.
 * The cache lays a diagram out in a later browser task, and jsdom never goes
 * idle on its own, so the drawing is not on screen until these run.
 */
async function runLayouts(): Promise<void> {
  do {
    const pending = idle.splice(0)

    await act(async () => {
      pending.forEach((callback) => {
        callback()
      })
    })
  } while (idle.length > 0)
}

/** Bring every diagram waiting on the viewport into view, and draw it. */
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

  await runLayouts()
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
  idle = []
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  // jsdom never becomes idle; the cache draws a queued diagram once it does.
  vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
    idle.push(callback)

    return idle.length
  })
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
  vi.useRealTimers()
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

/**
 * The queue is the module's own work: one layout per source, started in an idle
 * moment and held back while the reader is moving the port. A component cannot
 * report either moment, so these drive the queue directly.
 */
describe('the layout queue', () => {
  it('hands a finished drawing to a consumer that arrives later', async () => {
    const diagram = loadedPlugin()
    const first = render('graph TD; A-->B', diagram, () => 0)

    await runLayouts()
    const data = await first
    expect(data?.svg).toContain('A-->B')

    // The source is already drawn, so the later consumer joins that entry
    // instead of queueing the engine a second time.
    const later = render('graph TD; A-->B', diagram, () => 0)
    await runLayouts()
    expect(await later).toBe(data)
    expect(diagram.drawn).toEqual(['graph TD; A-->B'])
  })

  it('holds a layout back while the port scrolls, and draws once it is still', async () => {
    vi.useFakeTimers()
    const port = document.createElement('div')
    document.body.appendChild(port)
    watchScroll(port)

    const diagram = loadedPlugin()
    const queued = render('graph TD; A-->B', diagram, () => 0)

    // A fling through the transcript: layouts wait for the port to settle
    // rather than starting on the frames the reader is scrolling.
    await act(() => port.dispatchEvent(new Event('scroll')))
    await act(() => port.dispatchEvent(new Event('scroll')))
    await runLayouts()
    expect(diagram.drawn).toEqual([])

    await act(() => vi.advanceTimersByTime(120))
    await runLayouts()
    expect(diagram.drawn).toEqual(['graph TD; A-->B'])
    await expect(queued).resolves.toEqual({ svg: '<svg><text>graph TD; A-->B</text></svg>' })
  })
})
