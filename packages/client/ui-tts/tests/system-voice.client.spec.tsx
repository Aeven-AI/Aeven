// @vitest-environment jsdom
/**
 * The composer Options row for the reading voice: pressing it opens the shared popupSelect card beside
 * the row, with the copy the card's rows carry.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@aeven/session/types'
import { en } from '../src/client/locales.ts'
import { SystemVoice, type SystemVoiceProps, type VoicePickerLabels } from '../src/client/SystemVoice.tsx'
import { makeT } from './harness.client.ts'

const SID = 's1' as SessionId

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the row', () => {
  it('opens the picker for its session beside itself', () => {
    const openPicker = vi.fn<(sessionId: SessionId, anchor: Element, labels: VoicePickerLabels) => void>()
    const props = { sessionId: SID, openPicker, t: makeT() } as unknown as SystemVoiceProps
    render(<SystemVoice {...props} />)
    const row = screen.getByRole('menuitem', { name: en['voice.row'] })

    fireEvent.click(row)

    expect(openPicker).toHaveBeenCalledTimes(1)
    const [sessionId, anchor, labels] = openPicker.mock.calls[0]!
    expect(sessionId).toBe(SID)
    expect(anchor).toBe(row)
    expect(labels.default).toBe(en['voice.default'])
    expect(labels.count(3)).toBe(en['voice.count'].replace('{count}', '3'))
  })

  it('keeps the draft focused when pressed', () => {
    const props = { sessionId: SID, openPicker: vi.fn(), t: makeT() } as unknown as SystemVoiceProps
    render(<SystemVoice {...props} />)
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })

    screen.getByRole('menuitem', { name: en['voice.row'] }).dispatchEvent(press)

    expect(press.defaultPrevented).toBe(true)
  })
})
