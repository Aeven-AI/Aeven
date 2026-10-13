/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { dispatchObjectEvent, off, on } from '../src/client/auth/services/events.ts'

describe('the named-event bus the screens use', () => {
  it('delivers to every listener of one event', () => {
    const first = vi.fn()
    const second = vi.fn()
    on('confetti:show', 'screen-a', first)
    on('confetti:show', 'screen-b', second)
    dispatchObjectEvent('confetti:show', true)
    expect(first).toHaveBeenCalledWith(true)
    expect(second).toHaveBeenCalledWith(true)
    off('confetti:show', 'screen-a')
    off('confetti:show', 'screen-b')
  })

  it('removes exactly the listener a screen registered, keyed by its own id', () => {
    const kept = vi.fn()
    const removed = vi.fn()
    on('show:modal', 'stays', kept)
    on('show:modal', 'goes', removed)
    off('show:modal', 'goes')
    dispatchObjectEvent('show:modal', { type: 'alertModal' })
    expect(kept).toHaveBeenCalledOnce()
    expect(removed).not.toHaveBeenCalled()
    off('show:modal', 'stays')
  })

  it('is quiet for an event nobody listens to, and for a listener already gone', () => {
    expect(() => { dispatchObjectEvent('nobody:listening', 1) }).not.toThrow()
    expect(() => { off('nobody:listening', 'absent') }).not.toThrow()
  })

  it('lets a listener remove itself while the event is dispatching', () => {
    const seen: string[] = []
    on('resize', 'self-removing', () => { seen.push('first'); off('resize', 'self-removing') })
    on('resize', 'other', () => { seen.push('second') })
    // The dispatch iterates a copy, so removing during it does not skip the
    // listener that follows.
    dispatchObjectEvent('resize', undefined)
    expect(seen).toEqual(['first', 'second'])
    off('resize', 'other')
  })
})
