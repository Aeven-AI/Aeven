// @vitest-environment jsdom
//
// A block that closes must keep its element type at that position. Swapping it
// remounts the block, which silently turns fullscreen back off.
//
// An expanded block is lifted onto `document.body` (see portalFullscreen), so
// the transcript keeps only the spacer that holds its height: the block being
// looked for is the lifted one, and the query runs against the document.
import { createRef } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import HyperMarkdown, { type HyperMarkdownHandle } from '../../src/index.ts'

const roots: ReturnType<typeof createRoot>[] = []

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia =
    window.matchMedia ??
    ((() => ({ matches: false, addListener: () => {}, removeListener: () => {} })) as any);
  (window as any).requestAnimationFrame =
    (window as any).requestAnimationFrame || ((cb: FrameRequestCallback) => { setTimeout(cb, 0) })
})

afterEach(() => {
  // A block left expanded holds a portal on the body, which the next case's
  // document-wide lookup would otherwise still find.
  act(() => { roots.forEach((root) => { root.unmount() }) })
  roots.length = 0
  document.body.replaceChildren()
})

function mount(ui: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => { root.render(ui) })
  roots.push(root)
  return { host, root }
}

describe('fullscreen survives a block closing', () => {
  it('code block', () => {
    const ref = createRef<HyperMarkdownHandle>()
    const { host } = mount(<HyperMarkdown ref={ref} streaming />)

    const open = '```js\nconst a = 1;\nconst b = 2;\n'
    const close = '```\n\nafter\n\n'

    act(() => { for (let i = 0; i < open.length; i += 5) ref.current!.write(open.slice(i, i + 5)) })

    const wrapper = host.querySelector('.codeblock-wrapper')
    expect(wrapper).toBeTruthy()

    const btn = wrapper!.querySelector('.codeblock-icon-button.last') as HTMLElement
    act(() => { btn.click() })

    act(() => { for (let i = 0; i < close.length; i += 5) ref.current!.write(close.slice(i, i + 5)) })
    act(() => { ref.current!.write('', true) })

    // The element at the block's position is the height-holding spacer, and the
    // block itself is still expanded: a remount at the close would have dropped
    // the expansion and left nothing lifted.
    expect(host.querySelector('.codeblock-wrapper')?.getAttribute('aria-hidden')).toBe('true')
    const after = document.querySelector('.codeblock-wrapper.fullscreen')
    expect(after).not.toBeNull()
    expect(after?.textContent).toContain('const b = 2')
  })

  it('renames the fullscreen button once the block is expanded', () => {
    const ref = createRef<HyperMarkdownHandle>()
    const { host } = mount(<HyperMarkdown ref={ref} streaming />)

    act(() => { ref.current!.write('| A | B |\n|---|---|\n| 1 | 2 |\n') })

    const button = host.querySelector('.table-icon-button.last') as HTMLElement
    expect(button.getAttribute('aria-label')).toBe('Full screen')

    act(() => { button.click() })

    // The same button, now offering the way back out, moves onto the body with
    // the block it expanded.
    const expanded = document.querySelector('.table-icon-button.last') as HTMLElement
    expect(expanded.getAttribute('aria-label')).toBe('Exit full screen')

    act(() => { expanded.click() })

    // Leaving fullscreen puts the block back in the transcript.
    expect(
      host.querySelector('.table-icon-button.last')!.getAttribute('aria-label'),
    ).toBe('Full screen')
    expect(document.querySelector('.table-wrapper.fullscreen')).toBeNull()
  })

  it('table closed by finalize', () => {
    const ref = createRef<HyperMarkdownHandle>()
    const { host } = mount(<HyperMarkdown ref={ref} streaming animation />)

    const open = '| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n'
    act(() => { for (let i = 0; i < open.length; i += 5) ref.current!.write(open.slice(i, i + 5)) })

    const wrapper = host.querySelector('.table-wrapper')
    const btn = wrapper!.querySelector('.table-icon-button.last') as HTMLElement
    act(() => { btn.click() })

    act(() => { ref.current!.write('', true) })
    const after = document.querySelector('.table-wrapper.fullscreen')
    expect(after).not.toBeNull()
    expect(after?.textContent).toContain('3')
  })

  it('code block closed by finalize', () => {
    const ref = createRef<HyperMarkdownHandle>()
    const { host } = mount(<HyperMarkdown ref={ref} streaming animation />)

    const open = '```js\nconst a = 1;\nconst b = 2;\n```\n'
    act(() => { for (let i = 0; i < open.length; i += 5) ref.current!.write(open.slice(i, i + 5)) })

    const wrapper = host.querySelector('.codeblock-wrapper')
    const btn = wrapper!.querySelector('.codeblock-icon-button.last') as HTMLElement
    act(() => { btn.click() })
    act(() => { ref.current!.write('', true) })
    const after = document.querySelector('.codeblock-wrapper.fullscreen')
    expect(after).not.toBeNull()
    expect(after?.textContent).toContain('const a = 1')
  })

  it('table', () => {
    const ref = createRef<HyperMarkdownHandle>()
    const { host } = mount(<HyperMarkdown ref={ref} streaming />)

    const open = '| A | B |\n|---|---|\n| 1 | 2 |\n'
    const close = '| 3 | 4 |\n\nafter\n\n'

    act(() => { for (let i = 0; i < open.length; i += 5) ref.current!.write(open.slice(i, i + 5)) })

    const wrapper = host.querySelector('.table-wrapper')
    expect(wrapper).toBeTruthy()
    const btn = wrapper!.querySelector('.table-icon-button.last') as HTMLElement
    act(() => { btn.click() })

    act(() => { for (let i = 0; i < close.length; i += 5) ref.current!.write(close.slice(i, i + 5)) })
    act(() => { ref.current!.write('', true) })

    const after = document.querySelector('.table-wrapper.fullscreen')
    expect(after).not.toBeNull()
    expect(after?.textContent).toContain('3')
  })
})
