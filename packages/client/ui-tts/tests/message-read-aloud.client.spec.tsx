// @vitest-environment jsdom
/**
 * The read-aloud action beside one settled assistant message: it reads that message from its start on a
 * channel of its own, and turns into the stop control while the message is being read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@aeven/session/types'
import { en } from '../src/client/locales.ts'
import {
  MessageReadAloud, UserReadAloud, type MessageReadAloudProps, type UserReadAloudProps,
} from '../src/client/MessageReadAloud.tsx'
import {
  assistantNode, chatSnapshot, makeT, readAloudState, useChatOf, useReadAloudOf,
} from './harness.client.ts'

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

describe('pause and stop while playing', () => {
  /** The controls for `m1` while it plays, paused or not. */
  function playing(paused: boolean) {
    const pause = vi.fn()
    const resume = vi.fn()
    const stop = vi.fn()
    const props = {
      messageId: 'm1',
      sessionId: SID,
      useChat: useChatOf(chatSnapshot(null, [assistantNode('m1', [{ kind: 'text', text: 'Spoken.' }])])),
      read: vi.fn(),
      stop,
      pause,
      resume,
      useReadAloud: useReadAloudOf(readAloudState({ enabled: [CHANNEL], speaking: [CHANNEL], paused: paused ? [CHANNEL] : [] })),
      t,
    } as unknown as MessageReadAloudProps
    render(<MessageReadAloud {...props} />)
    return { pause, resume, stop }
  }

  it('shows pause before stop, and pause holds the reading', () => {
    const { pause } = playing(false)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual([en['message.pause'], en['message.stop']])
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(buttons[0]!)
    expect(pause).toHaveBeenCalledWith(CHANNEL)
  })

  it('offers resume while paused, pressed, and stop ends the reading', () => {
    const { resume, stop } = playing(true)
    const hold = screen.getByRole('button', { name: en['message.resume'] })
    expect(hold.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(hold)
    expect(resume).toHaveBeenCalledWith(CHANNEL)
    fireEvent.click(screen.getByRole('button', { name: en['message.stop'] }))
    expect(stop).toHaveBeenCalledWith(CHANNEL)
  })
})

describe('a reading that fails', () => {
  it('returns to the read glyph with the reason instead of spinning', () => {
    const { props, rerender } = action()
    fireEvent.click(screen.getByRole('button', { name: en['message.read'] }))
    rerender(<MessageReadAloud {...{
      ...props,
      useReadAloud: useReadAloudOf(readAloudState({ enabled: [CHANNEL], failed: [CHANNEL] })),
    } as unknown as MessageReadAloudProps} />)

    const idle = screen.getByRole('button', { name: en['message.failed'] })
    expect(idle.getAttribute('aria-busy')).toBeNull()
  })

  it('leaves the spinner when the engine never reports anything', () => {
    vi.useFakeTimers()
    try {
      action()
      fireEvent.click(screen.getByRole('button', { name: en['message.read'] }))
      expect(screen.getByRole('button', { name: en.loading })).toBeDefined()
      act(() => { vi.advanceTimersByTime(8_000) })
      expect(screen.getByRole('button', { name: en['message.read'] })).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a user prompt', () => {
  it('reads the prompt text on a channel named by its sequence', () => {
    const read = vi.fn()
    const props = {
      seq: 7,
      text: '  Read my prompt.  ',
      sessionId: SID,
      read,
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      useReadAloud: useReadAloudOf(readAloudState()),
      t,
    } as unknown as UserReadAloudProps
    render(<UserReadAloud {...props} />)
    fireEvent.click(screen.getByRole('button', { name: en['message.read'] }))
    expect(read).toHaveBeenCalledWith('prompt:7', 'Read my prompt.')
  })

  it('renders nothing for a prompt with no prose', () => {
    render(<UserReadAloud {...{
      seq: 8, text: '   ', sessionId: SID, read: vi.fn(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(),
      useReadAloud: useReadAloudOf(readAloudState()), t,
    } as unknown as UserReadAloudProps} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
