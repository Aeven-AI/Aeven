// @vitest-environment jsdom
//
// What a diagram does between mounting and unmounting: which source it draws,
// which one it takes from the cache, and how a failure is reported. jsdom
// supplies neither an intersection report nor an idle moment, so the two
// browser integrations the component waits on are driven from here.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import MermaidDiagram from '../../src/engine/mermaid/index.tsx'
import { clear } from '../../src/engine/mermaid/cache.ts'
import type {
  DiagramEngine,
  DiagramPlugin,
  DiagramResult,
} from '../../src/engine/plugin-types.ts'

let roots: ReturnType<typeof createRoot>[] = []
let observers: FakeIntersectionObserver[] = []
let idle: Array<() => void> = []

/** Reports what the test asks it to: jsdom lays nothing out. */
class FakeIntersectionObserver {
  readonly targets: Element[] = []
  readonly root: Element | null

  constructor(
    readonly callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.root = (options?.root as Element | null | undefined) ?? null
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

/** Report every observed diagram as intersecting, or as out of range. */
async function report(intersecting: boolean): Promise<void> {
  const watching = observers.filter((observer) => {
    return observer.targets.some((target) => {
      return target.classList.contains('mermaid-wrapper')
    })
  })

  await act(async () => {
    watching.forEach((observer) => {
      observer.callback(
        observer.targets.map((target) => {
          return { target, isIntersecting: intersecting } as IntersectionObserverEntry
        }),
        observer as unknown as IntersectionObserver,
      )
    })
  })
}

/** Run the layouts the cache queued, until it stops asking for an idle moment. */
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

async function mount(
  chart: string,
  diagram: DiagramPlugin,
  parent: Element = document.body,
) {
  const host = document.createElement('div')
  parent.appendChild(host)
  const root = createRoot(host)

  roots.push(root)
  await act(async () => {
    root.render(<MermaidDiagram chart={chart} diagram={diagram} />)
  })

  return { host, root }
}

function wrapper(host: HTMLElement): HTMLElement {
  const found = host.querySelector<HTMLElement>('.mermaid-wrapper')

  if (!found) throw new Error('the diagram mounted without its wrapper')

  return found
}

/** A plugin whose engine is loaded, recording the sources it is asked to draw. */
function loadedPlugin() {
  const drawn: string[] = []
  const engine: DiagramEngine = {
    initialize() {},
    render(_id: string, source: string): Promise<DiagramResult> {
      drawn.push(source)

      return Promise.resolve({ svg: `<svg><text>${source}</text></svg>` })
    },
  }

  const plugin: DiagramPlugin = {
    type: 'diagram',
    name: 'fake',
    language: 'mermaid',
    load: () => Promise.resolve(engine),
    loaded: () => engine,
  }

  return { plugin, drawn }
}

/** A promise the test settles when it wants the engine to answer. */
function deferred<T>() {
  let settle!: (value: T) => void
  let fail!: (reason: Error) => void
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve
    fail = reject
  })

  return { promise, settle, fail }
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
  clear()
})

describe('drawing what the reader can see', () => {
  it('mounts straight onto a drawing another block already made', async () => {
    const { plugin, drawn } = loadedPlugin()

    await mount('graph TD', plugin)
    await report(true)
    await runLayouts()
    expect(drawn).toEqual(['graph TD'])

    // The finished drawing is shared, so the second block paints it from the
    // first frame rather than waiting for a report of its own.
    const second = await mount('graph TD', plugin)
    expect(wrapper(second.host).className).toContain('drawn')
    expect(drawn).toEqual(['graph TD'])
  })

  it('holds the cover until the observer reports the box near the scrollport', async () => {
    const { plugin, drawn } = loadedPlugin()
    const { host } = await mount('graph TD', plugin)

    // A report that the box is still out of range leaves it undrawn.
    await report(false)
    await runLayouts()
    expect(drawn).toEqual([])
    expect(wrapper(host).className).not.toContain('drawn')

    await report(true)
    await runLayouts()
    expect(drawn).toEqual(['graph TD'])
    expect(wrapper(host).className).toContain('drawn')
  })

  it('measures the preload range against the nearest scrollable ancestor', async () => {
    const { plugin } = loadedPlugin()
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    document.body.appendChild(scroller)

    await mount('graph TD', plugin, scroller)

    // A long transcript scrolls inside its own box; measuring against the
    // window would preload what is still far below the reader.
    expect(observers.map(observer => observer.root)).toEqual([
      scroller,
      scroller,
    ])
  })

  it('adopts a drawing that is already cached when the source changes', async () => {
    const { plugin, drawn } = loadedPlugin()

    await mount('graph TD', plugin)
    await report(true)
    await runLayouts()

    // This block starts on an undrawn source and is handed the drawn one
    // before either layout runs, so the switch is served from the cache.
    const second = await mount('graph LR', plugin)
    await report(true)
    await act(async () => {
      second.root.render(<MermaidDiagram chart="graph TD" diagram={plugin} />)
    })

    expect(wrapper(second.host).className).toContain('drawn')
    await runLayouts()
    expect(drawn).toEqual(['graph TD'])
  })

  it('drops a request whose box left the preload range before its layout ran', async () => {
    const { plugin, drawn } = loadedPlugin()
    const { host } = await mount('graph TD', plugin)
    const box = wrapper(host)

    await report(true)
    // The reader scrolled far past the box while the layout waited its turn.
    Object.defineProperty(box, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 5000, bottom: 5100 }),
    })
    await runLayouts()

    expect(drawn).toEqual([])
    expect(box.className).not.toContain('drawn')
  })
})

