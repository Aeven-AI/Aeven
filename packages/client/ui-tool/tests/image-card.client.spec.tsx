// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { RunningToolCall, ToolResultNode } from '@aeven/client-ui-chat/client'
import type { ImageAttachmentRef } from '@aeven/attachment'
import { makeTranslate } from '@aeven/client-test-runtime'
import { zh as commonZh } from '@aeven/client-locale/src/locales/zh.ts'
import { zh } from '@aeven/client-ui-conversation/src/client/locales.ts'
import { imageCardModel } from '../src/client/tool/models/image-card-model.ts'
import { GenericToolCard } from '../src/client/tool/toolviews/GenericToolCard.tsx'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh)

const ref = (id: string): ImageAttachmentRef => ({
  attachmentId: id as ImageAttachmentRef['attachmentId'],
  mediaType: 'image/png',
  bytes: 32,
  width: 4,
  height: 4,
})

const settled = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'codex_image_generate', argsRaw: '{"prompt":"a fox"}' },
  callTime: 1_000,
  content: [{ type: 'text', text: 'Generated 1 image.' }, { type: 'image', attachment: ref('a1') }],
  isError: false,
  subCalls: [],
  ...over,
})

const running: RunningToolCall = {
  callId: 'c1',
  name: 'codex_image_generate',
  argsRaw: '{"prompt":"a fox"}',
  turn: 1,
  step: 1,
  time: 1_000,
  subCalls: [],
}

describe('imageCardModel', () => {
  it('collects durable image attachments in content order', () => {
    const block = settled({
      content: [
        { type: 'image', attachment: ref('a1') },
        { type: 'text', text: 'between' },
        { type: 'image', attachment: ref('a2') },
      ],
    })
    expect(imageCardModel(block).map(image => image.attachmentId)).toEqual(['a1', 'a2'])
  })

  it('yields nothing for a running call, a failed result, or a text-only result', () => {
    expect(imageCardModel(running)).toEqual([])
    expect(imageCardModel(settled({ isError: true }))).toEqual([])
    expect(imageCardModel(settled({ content: [{ type: 'text', text: 'no images' }] }))).toEqual([])
  })
})

describe('GenericToolCard image gallery', () => {
  const owner = {
    callId: 'c1',
    toolName: 'codex_image_generate',
    block: settled(),
    openFile: () => {},
  }

  it('renders result images through the attachment slot without expanding the row', () => {
    const renderImages = vi.fn(() => <div data-testid="gallery" />)
    render(<GenericToolCard {...owner} renderImages={renderImages} t={t} />)
    expect(screen.getByTestId('gallery')).toBeTruthy()
    expect(renderImages).toHaveBeenCalledWith({
      images: [{ attachment: ref('a1') }], align: 'start', layout: 'gallery',
    })
  })

  it('stays text-only when the composition mounts no attachment presentation', () => {
    render(<GenericToolCard {...owner} t={t} />)
    expect(screen.queryByTestId('gallery')).toBeNull()
  })

  it('renders no gallery for a result that carries no images', () => {
    const renderImages = vi.fn(() => <div data-testid="gallery" />)
    render(
      <GenericToolCard
        {...owner}
        block={settled({ content: [{ type: 'text', text: 'no images' }] })}
        renderImages={renderImages}
        t={t}
      />,
    )
    expect(renderImages).not.toHaveBeenCalled()
    expect(screen.queryByTestId('gallery')).toBeNull()
  })
})
