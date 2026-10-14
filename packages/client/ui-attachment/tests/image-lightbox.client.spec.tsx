// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { ImageLightbox } from '@aeven/client-ui-primitives'
import type { ImageLightboxLabels } from '@aeven/client-ui-primitives'

afterEach(cleanup)

const labels: ImageLightboxLabels = {
  dialog: '原图预览',
  close: '关闭原图预览',
  previous: '上一张图片',
  next: '下一张图片',
  download: '下载图片',
  info: '图片信息',
  infoType: '图片类型：',
  infoSize: '文件大小：',
  infoName: '文件名：',
  unknown: '未知',
  megabytes: value => `${value} MB`,
}

const one = [{ src: 'blob:original', alt: '原图' }]
const two = [
  { src: 'blob:first', alt: '第一张', name: 'first.png', mediaType: 'image/png', bytes: 180_000 },
  { src: 'blob:second', alt: '第二张' },
]

/**
 * End the dialog's fade-out. React resolves its animation listener against the
 * style properties the environment reports, and jsdom reports the prefixed
 * `WebkitAnimation`, so the event the component's `onAnimationEnd` receives
 * here is the prefixed one.
 * @param dialog - the gallery dialog mid-fade.
 */
function finishFadeOut(dialog: HTMLElement): void {
  fireEvent(dialog, new Event('webkitAnimationEnd', { bubbles: true }))
}

function selectedSrc(): string | null {
  return document.querySelector('[data-selected] img')?.getAttribute('src') ?? null
}