describe('reporting a failure', () => {
  it('drops the cover when the engine cannot be imported', async () => {
    const load = vi.fn(() => Promise.reject(new Error('no engine')))
    const plugin: DiagramPlugin = {
      type: 'diagram',
      name: 'broken',
      language: 'mermaid',
      load,
      loaded: () => null,
    }

    const { host } = await mount('graph TD', plugin)
    await act(async () => {})

    expect(load).toHaveBeenCalled()
    // Nothing further is coming, so the cover comes off rather than waiting.
    expect(wrapper(host).className).toContain('failed')
  })

  it('ignores a preload that failed for a diagram the block no longer shows', async () => {
    const failing = deferred<never>()
    const broken: DiagramPlugin = {
      type: 'diagram',
      name: 'broken',
      language: 'mermaid',
      load: () => failing.promise,
      loaded: () => null,
    }
    const { plugin, drawn } = loadedPlugin()

    const { host, root } = await mount('graph TD', broken)
    await act(async () => {
      root.render(<MermaidDiagram chart="graph TD" diagram={plugin} />)
    })

    failing.fail(new Error('no engine'))
    await act(async () => {})

    // The import failed for a plugin this block has moved on from, so the
    // block is still waiting for the drawing it does have.
    expect(wrapper(host).className).not.toContain('failed')
    await report(true)
    await runLayouts()
    expect(drawn).toEqual(['graph TD'])
  })

  it('leaves a rejection to the source the block asks for now', async () => {
    const failing = deferred<DiagramResult>()
    const engine: DiagramEngine = {
      initialize() {},
      render: () => failing.promise,
    }
    const slow: DiagramPlugin = {
      type: 'diagram',
      name: 'slow',
      language: 'mermaid',
      load: () => Promise.resolve(engine),
      loaded: () => engine,
    }
    const { plugin, drawn } = loadedPlugin()

    const { host, root } = await mount('graph TD', slow)
    await report(true)
    await runLayouts()

    // The reader switches blocks while the first drawing is still in flight.
    await act(async () => {
      root.render(<MermaidDiagram chart="graph TD" diagram={plugin} />)
    })

    failing.fail(new Error('engine died'))
    await runLayouts()

    // The engine that failed is not the one this block is drawing with, so the
    // failure is dropped and the block keeps the drawing it asked for.
    expect(wrapper(host).className).not.toContain('failed')
    expect(wrapper(host).className).toContain('drawn')
    expect(drawn).toEqual(['graph TD'])
  })

  it('settles a drawing that rejects after the block is gone', async () => {
    const failing = deferred<DiagramResult>()
    const engine: DiagramEngine = {
      initialize() {},
      render: () => failing.promise,
    }
    const plugin: DiagramPlugin = {
      type: 'diagram',
      name: 'slow',
      language: 'mermaid',
      load: () => Promise.resolve(engine),
      loaded: () => engine,
    }

    const { root } = await mount('graph TD', plugin)
    await report(true)
    await runLayouts()

    act(() => {
      root.unmount()
    })
    failing.fail(new Error('engine died'))
    await act(async () => {})

    // There is no block left to report to, and the sandbox the engine drew in
    // is cleared either way.
    expect(document.querySelector('.mermaid-render-sandbox')).toBeNull()
  })
})
