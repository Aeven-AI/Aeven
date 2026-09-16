// @vitest-environment jsdom
import React, { createRef } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import HyperMarkdown, { type HyperMarkdownHandle } from '../../src/index.ts'
import CodeHeader from '../../src/engine/code/header.tsx'
import MarkdownCode from '../../src/engine/code/index.tsx'
import LineNumber from '../../src/engine/code/line-numbers.tsx'
import MermaidDiagram from '../../src/engine/mermaid/index.tsx'
import MermaidHeader from '../../src/engine/mermaid/header.tsx'
import Reasoning from '../../src/engine/reasoning/index.tsx'
import TableHeader from '../../src/engine/table/header.tsx'
import MarkdownTable from '../../src/engine/table/index.tsx'
import { defaultUi } from '../../src/engine/config.ts'
import { Emitter } from '../../src/engine/runtime.ts'
import Renderer from '../../src/engine/renderer.tsx'

let frames: FrameRequestCallback[] = []
const scrollTo = vi.fn()

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (() => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as any
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  }) as any
  HTMLElement.prototype.scrollTo = scrollTo
})

afterEach(() => {
  document.body.replaceChildren()
  localStorage.clear()
  frames = []
  scrollTo.mockClear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function flushFrames() {
  const pending = frames
  frames = []
  pending.forEach((callback) =>{  callback(performance.now()) })
}

/**
 * Draw the diagrams the cache has queued. A queued source is laid out in the
 * browser task after the one that asked for it, so the clock is stepped here
 * rather than in every case: a case's fake timers never reach a task on their
 * own, and jsdom's real ones need a turn to pass.
 */
async function drawDiagrams(): Promise<void> {
  await act(async () => {
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(0)
      return
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  })
}

function mount(ui: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() =>{  root.render(ui) })
  flushFrames()
  return { host, root }
}

function refWith<T>(current: T) {
  return { current } as React.RefObject<T>
}

describe('toolbar controls', () => {
  it('copies code and opens a completed HTML preview', async () => {
    vi.useFakeTimers()
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard })
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
    const alerts = vi.fn()
    const { host, root } = mount(
      <HyperMarkdown
        md={'```html\n<strong>preview</strong>\n```\n'}
        onAlert={alerts}
        preview={{ url: '/preview-code/{id}' }}
      />,
    )

    const buttons = host.querySelectorAll<HTMLButtonElement>('.codeblock-icon-button')
    expect(buttons).toHaveLength(3)
    await act(async () =>{  buttons[1]!.click() })
    await act(() => vi.advanceTimersByTime(600))
    expect(clipboard.writeText).toHaveBeenCalledWith('<strong>preview</strong>\n')
    act(() =>{  buttons[0]!.click() })
    expect(opened).toHaveBeenCalledWith(expect.stringMatching(/^\/preview-code\/hm-/), '_blank')
    expect(Object.keys(localStorage).some(key => key.startsWith('preview-hm-'))).toBe(true)
    expect(alerts).not.toHaveBeenCalled()
    act(() =>{  root.unmount() })
  })

  it('reports a pending preview and forwards fullscreen events', () => {
    const alerts = vi.fn()
    const fullscreen = vi.fn()
    const componentRef = createRef<HyperMarkdownHandle>()
    const { root } = mount(
      <HyperMarkdown
        ref={componentRef}
        streaming
        onAlert={alerts}
        onFullscreenChange={fullscreen}
      />,
    )
    act(() => {
      // The handle's store is the engine's own renderer, which is where the
      // block event bus lives; the public store type does not expose it.
      const store = componentRef.current!.store as unknown as Renderer

      store.events.dispatchObjectEvent('show:modal', {
        type: 'alertModal',
        header: defaultUi.translations.previewPendingTitle,
        content: 'pending',
      })
      store.events.dispatchObjectEvent('fullscreen:change', true)
      store.events.dispatchObjectEvent('fullscreen:change', false)
    })
    expect(alerts).toHaveBeenCalledWith(expect.objectContaining({
      header: defaultUi.translations.previewPendingTitle,
    }))
    expect(fullscreen).toHaveBeenCalledWith(true)
    expect(fullscreen).toHaveBeenLastCalledWith(false)
    act(() =>{  root.unmount() })

    // Exercise the producer side of the pending-preview event too.
    const events = new Emitter()
    const pending = vi.fn()
    events.on('show:modal', 'pending', pending)
    const direct = mount(
      <CodeHeader
        stream
        language="html"
        fullscreen={false}
        codeRef={refWith(document.createElement('div'))}
        wrapperRef={refWith(document.createElement('div'))}
        toggleFullScreen={vi.fn()}
        events={events}
      />,
    )
    act(() =>{  direct.host.querySelector<HTMLButtonElement>('button')!.click() })
    expect(pending).toHaveBeenCalledWith(expect.objectContaining({
      header: defaultUi.translations.previewPendingTitle,
    }))
    act(() =>{  direct.root.unmount() })
  })

  it('handles unavailable previews and rejected clipboard writes', async () => {
    const clipboardError = new Error('denied')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(clipboardError) },
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const events = new Emitter()
    const alert = vi.fn()
    events.on('show:modal', 'test', alert)
    const code = document.createElement('div')
    const wrapper = document.createElement('div')
    const toggle = vi.fn()
    const { host, root } = mount(
      <CodeHeader
        language="html"
        fullscreen={false}
        codeRef={refWith(code)}
        wrapperRef={refWith(wrapper)}
        toggleFullScreen={toggle}
        events={events}
      />,
    )

    const buttons = host.querySelectorAll<HTMLButtonElement>('button')
    act(() =>{  buttons[0]!.click() })
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({
      header: defaultUi.translations.previewUnavailableTitle,
    }))

    code.textContent = 'copy me'
    await act(async () =>{  buttons[1]!.click() })
    expect(consoleError).toHaveBeenCalledWith('Failed to copy code: ', clipboardError)
    Object.defineProperty(wrapper, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 0, height: 200 }),
    })
    await act(() => window.dispatchEvent(new Event('scroll')))
    flushFrames()
    expect(host.querySelector('.codeblock-header')?.className).toContain('scroll')
    Object.defineProperty(wrapper, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 70, height: 20 }),
    })
    await act(() => window.dispatchEvent(new Event('resize')))
    flushFrames()
    expect(host.querySelector('.codeblock-header')?.className).not.toContain('scroll')
    act(() =>{  root.unmount() })
  })

  it('copies tables, handles copy failure, and supports disabled controls', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('no'))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const table = document.createElement('table')
    Object.defineProperty(table, 'innerText', { value: 'A\tB\n1\t2' })
    const wrapper = document.createElement('div')
    const events = new Emitter()
    const fullscreen = vi.fn()
    events.on('fullscreen:change', 'table', fullscreen)
    const { host, root } = mount(
      <TableHeader
        stream
        tableRef={refWith(table)}
        wrapperRef={refWith(wrapper)}
        fullscreen={false}
        events={events}
      />,
    )
    const buttons = host.querySelectorAll<HTMLButtonElement>('button')
    act(() =>{  buttons[1]!.click() })
    expect(fullscreen).toHaveBeenCalledWith(true)
    await act(async () =>{  buttons[0]!.click() })
    await act(() => vi.advanceTimersByTime(600))
    await act(async () =>{  buttons[0]!.click() })
    expect(writeText).toHaveBeenCalledWith('A\tB\n1\t2')
    expect(consoleLog).toHaveBeenCalled()

    const ui = {
      ...defaultUi,
      controls: {
        ...defaultUi.controls,
        table: { fullscreen: false, copy: false, preview: false },
      },
    }
    act(() =>{  root.render(
      <TableHeader
        tableRef={refWith(table)}
        wrapperRef={refWith(wrapper)}
        fullscreen
        ui={ui}
      />,
    ) })
    flushFrames()
    expect(host.querySelector('button')).toBeNull()

    act(() =>{  root.render(
      <TableHeader
        tableRef={refWith<HTMLTableElement | null>(null)}
        wrapperRef={refWith(wrapper)}
        fullscreen={false}
      />,
    ) })
    flushFrames()
    act(() =>{  host.querySelectorAll<HTMLButtonElement>('button')[0]!.click() })
    act(() =>{  root.unmount() })
  })

  it('tracks fullscreen code scrolling and settles animated children', async () => {
    vi.useFakeTimers()
    const { host, root } = mount(
      <MarkdownCode
        animation
        children={<code className="language-js">streaming{'\n'}</code>}
        preChildren={<code className="language-js">settled{'\n'}</code>}
      />,
    )
    const spacer = host.querySelector<HTMLElement>('.codeblock-wrapper')!

    // Fullscreen is the block's own state, entered through its header. The
    // expanded block is lifted onto document.body, and the lifted box — not the
    // spacer left in the transcript — is the one the reader scrolls.
    act(() =>{
      host
        .querySelector<HTMLButtonElement>('.codeblock-icon-button.last')!
        .click() },
    )
    const wrapper = document.querySelector<HTMLElement>(
      '.codeblock-wrapper.fullscreen',
    )!
    expect(wrapper.className).toContain('fullscreen')
    expect(spacer.getAttribute('aria-hidden')).toBe('true')

    // jsdom lays nothing out, and the lifted box exists only once the toggle
    // has run, so its metrics are stubbed as soon as it is on the page.
    Object.defineProperties(wrapper, {
      scrollHeight: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    })

    // The block follows the stream to its floor, and the animated wait settles
    // into the finished tree.
    await act(() => vi.advanceTimersByTime(1000))
    expect(wrapper.scrollTo).toHaveBeenCalled()
    expect(wrapper.textContent).toContain('settled')

    // A reader scrolled away from the floor is left where they are: a further
    // render of the block does not pull them back down.
    wrapper.scrollTop = 0
    await act(() => wrapper.dispatchEvent(new Event('scroll')))
    Object.defineProperty(wrapper, 'scrollHeight', {
      configurable: true,
      writable: true,
      value: 600,
    })
    scrollTo.mockClear()
    act(() =>{
      root.render(
        <MarkdownCode
          animation
          children={<code className="language-js">more{'\n'}</code>}
          preChildren={<code className="language-js">settled{'\n'}</code>}
        />,
      ) },
    )
    expect(scrollTo).not.toHaveBeenCalled()

    // Back at the floor the block follows the stream again.
    wrapper.scrollTop = 550
    await act(() => wrapper.dispatchEvent(new Event('scroll')))
    Object.defineProperty(wrapper, 'scrollHeight', {
      configurable: true,
      writable: true,
      value: 700,
    })
    act(() =>{
      root.render(
        <MarkdownCode
          animation
          children={<code className="language-js">more{'\n'}</code>}
          preChildren={<code className="language-js">settled{'\n'}</code>}
        />,
      ) },
    )
    expect(scrollTo).toHaveBeenCalledTimes(1)

    // Leaving fullscreen puts the block back in the transcript.
    act(() =>{
      document
        .querySelector<HTMLButtonElement>('.codeblock-icon-button.last')!
        .click() },
    )
    expect(
      host.querySelector<HTMLElement>('.codeblock-wrapper')!.className,
    ).not.toContain('fullscreen')
    expect(document.querySelector('.codeblock-wrapper.fullscreen')).toBeNull()
    act(() =>{  root.unmount() })
  })

  it('handles code blocks without language metadata or mounted wrappers', () => {
    // The title falls back to "Code" whenever the fence names no language it
    // recognizes: no children, no class, or a class that is not a language-*.
    for (const children of [
      <code key="bare" />,
      <code key="plain" className="plain" />,
    ]) {
      const { host, root } = mount(<MarkdownCode children={children} />)
      expect(host.querySelector('.codeblock-title')?.textContent).toBe('Code')
      act(() =>{  root.unmount() })
    }

    const bare = mount(<MarkdownCode />)
    expect(bare.host.querySelector('.codeblock-title')?.textContent).toBe('Code')
    act(() =>{  bare.root.unmount() })

    const named = mount(
      <MarkdownCode children={<code className="language-js">x</code>} />,
    )
    expect(named.host.querySelector('.codeblock-title')?.textContent).toBe('js')
    act(() =>{  named.root.unmount() })
  })

  it('grows, trims, and exactly fills line-number groups', () => {
    // 130 lines spans three groups (64 + 64 + 2); 64 fills exactly one.
    const many = mount(
      <LineNumber
        animation={false}
        codeRef={refWith(document.createElement('div'))}
        lineCount={130}
      />,
    )
    expect(many.host.querySelectorAll('.line-number')).toHaveLength(130)

    // A block that shrinks gives the whole tail back instead of keeping lines
    // it no longer has.
    act(() =>{
      many.root.render(
        <LineNumber
          animation={false}
          codeRef={refWith(document.createElement('div'))}
          lineCount={64}
        />,
      ) },
    )
    expect(many.host.querySelectorAll('.line-number')).toHaveLength(64)
    act(() =>{  many.root.unmount() })

    const exact = mount(
      <LineNumber
        animation={false}
        codeRef={refWith(document.createElement('div'))}
        lineCount={64}
      />,
    )
    expect(exact.host.querySelectorAll('.line-number')).toHaveLength(64)
    act(() =>{  exact.root.unmount() })

    // No tally and no readable text: the gutter shows its single empty entry.
    const code = document.createElement('div')
    Object.defineProperty(code, 'textContent', { configurable: true, value: null })
    const empty = mount(<LineNumber codeRef={refWith(code)} />)
    expect(empty.host.querySelectorAll('.line-number')).toHaveLength(1)
    act(() =>{  empty.root.unmount() })
  })

  it('hides disabled code and diagram controls', () => {
    const ui = {
      ...defaultUi,
      controls: {
        ...defaultUi.controls,
        code: { fullscreen: false, copy: false, preview: false },
        diagram: { fullscreen: false, copy: false, preview: false, panZoom: false },
      },
    }
    const wrapper = document.createElement('div')
    const code = document.createElement('div')
    const { host, root } = mount(
      <>
        <CodeHeader
          ui={ui}
          language="js"
          fullscreen={false}
          codeRef={refWith(code)}
          wrapperRef={refWith(wrapper)}
          toggleFullScreen={vi.fn()}
        />
        <MermaidHeader
          ui={ui}
          chart="graph"
          fullscreen={false}
          wrapperRef={refWith(wrapper)}
          toggleFullScreen={vi.fn()}
        />
      </>,
    )
    expect(host.querySelector('button')).toBeNull()
    act(() =>{  root.unmount() })
  })

  it("tracks a fullscreen table user's scroll position", async () => {
    const { host, root } = mount(
      <MarkdownTable>
        <tbody><tr><td>one</td></tr></tbody>
      </MarkdownTable>,
    )

    // The expanded table is lifted onto document.body; the element left in the
    // transcript only holds its height.
    act(() =>{  host.querySelector<HTMLButtonElement>('.table-icon-button.last')!.click() })
    const spacer = host.querySelector<HTMLElement>('.table-wrapper')!
    const wrapper = document.querySelector<HTMLElement>('.table-wrapper.fullscreen')!
    expect(spacer.className).not.toContain('fullscreen')
    Object.defineProperties(wrapper, {
      scrollHeight: { configurable: true, writable: true, value: 500 },
      clientHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    })

    // A row arriving while the reader is at the floor scrolls the table along.
    Object.defineProperty(wrapper, 'scrollHeight', { configurable: true, writable: true, value: 600 })
    act(() =>{  root.render(
      <MarkdownTable><tbody><tr><td>two</td></tr></tbody></MarkdownTable>,
    ) })
    expect(wrapper.scrollTo).toHaveBeenCalledTimes(1)

    // A reader scrolled away from the floor is left where they are.
    wrapper.scrollTop = 0
    await act(() => wrapper.dispatchEvent(new Event('scroll')))
    Object.defineProperty(wrapper, 'scrollHeight', { configurable: true, writable: true, value: 700 })
    act(() =>{  root.render(
      <MarkdownTable><tbody><tr><td>three</td></tr></tbody></MarkdownTable>,
    ) })
    expect(wrapper.scrollTo).toHaveBeenCalledTimes(1)
    act(() =>{  root.unmount() })
  })

  it('updates a table header across viewport and fullscreen changes', async () => {
    const table = document.createElement('table')
    const wrapper = document.createElement('div')
    Object.defineProperty(wrapper, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 0, height: 200 }),
    })
    const { host, root } = mount(
      <TableHeader
        tableRef={refWith(table)}
        wrapperRef={refWith(wrapper)}
        fullscreen={false}
      />,
    )
    await act(() => window.dispatchEvent(new Event('scroll')))
    flushFrames()
    expect(host.querySelector('.table-header')?.className).toContain('scroll')
    act(() =>{  root.render(
      <TableHeader
        tableRef={refWith(table)}
        wrapperRef={refWith(wrapper)}
        fullscreen
      />,
    ) })
    flushFrames()
    expect(host.querySelector('.table-header')?.className).not.toContain('scroll')
    await act(() => window.dispatchEvent(new Event('resize')))
    act(() =>{  root.unmount() })
    flushFrames()
  })
})

