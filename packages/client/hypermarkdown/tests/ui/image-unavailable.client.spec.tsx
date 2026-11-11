// @vitest-environment jsdom
//
// A host that cannot turn an authored source into a URL must say so: an image
// that renders as nothing reads as an image that loaded. The engine owns no
// language, so it draws whatever copy the host hands it, and stays silent when
// the host supplies none.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import HyperMarkdown from '../../src/index.ts'

let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement | undefined

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = window.matchMedia
    ?? ((() => ({ matches: false, addListener: () => {}, removeListener: () => {} })) as any)
})

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  root = undefined
  host = undefined
})

function mount(md: string, options: { label?: string; suppressed?: boolean } = {}) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <HyperMarkdown
        md={md}
        resolveImage={() => undefined}
        {...options.label === undefined ? {} : { imageUnavailableLabel: options.label }}
        {...options.suppressed === undefined ? {} : { imageVisible: () => options.suppressed !== true }}
      />,
    )
  })
  return host
}

describe('an image the host cannot resolve', () => {
  it('names the source it could not load, under the copy the host supplied', () => {
    const view = mount('![Mobile](/Users/me/shots/mobile.png)', { label: 'Image not shown' })
    const state = view.querySelector('.markdown-image-unavailable')

    expect(state?.querySelector('.markdown-image-unavailable-label')?.textContent).toBe('Image not shown')
    expect(state?.querySelector('.markdown-image-unavailable-source')?.textContent).toBe('/Users/me/shots/mobile.png')
    expect(state?.querySelector('.markdown-image-unavailable-alt')?.textContent).toBe('Mobile')
    expect(state?.getAttribute('title')).toBe('/Users/me/shots/mobile.png')
    expect(view.querySelector('img')).toBeNull()
  })

  it('keeps the source alone when the author wrote no alt text', () => {
    const view = mount('![](/Users/me/shots/mobile.png)', { label: 'Image not shown' })

    expect(view.querySelector('.markdown-image-unavailable-source')?.textContent).toBe('/Users/me/shots/mobile.png')
    expect(view.querySelector('.markdown-image-unavailable-alt')).toBeNull()
  })

  it('stays silent for a source the host suppressed on purpose', () => {
    const view = mount('![Mobile](/Users/me/shots/mobile.png)', { label: 'Image not shown', suppressed: true })

    expect(view.querySelector('.markdown-image-unavailable')).toBeNull()
    expect(view.querySelector('.markdown-image-alt')?.textContent).toBe('Mobile')
  })

  it('falls back to the alt text alone when the host supplies no copy', () => {
    const view = mount('![Mobile](/Users/me/shots/mobile.png)')

    expect(view.querySelector('.markdown-image-unavailable')).toBeNull()
    expect(view.querySelector('.markdown-image-alt')?.textContent).toBe('Mobile')
  })
})
