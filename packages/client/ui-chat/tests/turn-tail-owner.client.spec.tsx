// @vitest-environment jsdom
/**
 * The owner the turn tail hands its feature chain: the produced-files feature draws a Turn's images with the
 * conversation's own image renderer, which only this owner can carry to it (#761).
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TurnTailNodeView } from '../src/client/chat/TurnTailNodeView.tsx'
import type { TurnTailOwnerProps } from '../src/client/contract/slots.ts'

afterEach(() => { cleanup() })

describe('TurnTailNodeView', () => {
  it('hands the turn-tail chain the conversation image renderer with the Turn, workspace, and opener', () => {
    const owners: TurnTailOwnerProps[] = []
    const renderSlotChain = vi.fn((_name: string, owner: TurnTailOwnerProps) => {
      owners.push(owner)
      return null
    })
    const renderMessageImages = vi.fn(() => null)
    const openFile = vi.fn()
    const turn = { turn: 9, status: 'closed', data: { get: () => undefined } }
    const props = {
      node: {
        key: 'tail:9',
        kind: 'turn-tail',
        location: { kind: 'turn', turn },
        data: { turn: 9, seq: 20121, time: 0, closing: null, branchUnavailable: false },
      },
      cwd: '/w',
      openFile,
      forkAt: vi.fn(),
      renderSlot: vi.fn(() => null),
      renderSlotChain,
      renderMessageImages,
      t: (key: string) => key,
      useChat: (select: (snapshot: unknown) => unknown) => select({
        locations: { getTurn: () => ['tail:9'] },
        timeline: { turnOrder: [9] },
      }),
      extendedTranscript: false,
    }
    render(<TurnTailNodeView {...(props as unknown as React.ComponentProps<typeof TurnTailNodeView>)} />)

    expect(renderSlotChain).toHaveBeenCalledWith('conversation.chat.turnTail', expect.anything())
    expect(owners[0]).toMatchObject({ seq: 20121, cwd: '/w', openFile, renderImages: renderMessageImages })
    expect(owners[0]?.turn).toBe(turn)
  })
})
