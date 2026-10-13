// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { OpenState } from '@aeven/api-session-controller/client'
import type { SessionId } from '@aeven/session/types'
import {
  PAGE_PRELOADER_ELEMENT_ID, useContentCover,
} from '../src/client/skeleton/content-cover.ts'

const sid = (id: string) => id as SessionId
const A = sid('a')
const B = sid('b')

let rafSeq = 0
const rafPending = new Map<number, FrameRequestCallback>()

function stubAnimationFrames(): void {
  rafSeq = 0
  rafPending.clear()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = ++rafSeq
    rafPending.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafPending.delete(id)
  })
}

function flushAnimationFrames(rounds = 1): void {
  act(() => {
    for (let round = 0; round < rounds; round++) {
      const batch = [...rafPending.values()]
      rafPending.clear()
      for (const cb of batch) cb(0)
    }
  })
}

function mountPreloader(className = ''): HTMLElement {
  const el = document.createElement('div')
  el.id = PAGE_PRELOADER_ELEMENT_ID
  if (className !== '') el.className = className
  document.body.append(el)
  return el
}

function Probe(props: {
  sessionId: SessionId | undefined
  hero: boolean
  openState: OpenState | undefined
}) {
  const { loaderActive, mountedSessionId } = useContentCover(props)
  return (
    <div
      data-loader={loaderActive || undefined}
      data-mounted={mountedSessionId ?? ''}
    />
  )
}

afterEach(() => {
  cleanup()
  document.getElementById(PAGE_PRELOADER_ELEMENT_ID)?.remove()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  stubAnimationFrames()
})

