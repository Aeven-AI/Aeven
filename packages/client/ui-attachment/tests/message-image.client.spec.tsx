// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { AttachmentId } from '@aeven/attachment'
import { EMPTY_CHAT_SNAPSHOT, type MessageImagesProps } from '@aeven/client-ui-chat/client'
import { EMPTY_CONVERSATION_SNAPSHOT } from '@aeven/client-ui-conversation/client'
import { ImageGallery, MessageImage } from '../src/MessageImage.tsx'
import type { MessageImageLabels } from '../src/MessageImage.tsx'
import { MessageImages } from '../src/client/MessageImages.tsx'

afterEach(cleanup)

/** A tile's open action, which the gallery group owns in production. */
const noopOpen = (): void => {}

const labels: MessageImageLabels = {
  image: '图片',
  open: '查看原图',
  openNamed: label => `${label}，点击查看原图`,
  loading: '图片加载中…',
  loadFailed: '图片加载失败，点击重试',
  lightbox: {
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
  },
}

const attachment = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png' as const,
  bytes: 68,
  width: 640,
  height: 320,
  name: 'history.png',
}

type AttentionSnapshot = Parameters<Parameters<MessageImagesProps['useSessionPendingInteraction']>[0]>[0]
type TrajectorySnapshot = Parameters<Parameters<MessageImagesProps['useTrajectory']>[0]>[0]

const noAttention: AttentionSnapshot = new Map()
const emptyTrajectory: TrajectorySnapshot = {
  eventNodes: [],
  eventLocations: new Map(),
  requests: [],
  callSchemas: new Map(),
  partial: null,
  runningCalls: [],
}
const useSessionPendingInteraction: MessageImagesProps['useSessionPendingInteraction'] = selector => selector(noAttention)
const useConversation: MessageImagesProps['useConversation'] = selector => selector(EMPTY_CONVERSATION_SNAPSHOT)
const useChat: MessageImagesProps['useChat'] = selector => selector(EMPTY_CHAT_SNAPSHOT)
const useTrajectory: MessageImagesProps['useTrajectory'] = selector => selector(emptyTrajectory)

