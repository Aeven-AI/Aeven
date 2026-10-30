// @vitest-environment jsdom
/**
 * The read-aloud action beside one settled assistant message: it reads that message from its start on a
 * channel of its own, and turns into the stop control while the message is being read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@aeven/session/types'
import { en } from '../src/client/locales.ts'
import { MessageReadAloud, type MessageReadAloudProps } from '../src/client/MessageReadAloud.tsx'
import {
  assistantNode, chatSnapshot, makeT, readAloudState, useChatOf, useReadAloudOf,
} from './harness.ts'

const SID = 's1' as SessionId
const CHANNEL = 'message:m1'
const t = makeT()

afterEach(cleanup)

/**
 * The action for message `m1`, whose text is `spoken`, over fixed engine state.
 * @param options - published states and the message's blocks.
 * @returns the render result and the stand-in reading operations.
 */
function action(options: {
  loading?: boolean
  speaking?: boolean
  blocks?: Parameters<typeof assistantNode>[1]
} = {}) {
  const read = vi.fn()
  const stop = vi.fn()
  const blocks = options.blocks ?? [{ kind: 'text', text: 'First paragraph.' }, { kind: 'text', text: 'Second paragraph.' }]
  const state = readAloudState({
    loading: options.loading === true ? [CHANNEL] : [],
    speaking: options.speaking === true ? [CHANNEL] : [],
  })
  const props = {
    messageId: 'm1',
    sessionId: SID,
    useChat: useChatOf(chatSnapshot(null, [assistantNode('m1', blocks), assistantNode('m2', [{ kind: 'text', text: 'Other.' }], 2)])),
    read,
    stop,
    useReadAloud: useReadAloudOf(state),
    t,
  } as unknown as MessageReadAloudProps
  const view = render(<MessageReadAloud {...props} />)
  return { ...view, props, read, stop }
}

describe('messages without prose', () => {
  it('renders nothing for a message that only reasoned or called a tool', () => {
    action({ blocks: [{ kind: 'reasoning', text: 'thinking it over' }, { kind: 'tool-call', callId: 'c1', name: 'read', argsRaw: '{}' }] })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders nothing for a message id the conversation does not hold', () => {
    const read = vi.fn()
    render(<MessageReadAloud {...{
      messageId: 'missing',
      sessionId: SID,
      useChat: useChatOf(chatSnapshot(null, [assistantNode('m1', [{ kind: 'text', text: 'Spoken.' }])])),
      read,
      stop: vi.fn(),
      useReadAloud: useReadAloudOf(readAloudState()),
      t,
    } as unknown as MessageReadAloudProps} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('reading one message', () => {
  it('reads the message text from its start on its own channel', () => {
    const { read } = action()
    fireEvent.click(screen.getByRole('button', { name: en['message.read'] }))

    expect(read).toHaveBeenCalledWith(CHANNEL, 'First paragraph.\n\nSecond paragraph.')
  })

  it('shows a spinner from the tap until the first fragment is audible', () => {
    const { props, rerender } = action()
    fireEvent.click(screen.getByRole('button', { name: en['message.read'] }))

    const busy = screen.getByRole('button', { name: en.loading })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect(busy.getAttribute('aria-pressed')).toBe('true')

    rerender(<MessageReadAloud {...{
      ...props,
      useReadAloud: useReadAloudOf(readAloudState({ speaking: [CHANNEL] })),
    } as unknown as MessageReadAloudProps} />)
    const playing = screen.getByRole('button', { name: en['message.stop'] })
    expect(playing.getAttribute('aria-busy')).toBeNull()
  })

  it('shows the spinner while the engine synthesizes the first fragment', () => {
    action({ loading: true })
    expect(screen.getByRole('button', { name: en.loading }).getAttribute('aria-busy')).toBe('true')
  })
})

describe('stopping one message', () => {
  it('stops a message that is playing', () => {
    const { stop } = action({ speaking: true })
    fireEvent.click(screen.getByRole('button', { name: en['message.stop'] }))

    expect(stop).toHaveBeenCalledWith(CHANNEL)
  })

  it('stops a message whose first fragment is still being synthesized', () => {
    const { stop } = action()
    fireEvent.click(screen.getByRole('button', { name: en['message.read'] }))
    fireEvent.click(screen.getByRole('button', { name: en.loading }))

    expect(stop).toHaveBeenCalledWith(CHANNEL)
    expect(screen.getByRole('button', { name: en['message.read'] })).toBeDefined()
  })

  it('stops a message the engine reports as synthesizing before any tap', () => {
    const { stop } = action({ loading: true })
    fireEvent.click(screen.getByRole('button', { name: en.loading }))

    expect(stop).toHaveBeenCalledWith(CHANNEL)
  })
})