describe('diagram controls and engine lifecycle', () => {
  it('renders, updates, scrolls, copies, and toggles a diagram', async () => {
    vi.useFakeTimers()
    const render = vi.fn(async (_id: string, chart: string) => ({ svg: `<svg><text>${chart}</text></svg>` }))
    const engine = { initialize: vi.fn(), render }
    const plugin: any = {
      type: 'diagram',
      name: 'fake',
      language: 'mermaid',
      loaded: () => engine,
      load: vi.fn(),
    }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    const events = new Emitter()
    const fullscreen = vi.fn()
    events.on('fullscreen:change', 'diagram', fullscreen)
    const scrolled = vi.fn()
    const { host, root } = mount(
      <MermaidDiagram chart="graph TD" diagram={plugin} events={events} scrollDown={scrolled} />,
    )
    await drawDiagrams()
    expect(host.querySelector('.mermaid-svg svg')?.textContent).toBe('graph TD')
    expect(document.querySelector('.mermaid-render-sandbox')).toBeNull()

    // The expanded diagram is lifted onto document.body with its toolbar.
    act(() =>{  host.querySelector<HTMLButtonElement>('.mermaid-icon-button.last')!.click() })
    expect(document.querySelector('.mermaid-wrapper.fullscreen')).not.toBeNull()
    expect(fullscreen).toHaveBeenCalledWith(true)
    await act(async () =>{  document.querySelector<HTMLButtonElement>('.mermaid-icon-button.first')!.click() })
    await act(() => vi.advanceTimersByTime(600))

    act(() =>{  root.render(
      <MermaidDiagram chart="graph LR" stream="true" diagram={plugin} events={events} scrollDown={scrolled} />,
    ) })
    flushFrames()
    await drawDiagrams()
    expect(render).toHaveBeenCalledTimes(2)
    expect(document.querySelector('.mermaid-wrapper')?.className).toContain('stream-active')
    act(() =>{  root.unmount() })
  })

  it('cleans up after engine load and render failures', async () => {
    const failingLoad: any = {
      loaded: () => null,
      load: () => Promise.reject(new Error('load')),
    }
    const { root } = mount(<MermaidDiagram chart="bad" diagram={failingLoad} />)
    await act(async () => {})
    expect(document.querySelector('.mermaid-render-sandbox')).toBeNull()

    const failingRender: any = {
      loaded: () => ({ render: () => Promise.reject(new Error('render')) }),
      load: vi.fn(),
    }
    act(() =>{  root.render(<MermaidDiagram chart="still bad" diagram={failingRender} />) })
    flushFrames()
    await act(async () => {})
    expect(document.querySelector('.mermaid-render-sandbox')).toBeNull()
    act(() =>{  root.unmount() })
  })

  it('renders after an asynchronous engine load and handles inert instances', async () => {
    const engine = { render: vi.fn(async () => ({ svg: '<svg><text>loaded</text></svg>' })) }
    const plugin: any = {
      loaded: () => null,
      load: () => Promise.resolve(engine),
    }
    const { host, root } = mount(<MermaidDiagram chart="async" diagram={plugin} />)
    await drawDiagrams()
    expect(host.querySelector('.mermaid-svg')?.textContent).toBe('loaded')
    act(() =>{  root.unmount() })

    // An empty chart draws nothing and tears down cleanly.
    const empty = mount(<MermaidDiagram chart="" diagram={plugin} />)
    await drawDiagrams()
    expect(empty.host.querySelector('.mermaid-svg')?.textContent).toBe('')
    act(() =>{  empty.root.unmount() })
  })

  it('covers header update decisions and empty charts', async () => {
    const wrapper = document.createElement('div')
    const toggle = vi.fn()
    const { host, root } = mount(
      <MermaidHeader
        chart=""
        fullscreen={false}
        wrapperRef={refWith(wrapper)}
        toggleFullScreen={toggle}
      />,
    )
    expect(host.querySelectorAll('button')).toHaveLength(2)
    Object.defineProperty(wrapper, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 0, height: 200 }),
    })
    await act(() => window.dispatchEvent(new Event('scroll')))
    flushFrames()
    expect(host.querySelector('.mermaid-header')?.className).toContain('scroll')
    Object.defineProperty(wrapper, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 70, height: 20 }),
    })
    await act(() => window.dispatchEvent(new Event('resize')))
    flushFrames()
    expect(host.querySelector('.mermaid-header')?.className).not.toContain('scroll')
    act(() =>{  root.unmount() })
  })

  it('handles rejected diagram copies and fullscreen header updates', async () => {
    vi.useFakeTimers()
    const error = new Error('clipboard denied')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(error) },
    })
    const logged = vi.spyOn(console, 'log').mockImplementation(() => {})
    const wrapper = document.createElement('div')
    const { host, root } = mount(
      <MermaidHeader
        chart="graph"
        fullscreen={false}
        wrapperRef={refWith(wrapper)}
        toggleFullScreen={vi.fn()}
      />,
    )
    await act(async () =>{  host.querySelectorAll<HTMLButtonElement>('button')[0]!.click() })
    expect(logged).toHaveBeenCalledWith(error)
    act(() =>{  root.render(
      <MermaidHeader
        chart="graph"
        fullscreen
        wrapperRef={refWith(wrapper)}
        toggleFullScreen={vi.fn()}
      />,
    ) })
    flushFrames()
    expect(host.querySelector('.mermaid-header')?.className).not.toContain('scroll')
    act(() =>{  root.unmount() })
  })

  it("tracks a fullscreen diagram user's scroll position", async () => {
    const engine = { render: vi.fn(async () => ({ svg: '<svg/>' })) }
    const plugin: any = { loaded: () => engine, load: vi.fn() }
    const { host, root } = mount(
      <MermaidDiagram chart="graph" diagram={plugin} />,
    )
    await drawDiagrams()
    const spacer = host.querySelector<HTMLElement>('.mermaid-wrapper')!

    // Fullscreen is the diagram's own state, entered through its header; the
    // expanded diagram is lifted onto document.body, and the lifted box — not
    // the spacer left in the transcript — is what the reader scrolls.
    act(() =>{  host.querySelectorAll<HTMLButtonElement>('.mermaid-icon-button')[1]!.click() })
    const wrapper = document.querySelector<HTMLElement>('.mermaid-wrapper.fullscreen')!
    Object.defineProperties(wrapper, {
      scrollHeight: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    })

    // The expanded diagram follows its own drawing to the floor.
    act(() =>{  root.render(<MermaidDiagram chart="graph" diagram={plugin} />) })
    expect(wrapper.scrollTo).toHaveBeenCalled()

    // A reader who scrolled away is left where they are.
    wrapper.scrollTop = 0
    await act(() => wrapper.dispatchEvent(new Event('scroll')))
    scrollTo.mockClear()
    act(() =>{  root.render(<MermaidDiagram chart="graph" diagram={plugin} />) })
    expect(scrollTo).not.toHaveBeenCalled()

    // Back at the floor the diagram follows the stream again.
    wrapper.scrollTop = 450
    await act(() => wrapper.dispatchEvent(new Event('scroll')))
    Object.defineProperty(wrapper, 'scrollHeight', {
      configurable: true,
      writable: true,
      value: 600,
    })
    act(() =>{  root.render(<MermaidDiagram chart="graph" diagram={plugin} />) })
    expect(scrollTo).toHaveBeenCalledTimes(1)

    // Leaving fullscreen returns the diagram to the transcript.
    act(() =>{  document.querySelectorAll<HTMLButtonElement>('.mermaid-icon-button')[1]!.click() })
    expect(document.querySelector('.mermaid-wrapper.fullscreen')).toBeNull()
    expect(spacer.className).not.toContain('fullscreen')
    act(() =>{  root.unmount() })
  })
})