describe('MessageImage', () => {
  it('renders a cached URL on the first frame while refreshing it', () => {
    const load = Object.assign(vi.fn(() => new Promise<string>(() => {})), {
      peek: vi.fn(() => 'blob:seeded'),
    })
    const view = render(<MessageImage image={{ attachment }} load={load} variant="single" labels={labels}  onOpen={noopOpen} />)
    expect(view.queryByText('图片加载中…')).toBeNull()
    expect((view.getByAltText('history.png') as HTMLImageElement).src).toContain('blob:seeded')
    expect(load).toHaveBeenCalledWith(attachment)
  })

  it('loads a session-authorized URL, bounds the thumbnail, and clicks into the original', async () => {
    const load = vi.fn().mockResolvedValue('blob:history')
    const view = render(<MessageImage image={{ attachment }} load={load} variant="single" labels={labels}  onOpen={noopOpen} />)
    const frame = view.getByRole('button', { name: 'history.png，点击查看原图' })
    expect(frame.getAttribute('style')).toContain('width: 240px')
    expect(frame.getAttribute('style')).toContain('height: 120px')
    expect(frame.getAttribute('title')).toBe('查看原图')
    await waitFor(() => { expect(view.getByAltText('history.png')).toBeTruthy() })
    expect(load).toHaveBeenCalledWith(attachment)
    fireEvent.click(frame)
    expect(view.queryByRole('dialog', { name: '原图预览' })).toBeNull()
  })

  it('ignores a click while the thumbnail is still loading', () => {
    const load = vi.fn(() => new Promise<string>(() => {}))
    const view = render(<MessageImage image={{ attachment }} load={load} variant="single" labels={labels}  onOpen={noopOpen} />)
    const frame = view.getByRole('button', { name: 'history.png，点击查看原图' })
    expect(view.getByText('图片加载中…')).toBeTruthy()
    fireEvent.click(frame)
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('falls back to the image label for an unnamed attachment', async () => {
    const { name: _named, ...unnamed } = attachment
    const load = vi.fn().mockResolvedValue('blob:unnamed')
    const view = render(<MessageImage image={{ attachment: unnamed }} load={load} variant="single" labels={labels}  onOpen={noopOpen} />)
    await waitFor(() => { expect(view.getByAltText('图片')).toBeTruthy() })
    expect(view.getByRole('button', { name: '图片，点击查看原图' })).toBeTruthy()
  })

  it('surfaces a retry control when durable bytes cannot be read, including a failed retry', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('still offline'))
      .mockResolvedValueOnce('blob:retry')
    const view = render(<MessageImage image={{ attachment }} load={load} variant="single" labels={labels}  onOpen={noopOpen} />)
    const retry = await view.findByRole('button', { name: '图片加载失败，点击重试' })
    fireEvent.click(retry)
    const retryAgain = await view.findByRole('button', { name: '图片加载失败，点击重试' })
    fireEvent.click(retryAgain)
    await waitFor(() => { expect(view.getByAltText('history.png')).toBeTruthy() })
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('clamps extreme aspect ratios and anchors the crop toward the informative edge', async () => {
    const load = vi.fn().mockResolvedValue('blob:ratio')
    const tall = render(
      <MessageImage image={{ attachment: { ...attachment, width: 100, height: 2000 } }} load={load} variant="single" labels={labels}  onOpen={noopOpen} />,
    )
    const tallFrame = tall.getByRole('button', { name: 'history.png，点击查看原图' })
    expect(tallFrame.getAttribute('style')).toContain('width: 60px')
    expect(tallFrame.getAttribute('style')).toContain('height: 240px')
    await waitFor(() => { expect(tall.getByAltText('history.png')).toBeTruthy() })
    expect(tall.getByAltText('history.png').style.objectPosition).toBe('center top')
    tall.unmount()
    const wide = render(
      <MessageImage image={{ attachment: { ...attachment, width: 4000, height: 100 } }} load={load} variant="single" labels={labels}  onOpen={noopOpen} />,
    )
    const wideFrame = wide.getByRole('button', { name: 'history.png，点击查看原图' })
    expect(wideFrame.getAttribute('style')).toContain('width: 240px')
    expect(wideFrame.getAttribute('style')).toContain('height: 60px')
    await waitFor(() => { expect(wide.getByAltText('history.png')).toBeTruthy() })
    expect(wide.getByAltText('history.png').style.objectPosition).toBe('left center')
    wide.unmount()
    const small = render(
      <MessageImage image={{ attachment: { ...attachment, width: 100, height: 100 } }} load={load} variant="single" labels={labels}  onOpen={noopOpen} />,
    )
    const smallFrame = small.getByRole('button', { name: 'history.png，点击查看原图' })
    expect(smallFrame.getAttribute('style')).toContain('width: 100px')
    expect(smallFrame.getAttribute('style')).toContain('height: 100px')
  })

  it('renders a tile at the fixed square without inline sizing', () => {
    const load = vi.fn(() => new Promise<string>(() => {}))
    const view = render(<MessageImage image={{ attachment }} load={load} variant="tile" labels={labels}  onOpen={noopOpen} />)
    const frame = view.getByRole('button', { name: 'history.png，点击查看原图' })
    expect(frame.getAttribute('data-variant')).toBe('tile')
    expect(frame.getAttribute('style')).toBeNull()
  })

  it('keeps the tile variant on the failed-load retry control', async () => {
    const load = vi.fn().mockRejectedValue(new Error('offline'))
    const view = render(<MessageImage image={{ attachment }} load={load} variant="tile" labels={labels}  onOpen={noopOpen} />)
    const retry = await view.findByRole('button', { name: '图片加载失败，点击重试' })
    expect(retry.getAttribute('data-variant')).toBe('tile')
  })

  it('ignores a load settling after unmount', async () => {
    let resolve: ((url: string) => void) | undefined
    const load = vi.fn(() => new Promise<string>((r) => { resolve = r }))
    const view = render(<MessageImage image={{ attachment }} load={load} variant="single" labels={labels}  onOpen={noopOpen} />)
    view.unmount()
    resolve?.('blob:late')
    await Promise.resolve()
    let reject: ((error: Error) => void) | undefined
    const failing = vi.fn(() => new Promise<string>((_r, rej) => { reject = rej }))
    const second = render(<MessageImage image={{ attachment }} load={failing} variant="single" labels={labels}  onOpen={noopOpen} />)
    second.unmount()
    reject?.(new Error('late failure'))
    await Promise.resolve()
  })
})

describe('MessageImage preview arm', () => {
  it('displays a local preview immediately, without the loader, sized by its probed dimensions', () => {
    const load = vi.fn()
    const view = render(
      <MessageImage
        image={{ preview: { url: 'blob:echo', name: 'echo.png', width: 640, height: 320 } }}
        load={load}
        variant="single"
        labels={labels}
        onOpen={noopOpen} />,
    )
    expect(load).not.toHaveBeenCalled()
    const img = view.getByAltText('echo.png') as HTMLImageElement
    expect(img.src).toContain('blob:echo')
    const frame = img.closest('button') as HTMLButtonElement
    expect(frame.style.width).toBe('240px')
    expect(frame.style.height).toBe('120px')
  })

  it('sizes an unprobed lone preview as a square crop and falls back to the image label', () => {
    const load = vi.fn()
    const view = render(
      <MessageImage image={{ preview: { url: 'blob:unprobed' } }} load={load} variant="single" labels={labels}  onOpen={noopOpen} />,
    )
    const img = view.getByAltText('图片') as HTMLImageElement
    const frame = img.closest('button') as HTMLButtonElement
    expect(frame.style.width).toBe('240px')
    expect(frame.style.height).toBe('240px')
  })

  it('opens the group preview from a preview thumbnail', () => {
    const view = render(
      <ImageGallery images={[{ preview: { url: 'blob:box' } }]} load={vi.fn(async () => '')} align="start" labels={labels} />,
    )
    fireEvent.click(view.getByRole('button', { name: '图片，点击查看原图' }))
    expect(view.getByRole('dialog', { name: '原图预览' })).toBeTruthy()
  })
})

describe('ImageGallery', () => {
  it('navigates every image of the Turn, not only this record\'s group', async () => {
    const other = { ...attachment, attachmentId: AttachmentId(`sha256:${'b'.repeat(64)}`), name: 'other.png' }
    const load = vi.fn(async (reference: { readonly attachmentId: string }) =>
      `blob:${String(reference.attachmentId).slice(-4)}`)
    const view = render(
      <ImageGallery
        images={[{ attachment }]}
        turnImages={[{ attachment }, { attachment: other }]}
        load={load}
        align="start"
        labels={labels}
      />,
    )
    // The tile opens only once its own URL resolved, as in production.
    await waitFor(() => { expect(view.getByAltText('history.png')).toBeTruthy() })
    fireEvent.click(view.getByRole('button', { name: 'history.png，点击查看原图' }))
    const dialog = view.getByRole('dialog', { name: '原图预览' })
    const selectedSrc = (): string =>
      dialog.querySelector('[data-selected] img')?.getAttribute('src') ?? ''
    await waitFor(() => { expect(selectedSrc()).toContain('aaaa') })
    // Previous/next exist only because the preview holds more than one image.
    fireEvent.click(view.getByRole('button', { name: '下一张图片' }))
    await waitFor(() => { expect(selectedSrc()).toContain('bbbb') })
  })

  it('keeps the preview on this record when the Turn scope is absent', async () => {
    const load = vi.fn().mockResolvedValue('blob:alone')
    const view = render(<ImageGallery images={[{ attachment }]} load={load} align="start" labels={labels} />)
    await waitFor(() => { expect(view.getByAltText('history.png')).toBeTruthy() })
    fireEvent.click(view.getByRole('button', { name: 'history.png，点击查看原图' }))
    expect(view.getByRole('dialog', { name: '原图预览' })).toBeTruthy()
    expect(view.queryByRole('button', { name: '下一张图片' })).toBeNull()
  })

  it('renders nothing without images and an aligned wrapping group with them', async () => {
    const load = vi.fn().mockResolvedValue('blob:gallery')
    const empty = render(<ImageGallery images={[]} load={load} align="start" labels={labels} />)
    expect(empty.container.firstChild).toBeNull()
    const view = render(
      <ImageGallery
        images={[{ attachment }, { preview: { url: 'blob:echo', name: 'echo.png' } }, { attachment }]}
        load={load}
        align="end"
        labels={labels}
      />,
    )
    expect(view.container.querySelector('[data-align="end"]')).not.toBeNull()
    await waitFor(() => { expect(view.getAllByAltText('history.png')).toHaveLength(2) })
    expect(view.getByAltText('echo.png')).toBeTruthy()
  })

  it('renders a lone image large and several images as square tiles', () => {
    const load = vi.fn(() => new Promise<string>(() => {}))
    const lone = render(<ImageGallery images={[{ attachment }]} load={load} align="start" labels={labels} />)
    expect(lone.container.querySelectorAll('[data-variant="single"]')).toHaveLength(1)
    lone.unmount()
    const several = render(
      <ImageGallery images={[{ attachment }, { attachment }, { attachment }]} load={load} align="end" labels={labels} />,
    )
    expect(several.container.querySelectorAll('[data-variant="tile"]')).toHaveLength(3)
  })

  it('renders the conversation slot entry with translated labels', async () => {
    const loadImage = vi.fn().mockResolvedValue('blob:slot-image')
    const props = messageImagesOwnerProps({ layout: 'gallery', images: [{ attachment }], loadImage })
    const view = render(<MessageImages {...props} />)
    await waitFor(() => { expect(view.getByAltText('history.png')).toBeTruthy() })
    expect(view.getByRole('button', { name: 'history.png，点击查看原图' })).toBeTruthy()
    expect(view.container.querySelector('[data-align="end"]')).not.toBeNull()
  })
})

describe('MessageImages tray', () => {
  it('retains the loaded tile when a submission preview becomes a durable attachment', () => {
    const loadImage = Object.assign(vi.fn().mockResolvedValue('blob:echo'), { peek: () => 'blob:echo' })
    const props = messageImagesOwnerProps({ layout: 'tray', images: [{ preview: { url: 'blob:echo', name: 'history.png' } }], loadImage })
    const view = render(<MessageImages {...props} />)
    const image = view.container.querySelector('img')
    expect(image).not.toBeNull()
    fireEvent.load(image!)
    const loadedClass = image!.parentElement!.className

    view.rerender(<MessageImages {...props} images={[{ attachment }]} />)

    expect(view.container.querySelector('img')).toBe(image)
    expect(image!.parentElement!.className).toBe(loadedClass)
    expect(view.container.querySelector('[role="status"]')).toBeNull()
  })

  it('opens the Turn preview from a sent-message tile and steps through the Turn', async () => {
    const other = { ...attachment, attachmentId: AttachmentId(`sha256:${'b'.repeat(64)}`), name: 'other.png' }
    const loadImage = vi.fn(async (reference: { readonly attachmentId: string }) =>
      `blob:${String(reference.attachmentId).slice(-4)}`)
    const view = render(<MessageImages {...messageImagesOwnerProps({
      layout: 'tray',
      images: [{ attachment }],
      turnImages: [{ attachment }, { attachment: other }],
      loadImage,
    })} />)

    // The tile opens only once its own thumbnail URL resolved, as in production.
    await waitFor(() => { expect(view.container.querySelector('img[src="blob:aaaa"]')).not.toBeNull() })
    fireEvent.click(view.getByRole('button', { name: 'history.png，点击查看原图' }))
    const dialog = view.getByRole('dialog', { name: '原图预览' })
    const selectedSrc = (): string => dialog.querySelector('[data-selected] img')?.getAttribute('src') ?? ''
    await waitFor(() => { expect(selectedSrc()).toBe('blob:aaaa') })
    // Previous/next exist only because the preview holds the whole Turn's images.
    fireEvent.click(view.getByRole('button', { name: '下一张图片' }))
    await waitFor(() => { expect(selectedSrc()).toBe('blob:bbbb') })
  })

  it('reports the sent image name, media type, and byte size in the preview info', async () => {
    const screenshot = {
      ...attachment,
      attachmentId: AttachmentId(`sha256:${'c'.repeat(64)}`),
      mediaType: 'image/webp' as const,
      bytes: 328_008,
      name: 'Screenshot 2026-10-08 at 01.35.15.png',
    }
    const view = render(<MessageImages {...messageImagesOwnerProps({
      layout: 'tray',
      images: [{ attachment: screenshot }],
      loadImage: vi.fn().mockResolvedValue('blob:info'),
    })} />)

    await waitFor(() => { expect(view.container.querySelector('img[src="blob:info"]')).not.toBeNull() })
    fireEvent.click(view.getByRole('button', { name: 'Screenshot 2026-10-08 at 01.35.15.png，点击查看原图' }))
    fireEvent.click(view.getByRole('button', { name: '图片信息' }))
    expect(view.getByRole('status').textContent).toMatchInlineSnapshot(
      '"图片类型：image/webp文件大小：0.33 MB文件名：Screenshot 2026-10-08 at 01.35.15.png"',
    )
  })

  it('titles an unnamed durable image with the name derived from its digest', async () => {
    const { name: _stored, ...unnamedRef } = attachment
    const unnamed = { ...unnamedRef, attachmentId: AttachmentId(`sha256:${'d'.repeat(64)}`) }
    const view = render(<MessageImages {...messageImagesOwnerProps({
      layout: 'tray',
      images: [{ attachment: unnamed }],
      loadImage: vi.fn().mockResolvedValue('blob:unnamed'),
    })} />)

    await waitFor(() => { expect(view.container.querySelector('img[src="blob:unnamed"]')).not.toBeNull() })
    fireEvent.click(view.getByRole('button', { name: '图片，点击查看原图' }))
    fireEvent.click(view.getByRole('button', { name: '图片信息' }))
    expect(view.getByRole('status').textContent).toMatchInlineSnapshot(
      '"图片类型：image/png文件大小：0.00 MB文件名：dddddddddddd.png"',
    )
  })

  it('opens the preview from a submission echo tile before its admission', async () => {
    const view = render(<MessageImages {...messageImagesOwnerProps({
      layout: 'tray',
      images: [{ preview: { url: 'blob:echo', name: 'echo.png' } }],
    })} />)

    fireEvent.click(view.getByRole('button', { name: 'echo.png，点击查看原图' }))
    const dialog = view.getByRole('dialog', { name: '原图预览' })
    expect(dialog.querySelector('[data-selected] img')?.getAttribute('src')).toBe('blob:echo')
    expect(view.queryByRole('button', { name: '下一张图片' })).toBeNull()
  })
})

/** Translator stub for the conversation namespace keys the message-image slot reads. */
const slotT = ((key: string, params?: Readonly<Record<string, unknown>>) => {
  const translated: Record<string, string> = {
    'image.label': '图片',
    'image.openOriginal': '查看原图',
    'image.loading': '图片加载中…',
    'image.loadFailed': '图片加载失败，点击重试',
    'image.preview': '原图预览',
    'image.closePreview': '关闭原图预览',
    'image.previous': '上一张图片',
    'image.next': '下一张图片',
    'image.download': '下载图片',
    'image.info': '图片信息',
    'image.infoType': '图片类型：',
    'image.infoSize': '文件大小：',
    'image.infoName': '文件名：',
    'image.infoUnknown': '未知',
  }
  if (key === 'image.openOriginalLabel') {
    const label = params?.label
    return `${typeof label === 'string' ? label : ''}，点击查看原图`
  }
  if (key === 'image.megabytes') return `${String(params?.value)} MB`
  return translated[key] ?? key
}) as MessageImagesProps['t']

/**
 * The conversation slot's owner props for one record, with the standing seats
 * the message-image slot never reads stubbed to fail loudly.
 * @param owner - the layout, images, and optional Turn scope and loader under test.
 * @returns props the assembled slot renders from.
 */
function messageImagesOwnerProps(
  owner: Pick<MessageImagesProps, 'layout' | 'images'> & Partial<Pick<MessageImagesProps, 'turnImages' | 'loadImage'>>,
): MessageImagesProps {
  const unread = (name: string) => (): never => { throw new Error(`MessageImages does not read ${name}`) }
  return {
    sessionId: 'message-images-test' as MessageImagesProps['sessionId'],
    useSession: unread('the session snapshot'),
    useInput: unread('the input snapshot'),
    useSessions: unread('the session list snapshot'),
    useWorkspaces: unread('the workspace list snapshot'),
    useSessionPendingInteraction,
    useProjection: () => undefined,
    useConversation,
    useChat,
    useTrajectory,
    inputActions: {
      setDraft: vi.fn(),
      appendText: vi.fn(() => true),
      addImages: vi.fn(() => true),
      removeImage: vi.fn(),
      pruneImages: vi.fn(),
      submit: vi.fn(),
    },
    loadImage: vi.fn().mockResolvedValue('blob:slot-image'),
    align: 'end',
    t: slotT,
    ...owner,
  }
}
