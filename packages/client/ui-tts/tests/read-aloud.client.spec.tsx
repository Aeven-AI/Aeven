// @vitest-environment jsdom
/**
 * The composer's read-aloud toggle: what it says, what it sends to the engine as a reply streams, and
 * the two standing choices that move it without a tap — the stored preference and an agent's request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@aeven/session/types'
import { ENABLED_KEY, writeEnabled } from '../src/client/voices.ts'
import { en } from '../src/client/locales.ts'
import { ReadAloudToggle, type ReadAloudProps } from '../src/client/ReadAloud.tsx'
import {
  chatSnapshot, makeT, partialStep, readAloudState, toolResultNode, useChatOf, useReadAloudOf,
} from './harness.client.ts'

const SID = 's1' as SessionId
const t = makeT()

beforeEach(() => { localStorage.clear() })
afterEach(cleanup)

/**
 * The toggle over fixed engine state and one live step.
 * @param options - live step, published states, and the dictionary seat.
 * @returns the render result and the stand-in engine operations.
 */
function toggle(options: {
  partial?: Parameters<typeof chatSnapshot>[0] | undefined
  nodes?: Parameters<typeof chatSnapshot>[1]
  enabled?: boolean
  loading?: boolean
  speaking?: boolean
  failed?: boolean
} = {}) {
  const setEnabled = vi.fn()
  const sync = vi.fn()
  const finish = vi.fn()
  const state = readAloudState({
    enabled: options.enabled === true ? [SID] : [],
    loading: options.loading === true ? [SID] : [],
    speaking: options.speaking === true ? [SID] : [],
    failed: options.failed === true ? [SID] : [],
  })
  const partial = options.partial === undefined ? partialStep('Hello there.') : options.partial
  const props = {
    sessionId: SID,
    useChat: useChatOf(chatSnapshot(partial, options.nodes)),
    setEnabled,
    sync,
    finish,
    useReadAloud: useReadAloudOf(state),
    t,
  } as unknown as ReadAloudProps
  const view = render(<ReadAloudToggle {...props} />)
  return { ...view, setEnabled, sync, finish, props }
}

describe('idle toggle', () => {
  it('offers to read the replies and asks for reading on a tap', () => {
    const { setEnabled } = toggle()
    const button = screen.getByRole('button', { name: en.read })

    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.getAttribute('aria-busy')).toBeNull()
    expect(button.hasAttribute('data-failed')).toBe(false)

    fireEvent.click(button)
    expect(setEnabled).toHaveBeenCalledWith(SID, true, '1.1', 'Hello there.')
  })

  it('sends the flattened prose of the live step, not its code or reasoning', () => {
    const { setEnabled } = toggle({
      partial: partialStep('', 2, 3, [
        { kind: 'text', text: '**Bold** claim.' },
        { kind: 'reasoning', text: 'thinking it over' },
        { kind: 'tool-call', callId: 'c1', name: 'read', argsRaw: '{}' },
        { kind: 'text', text: 'Second paragraph.' },
      ]),
    })

    fireEvent.click(screen.getByRole('button', { name: en.read }))
    expect(setEnabled).toHaveBeenCalledWith(SID, true, '2.3', 'Bold claim.\n\nSecond paragraph.')
  })

  it('reads nothing from a step that is not streaming', () => {
    const { setEnabled, finish } = toggle({ partial: null })

    expect(finish).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.read }))
    expect(setEnabled).toHaveBeenCalledWith(SID, true, '', '')
  })
})

