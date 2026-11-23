/**
 * Whether a reply shows its own Markdown image or leaves it to another surface of the Turn: a generated-image frame,
 * or the closed Turn's tail, which draws a produced image only from a copy a tool result shared in full (#761).
 */
import { describe, expect, it } from 'vitest'
import type { ImageAttachmentRef } from '@aeven/attachment'
import { replyImageVisible } from '../src/client/chat/AssistantNodeView.tsx'

const PINK = '/datadrive/apps/aeven-hosted/home/sandbox/accounts/b1b1/chats/Rainbow_High_Set_of_6_Dolls.jpg'
const copy = {
  attachmentId: 'sha256:2abf4a2f', mediaType: 'image/jpeg', bytes: 622650, width: 1736, height: 1830,
} as unknown as ImageAttachmentRef
const tail = { attachmentIds: new Set(['sha256:2abf4a2f']), paths: new Set(['Rainbow_High_Set_of_6_Dolls.jpg']) }

describe('replyImageVisible', () => {
  it('leaves a produced image to the tail when the Turn shared its copy in full', () => {
    const read = { byPath: new Map([[PINK, copy]]), byAttachment: new Map([['sha256:2abf4a2f', copy]]) }
    expect(replyImageVisible(PINK, { cwd: undefined, generated: undefined, read, tailImages: tail })).toBe(false)
  })

  it('keeps a produced image in the reply when the tail cannot draw its copy, so it never disappears from both', () => {
    // `reply-images/stored` recorded the reply's copy, but no tool result of the Turn shared it as an image.
    const read = { byPath: new Map([[PINK, copy]]), byAttachment: new Map() }
    expect(replyImageVisible(PINK, { cwd: undefined, generated: undefined, read, tailImages: tail })).toBe(true)
  })

  it('keeps an image named only by a produced path, which the tail no longer hides by path', () => {
    const context = { cwd: '/w', generated: undefined, read: undefined, tailImages: tail }
    expect(replyImageVisible('Rainbow_High_Set_of_6_Dolls.jpg', context)).toBe(true)
  })

  it('keeps every image while the Turn runs, before its tail is drawn', () => {
    const read = { byPath: new Map([[PINK, copy]]), byAttachment: new Map([['sha256:2abf4a2f', copy]]) }
    expect(replyImageVisible(PINK, { cwd: undefined, generated: undefined, read, tailImages: undefined })).toBe(true)
  })

  it('leaves a generated image to its frame, by path relative to the workspace or by attachment id', () => {
    const generated = { callIds: new Set<string>(), attachmentIds: new Set(['sha256:abc']), sources: new Set(['out/a.png']) }
    const context = { cwd: '/w', generated, read: undefined, tailImages: undefined }
    expect(replyImageVisible('/w/out/a.png', context)).toBe(false)
    expect(replyImageVisible('image:sha256:abc', context)).toBe(false)
    expect(replyImageVisible('/w/out/b.png', context)).toBe(true)
  })
})