describe('ImageLightbox', () => {
  it('focuses its close control, closes by button and Escape after the fade-out, and restores focus', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const onClose = vi.fn()
    const view = render(<ImageLightbox images={one} index={0} labels={labels} onClose={onClose} />)
    const close = view.getByRole('button', { name: '关闭原图预览' })
    const dialog = view.getByRole('dialog')
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(window, { key: 'a' })
    expect(dialog.hasAttribute('data-closing')).toBe(false)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(dialog.hasAttribute('data-closing')).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
    finishFadeOut(dialog)
    fireEvent.click(close)
    finishFadeOut(dialog)
    expect(onClose).toHaveBeenCalledTimes(2)
    view.unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('tolerates a focus owner it cannot restore (no active element at mount)', () => {
    // jsdom always reports body as the fallback active element; stub the
    // element-less state a detached focus can leave.
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => null })
    try {
      const view = render(<ImageLightbox images={one} index={0} labels={labels} onClose={vi.fn()} />)
      view.unmount()
    } finally {
      delete (document as { activeElement?: unknown }).activeElement
    }
  })

  it('offers previous and next only for several images, wrapping by button and arrow key', () => {
    const single = render(<ImageLightbox images={one} index={0} labels={labels} onClose={vi.fn()} />)
    expect(single.queryByRole('button', { name: '下一张图片' })).toBeNull()
    single.unmount()

    const view = render(<ImageLightbox images={two} index={1} labels={labels} onClose={vi.fn()} />)
    expect(selectedSrc()).toBe('blob:second')
    fireEvent.click(view.getByRole('button', { name: '下一张图片' }))
    expect(selectedSrc()).toBe('blob:first')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(selectedSrc()).toBe('blob:second')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(selectedSrc()).toBe('blob:first')
    fireEvent.click(view.getByRole('button', { name: '上一张图片' }))
    expect(selectedSrc()).toBe('blob:second')
  })

  it('shows the selected image type, size, and name in the info popover, with unknown for missing fields', () => {
    const view = render(<ImageLightbox images={two} index={0} labels={labels} onClose={vi.fn()} />)
    const info = view.getByRole('button', { name: '图片信息' })
    fireEvent.click(info)
    const popover = view.getByRole('status')
    expect(popover.textContent).toBe('图片类型：image/png文件大小：0.18 MB文件名：first.png')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(view.getByRole('status').textContent).toBe('图片类型：未知文件大小：未知文件名：未知')
    fireEvent.pointerDown(document.body)
    expect(view.queryByRole('status')).toBeNull()
  })

  it('reads type and size from the source for a caller that supplied neither, once per source', async () => {
    const images = [{ src: 'http://localhost:3000/api/file?path=%2Ftmp%2Fchart.webp', alt: '图' }]
    let release: ((response: Response) => void) | undefined
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const view = render(<ImageLightbox images={images} index={0} labels={labels} onClose={vi.fn()} />)
      fireEvent.click(view.getByRole('button', { name: '图片信息' }))
      // A re-render while the read is still in flight must not start a second one.
      view.rerender(<ImageLightbox images={[...images]} index={0} labels={labels} onClose={vi.fn()} />)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      release?.(new Response(new Uint8Array(512_000), { headers: { 'content-type': 'image/webp' } }))
      await waitFor(() => {
        expect(view.getByRole('status').textContent).toBe('图片类型：image/webp文件大小：0.51 MB文件名：chart.webp')
      })
      view.rerender(<ImageLightbox images={[...images]} index={0} labels={labels} onClose={vi.fn()} />)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps unknown for a source whose bytes it cannot read or that reports no type', async () => {
    const blocked = vi.fn(async () => { throw new Error('blocked') })
    vi.stubGlobal('fetch', blocked)
    try {
      const view = render(<ImageLightbox images={[{ src: 'http://localhost:3000/', alt: '图' }]} index={0} labels={labels} onClose={vi.fn()} />)
      fireEvent.click(view.getByRole('button', { name: '图片信息' }))
      await waitFor(() => { expect(blocked).toHaveBeenCalledTimes(1) })
      expect(view.getByRole('status').textContent).toBe('图片类型：未知文件大小：未知文件名：未知')
      view.unmount()
    } finally {
      vi.unstubAllGlobals()
    }

    // A failing response and an untyped payload each leave the unreadable field unknown.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    try {
      const view = render(<ImageLightbox images={[{ src: 'http://localhost:3000/failed', alt: '图' }]} index={0} labels={labels} onClose={vi.fn()} />)
      fireEvent.click(view.getByRole('button', { name: '图片信息' }))
      await waitFor(() => { expect(view.getByRole('status').textContent).toContain('文件大小：未知') })
      view.unmount()
    } finally {
      vi.unstubAllGlobals()
    }

    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(2048))))
    try {
      const view = render(<ImageLightbox images={[{ src: 'http://localhost:3000/untyped', alt: '图' }]} index={0} labels={labels} onClose={vi.fn()} />)
      fireEvent.click(view.getByRole('button', { name: '图片信息' }))
      await waitFor(() => {
        expect(view.getByRole('status').textContent).toBe('图片类型：未知文件大小：0.00 MB文件名：untyped')
      })
      view.unmount()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reads no source whose caller reported both type and size', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      const view = render(<ImageLightbox images={two} index={0} labels={labels} onClose={vi.fn()} />)
      fireEvent.click(view.getByRole('button', { name: '图片信息' }))
      expect(view.getByRole('status').textContent).toBe('图片类型：image/png文件大小：0.18 MB文件名：first.png')
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('renders nothing without images and drops a metadata read that settles after unmount', async () => {
    const empty = render(<ImageLightbox images={[]} index={0} labels={labels} onClose={vi.fn()} />)
    expect(empty.container.firstChild).toBeNull()
    empty.unmount()

    let release: ((response: Response) => void) | undefined
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const view = render(<ImageLightbox images={[{ src: 'http://localhost:3000/late.png', alt: '图' }]} index={0} labels={labels} onClose={vi.fn()} />)
      fireEvent.click(view.getByRole('button', { name: '图片信息' }))
      view.unmount()
      release?.(new Response(new Uint8Array(8), { headers: { 'content-type': 'image/png' } }))
      await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
