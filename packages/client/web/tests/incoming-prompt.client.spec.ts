// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { INCOMING_PROMPT_KEY, stashIncomingPrompt } from '../src/incoming-prompt.ts'

afterEach(() => {
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('incoming prompt stash', () => {
  it('moves a #q message into session storage and out of the address bar', () => {
    window.history.replaceState(null, '', '/?ref=site#q=Plan%20my%20week')
    stashIncomingPrompt()
    expect(window.sessionStorage.getItem(INCOMING_PROMPT_KEY)).toBe('Plan my week')
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/?ref=site')
  })

  it('keeps the fragment parameters it does not own', () => {
    window.history.replaceState(null, '', '/#q=hello&utm=landing')
    stashIncomingPrompt()
    expect(window.sessionStorage.getItem(INCOMING_PROMPT_KEY)).toBe('hello')
    expect(window.location.hash).toBe('#utm=landing')
  })

  it('drops a blank message from the address without keeping it', () => {
    window.history.replaceState(null, '', '/#q=%20%20')
    stashIncomingPrompt()
    expect(window.sessionStorage.getItem(INCOMING_PROMPT_KEY)).toBeNull()
    expect(window.location.hash).toBe('')
  })

  it('leaves an address without a message as it is', () => {
    window.history.replaceState(null, '', '/c/abc#section')
    stashIncomingPrompt()
    expect(window.sessionStorage.getItem(INCOMING_PROMPT_KEY)).toBeNull()
    expect(window.location.pathname + window.location.hash).toBe('/c/abc#section')
  })
})