describe('reasoning interaction', () => {
  it("times streaming reasoning and preserves a reader's toggle", async () => {
    vi.useFakeTimers()
    const { host, root } = mount(<Reasoning stream>thinking</Reasoning>)
    expect(host.querySelector('.reasoning-wrapper')?.className).toContain('open')
    await act(() => vi.advanceTimersByTime(1100))
    act(() =>{  host.querySelector<HTMLButtonElement>('button')!.click() })
    expect(host.querySelector('.reasoning-wrapper')?.className).toContain('collapsed')
    act(() =>{  root.render(<Reasoning stream={false}>done</Reasoning>) })
    expect(host.querySelector('.reasoning-wrapper')?.className).toContain('collapsed')
    act(() =>{  root.unmount() })
  })

  it('automatically collapses reasoning that finishes untouched', () => {
    const { host, root } = mount(<Reasoning stream>thinking</Reasoning>)
    act(() =>{  root.render(<Reasoning stream={false}>done</Reasoning>) })
    expect(host.querySelector('.reasoning-wrapper')?.className).toContain('collapsed')
    act(() =>{  root.unmount() })
  })

  it('portals reasoning into a configured browser target', () => {
    const target = document.createElement('aside')
    document.body.appendChild(target)
    const renderer: any = new Renderer({ reasoningTarget: target })
    const portal = renderer.placeReasoning(<div>portal reasoning</div>, 1)
    expect(portal).toBeTruthy()
  })
})
