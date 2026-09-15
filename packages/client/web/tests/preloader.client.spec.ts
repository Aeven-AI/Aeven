// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FADE_DELAY_MS, FADE_MS, PRELOADER_ELEMENT_ID, hidePreloader, showPreloader,
} from '../src/preloader.ts'

/** The whole time the control waits before it can take the element out of the layout. */
const FADE_WINDOW_MS = FADE_DELAY_MS + FADE_MS + 100

function mountPreloader(): HTMLElement {
  document.body.innerHTML = `
    <div id="${PRELOADER_ELEMENT_ID}">
      <div class="spinner active"></div>
    </div>
  `
  const element = document.getElementById(PRELOADER_ELEMENT_ID)
  if (element === null) throw new Error('preloader fixture did not mount')
  return element
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(callback, 0))
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('static shell preloader control', () => {
  it('fades out before hiding the shell visual and stopping its spinner', () => {
    const element = mountPreloader()
    hidePreloader()
    expect(element.classList.contains('animate')).toBe(true)
    vi.advanceTimersByTime(0)
    expect(element.classList.contains('hide')).toBe(true)
    vi.advanceTimersByTime(FADE_WINDOW_MS)
    expect(element.classList.contains('screen-hidden')).toBe(true)
    expect(element.querySelector('.spinner')?.classList.contains('active')).toBe(false)
  })

  it('can hide and restore immediately for the worker source chooser', () => {
    const element = mountPreloader()
    hidePreloader(false)
    expect(element.classList.contains('screen-hidden')).toBe(true)
    showPreloader(false)
    expect(element.classList.contains('hide')).toBe(false)
    expect(element.classList.contains('screen-hidden')).toBe(false)
    expect(element.querySelector('.spinner')?.classList.contains('active')).toBe(true)
  })

  it('cancels a pending fade when the loader is restored', () => {
    const element = mountPreloader()
    hidePreloader()
    vi.advanceTimersByTime(0)
    showPreloader(false)
    vi.advanceTimersByTime(FADE_WINDOW_MS)
    expect(element.classList.contains('screen-hidden')).toBe(false)
  })

  it('is optional for documents that do not use the Web shell', () => {
    expect(() => {
      hidePreloader()
      showPreloader()
    }).not.toThrow()
  })
})