describe('reading state', () => {
  it('shows the stop control and asks for reading off a tap', () => {
    const { setEnabled } = toggle({ enabled: true })
    const button = screen.getByRole('button', { name: en.stop })

    expect(button.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(button)
    expect(setEnabled).toHaveBeenCalledWith(SID, false, '1.1', 'Hello there.')
  })

  it('streams the growing step text to the engine while reading', () => {
    const { sync, props, rerender } = toggle({ enabled: true })
    expect(sync).toHaveBeenCalledWith(SID, '1.1', 'Hello there.')

    const grown = {
      ...props,
      useChat: useChatOf(chatSnapshot(partialStep('Hello there. More is coming.'))),
    } as unknown as ReadAloudProps
    rerender(<ReadAloudToggle {...grown} />)
    expect(sync).toHaveBeenLastCalledWith(SID, '1.1', 'Hello there. More is coming.')
  })

  it('finishes the step once the reply stops streaming', () => {
    const { finish } = toggle({ enabled: true, partial: null })
    expect(finish).toHaveBeenCalledWith(SID)
  })

  it('reports synthesis in flight as busy', () => {
    toggle({ enabled: true, loading: true })
    const button = screen.getByRole('button', { name: en.loading })

    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })

  it('reports a reply that could not be read', () => {
    toggle({ enabled: true, failed: true })
    const button = screen.getByRole('button', { name: en.failed })

    expect(button.hasAttribute('data-failed')).toBe(true)
  })

  it('keeps the reading state out of a Session it does not belong to', () => {
    toggle({ enabled: false, loading: false, failed: false, speaking: true })
    expect(screen.getByRole('button', { name: en.read }).getAttribute('aria-pressed')).toBe('false')
  })
})

describe('standing choice', () => {
  it('switches reading on for a Session opened while the reader keeps it on', () => {
    localStorage.setItem(ENABLED_KEY, 'on')
    const { setEnabled, props, rerender } = toggle()

    expect(setEnabled).toHaveBeenCalledWith(SID, true, '1.1', 'Hello there.')
    setEnabled.mockClear()

    rerender(<ReadAloudToggle {...{
      ...props,
      useReadAloud: useReadAloudOf(readAloudState({ enabled: [SID] })),
    } as unknown as ReadAloudProps} />)
    expect(setEnabled).not.toHaveBeenCalled()
  })

  it('leaves a Session alone when the reader keeps reading off', () => {
    const { setEnabled } = toggle()
    expect(setEnabled).not.toHaveBeenCalled()
  })

  it('stays off after the reader\u2019s own tap, because the tap rewrites the standing choice', () => {
    localStorage.setItem(ENABLED_KEY, 'on')
    const { setEnabled, props, rerender } = toggle({ enabled: true })

    setEnabled.mockImplementation((_session: string, next: boolean) => { writeEnabled(next) })
    fireEvent.click(screen.getByRole('button', { name: en.stop }))
    expect(localStorage.getItem(ENABLED_KEY)).toBe('off')
    setEnabled.mockClear()

    rerender(<ReadAloudToggle {...{
      ...props,
      useReadAloud: useReadAloudOf(readAloudState({ enabled: [] })),
    } as unknown as ReadAloudProps} />)
    expect(setEnabled).not.toHaveBeenCalled()
  })
})

describe('agent request', () => {
  it('switches reading on when an agent asks for it, once', () => {
    const nodes = [toolResultNode(3, 'read_aloud', '{"enabled":true}')]
    const { setEnabled, props, rerender } = toggle({ nodes })
    expect(setEnabled).toHaveBeenCalledWith(SID, true, '1.1', 'Hello there.')

    setEnabled.mockClear()
    const grown = { ...props, useChat: useChatOf(chatSnapshot(partialStep('Hello there. More.'), nodes)) }
    rerender(<ReadAloudToggle {...grown as unknown as ReadAloudProps} />)
    expect(setEnabled).not.toHaveBeenCalled()
  })

  it('switches reading off when the newest request asks for silence', () => {
    const nodes = [toolResultNode(3, 'read_aloud', '{"enabled":false}')]
    const { setEnabled } = toggle({ nodes, enabled: true })

    expect(setEnabled).toHaveBeenCalledWith(SID, false, '1.1', 'Hello there.')
  })

  it('ignores a request that already moved the toggle before it mounted', () => {
    const { setEnabled } = toggle({ nodes: [] })
    expect(setEnabled).not.toHaveBeenCalled()
  })
})
