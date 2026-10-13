import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@aeven/attachment'
import type { ChatNode } from '../src/client/contract/chat-nodes.ts'
import { turnImagesOf } from '../src/client/contract/turn-images.ts'

const first = { attachmentId: AttachmentId(`sha256:${'1'.repeat(64)}`), mediaType: 'image/png' as const, bytes: 10, width: 4, height: 4, name: 'first.png' }
const second = { attachmentId: AttachmentId(`sha256:${'2'.repeat(64)}`), mediaType: 'image/png' as const, bytes: 20, width: 4, height: 4, name: 'second.png' }
const third = { attachmentId: AttachmentId(`sha256:${'3'.repeat(64)}`), mediaType: 'image/png' as const, bytes: 30, width: 4, height: 4, name: 'third.png' }

function node(turn: number, data: unknown, anchorSeq: number, kind: string): ChatNode {
  return {
    key: `${kind}:${String(anchorSeq)}`,
    kind,
    id: String(anchorSeq),
    target: 'chat',
    anchorSeq,
    location: { kind: 'turn', turn: { turn } },
    visibility: 'visible',
    data,
  } as unknown as ChatNode
}

describe('turnImagesOf', () => {
  it('collects one Turn in flow order across message, tool, and assistant rows', () => {
    const nodes = [
      node(1, { content: [{ type: 'text', text: 'hi' }, { type: 'image', attachment: first }] }, 1, 'user'),
      node(1, {
        root: {
          kind: 'tool-result',
          callId: 'call-1',
          isError: false,
          content: [{ type: 'text', text: 'done' }, { type: 'image', attachment: second }],
          subCalls: [{
            kind: 'tool-result',
            callId: 'call-2',
            isError: false,
            content: [{ type: 'image', attachment: third }],
            subCalls: [],
          }],
        },
      }, 2, 'tool-call'),
      node(1, { blocks: [{ kind: 'image', attachment: second }] }, 3, 'assistant-step'),
    ]
    expect([...(turnImagesOf(nodes).get(1) ?? [])]).toEqual([
      { attachment: first }, { attachment: second }, { attachment: third },
    ])
  })

  it('leaves out a running call, a failed result, and a row without Turn coordinates', () => {
    const running = node(2, { root: { callId: 'call-3', name: 'generate_image', argsRaw: '{}', subCalls: [] } }, 4, 'tool-call')
    const failed = node(2, {
      root: {
        kind: 'tool-result', callId: 'call-4', isError: true,
        content: [{ type: 'image', attachment: first }], subCalls: [],
      },
    }, 5, 'tool-call')
    const sessionScoped = {
      ...node(2, { blocks: [{ kind: 'image', attachment: second }] }, 6, 'assistant-step'),
      location: { kind: 'session' },
    } as unknown as ChatNode
    expect(turnImagesOf([running, failed, sessionScoped]).get(2)).toEqual([])
  })

  it('keeps a preview source and reports a Turn with no images as an empty list', () => {
    const preview = node(3, { content: [{ type: 'image', attachment: first }] }, 7, 'user')
    const byTurn = turnImagesOf([
      preview,
      node(3, { blocks: [{ kind: 'text', text: 'no image here' }] }, 8, 'assistant-step'),
      node(4, { content: [] }, 9, 'user'),
    ])
    expect(byTurn.get(3)).toEqual([{ attachment: first }])
    expect(byTurn.get(4)).toEqual([])
  })
})