describe('useContentCover', () => {
  it('covers an unpainted Session and hides after the body has painted', () => {
    const view = render(<Probe sessionId={A} hero={false} openState="open" />)
    const root = () => view.container.firstElementChild as HTMLElement
    expect(root().hasAttribute('data-loader')).toBe(true)
    expect(root().getAttribute('data-mounted')).toBe('')
    flushAnimationFrames(2)
    expect(root().getAttribute('data-mounted')).toBe(A)
    expect(root().hasAttribute('data-loader')).toBe(true)
    flushAnimationFrames(2)
    expect(root().hasAttribute('data-loader')).toBe(false)
  })

  it('stays covering while history is still opening', () => {
    const view = render(<Probe sessionId={A} hero={false} openState="loading" />)
    const root = () => view.container.firstElementChild as HTMLElement
    expect(root().hasAttribute('data-loader')).toBe(true)
    flushAnimationFrames(2)
    expect(root().hasAttribute('data-loader')).toBe(true)
    view.rerender(<Probe sessionId={A} hero={false} openState="open" />)
    flushAnimationFrames(2)
    expect(root().hasAttribute('data-loader')).toBe(false)
  })

  it('treats an open error as painted after the body has painted', () => {
    const view = render(<Probe sessionId={A} hero={false} openState="error" />)
    flushAnimationFrames(2)
    flushAnimationFrames(2)
    expect(view.container.firstElementChild?.hasAttribute('data-loader')).toBe(false)
  })

  it('does not cover the proven-blank hero', () => {
    const view = render(<Probe sessionId={A} hero={true} openState="loading" />)
    expect(view.container.firstElementChild?.hasAttribute('data-loader')).toBe(false)
    expect(view.container.firstElementChild?.getAttribute('data-mounted')).toBe(A)
  })

  it('drops the body on a Session switch until the overlay has been presented, then remounts', () => {
    const view = render(<Probe sessionId={A} hero={false} openState="open" />)
    flushAnimationFrames(2)
    flushAnimationFrames(2)
    view.rerender(<Probe sessionId={B} hero={false} openState="open" />)
    const root = () => view.container.firstElementChild as HTMLElement
    expect(root().hasAttribute('data-loader')).toBe(true)
    expect(root().getAttribute('data-mounted')).toBe('')
    flushAnimationFrames(1)
    expect(root().getAttribute('data-mounted')).toBe('')
    flushAnimationFrames(1)
    expect(root().getAttribute('data-mounted')).toBe(B)
    expect(root().hasAttribute('data-loader')).toBe(true)
    flushAnimationFrames(2)
    expect(root().hasAttribute('data-loader')).toBe(false)
  })

  it('does not show the overlay while the page preloader is fading', () => {
    mountPreloader('hide animate')
    const view = render(<Probe sessionId={A} hero={false} openState="loading" />)
    const root = () => view.container.firstElementChild as HTMLElement
    expect(root().hasAttribute('data-loader')).toBe(false)
    expect(root().getAttribute('data-mounted')).toBe(A)
  })

  it('shows the overlay once the page preloader is screen-hidden and the column is unpainted', async () => {
    const el = mountPreloader()
    const view = render(<Probe sessionId={A} hero={false} openState="loading" />)
    const root = () => view.container.firstElementChild as HTMLElement
    expect(root().hasAttribute('data-loader')).toBe(false)
    await act(async () => {
      el.classList.add('screen-hidden')
      await Promise.resolve()
    })
    expect(root().hasAttribute('data-loader')).toBe(true)
    expect(root().getAttribute('data-mounted')).toBe(A)
  })

  it('mounts immediately on a Session switch while the page preloader is visible', () => {
    mountPreloader()
    const view = render(<Probe sessionId={A} hero={false} openState="open" />)
    view.rerender(<Probe sessionId={B} hero={false} openState="open" />)
    const root = view.container.firstElementChild as HTMLElement
    expect(root.hasAttribute('data-loader')).toBe(false)
    expect(root.getAttribute('data-mounted')).toBe(B)
  })

  it('clears the mounted body when nothing is selected', () => {
    const view = render(<Probe sessionId={A} hero={false} openState="open" />)
    view.rerender(<Probe sessionId={undefined} hero={true} openState={undefined} />)
    const root = view.container.firstElementChild as HTMLElement
    expect(root.hasAttribute('data-loader')).toBe(false)
    expect(root.getAttribute('data-mounted')).toBe('')
  })

  it('covers a return even when the outgoing Session has not painted yet', () => {
    const view = render(<Probe sessionId={A} hero={false} openState="open" />)
    flushAnimationFrames(2)
    flushAnimationFrames(2)
    view.rerender(<Probe sessionId={B} hero={false} openState="open" />)
    flushAnimationFrames(2)
    expect(view.container.firstElementChild?.getAttribute('data-mounted')).toBe(B)
    view.rerender(<Probe sessionId={A} hero={false} openState="open" />)
    const root = () => view.container.firstElementChild as HTMLElement
    expect(root().hasAttribute('data-loader')).toBe(true)
    expect(root().getAttribute('data-mounted')).toBe('')
    flushAnimationFrames(2)
    expect(root().getAttribute('data-mounted')).toBe(A)
    flushAnimationFrames(2)
    expect(root().hasAttribute('data-loader')).toBe(false)
  })

  it('covers a return to a previously painted Session until that remount paints', () => {
    const view = render(<Probe sessionId={A} hero={false} openState="open" />)
    flushAnimationFrames(2)
    flushAnimationFrames(2)
    view.rerender(<Probe sessionId={B} hero={false} openState="open" />)
    expect(view.container.firstElementChild?.getAttribute('data-mounted')).toBe('')
    flushAnimationFrames(2)
    expect(view.container.firstElementChild?.getAttribute('data-mounted')).toBe(B)
    flushAnimationFrames(2)
    expect(view.container.firstElementChild?.hasAttribute('data-loader')).toBe(false)
    view.rerender(<Probe sessionId={A} hero={false} openState="open" />)
    const root = () => view.container.firstElementChild as HTMLElement
    expect(root().hasAttribute('data-loader')).toBe(true)
    expect(root().getAttribute('data-mounted')).toBe('')
    flushAnimationFrames(2)
    expect(root().getAttribute('data-mounted')).toBe(A)
    expect(root().hasAttribute('data-loader')).toBe(true)
    flushAnimationFrames(2)
    expect(root().hasAttribute('data-loader')).toBe(false)
  })

  it('remounts and marks painted immediately when requestAnimationFrame is missing', () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    const view = render(<Probe sessionId={A} hero={false} openState="open" />)
    view.rerender(<Probe sessionId={B} hero={false} openState="open" />)
    const root = view.container.firstElementChild as HTMLElement
    expect(root.getAttribute('data-mounted')).toBe(B)
    expect(root.hasAttribute('data-loader')).toBe(false)
  })
})
