// @vitest-environment jsdom
//
// A host can name an image's displayable URL only after the image rendered:
// a stored copy becomes known when older history arrives. A new `resolveImage`
// re-resolves images already on screen, including those in cached blocks.
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

const MD = 'Before.\n\n![Mobile](/Users/me/shots/mobile.png)\n\nAfter.'

function render(resolveImage: (src: string) => string | undefined) {
  act(() => { root!.render(<HyperMarkdown md={MD} resolveImage={resolveImage} />) })
}

describe('a resolver that changes after an image rendered', () => {
  it('re-resolves the image already on screen', () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    render(src => `https://app.test/api/file?path=${encodeURIComponent(src)}`)
    expect(host.querySelector('img')?.getAttribute('src')).toContain('/api/file')

    render(src => src.endsWith('mobile.png') ? 'https://app.test/api/attachment-image?id=sha256:1' : undefined)
    expect(host.querySelector('img')?.getAttribute('src')).toBe('https://app.test/api/attachment-image?id=sha256:1')
  })
})
