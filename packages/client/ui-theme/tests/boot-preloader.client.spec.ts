// @vitest-environment jsdom
/** The preloader injection rows and the dismissal controller they publish. */
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PRELOADER_ELEMENT_ID, PRELOADER_GLOBAL, bootPreloaderInjections,
} from '../src/boot-preloader.ts'

interface PreloaderControl {
  hide: (animation?: boolean) => void
  show: (animation?: boolean) => void
}

/** Render the html row into the document and run the controller row against it. */
function installPreloader(): PreloaderControl {
  const rows = bootPreloaderInjections()
  const markup = rows.find(row => row.kind === 'html')
  const script = rows.find(row => row.kind === 'script')
  if (markup?.kind !== 'html' || script?.kind !== 'script') throw new Error('missing preloader rows')
  document.body.innerHTML = markup.html
  const sandbox = { document, requestAnimationFrame, setTimeout, clearTimeout, globalThis: {} as Record<string, unknown> }
  runInNewContext(script.text, sandbox)
  return sandbox.globalThis[PRELOADER_GLOBAL] as PreloaderControl
}

/** Run every queued animation frame, then advance past the transition-end fallback. */
function settleFade(): void {
  vi.advanceTimersByTime(0)
  vi.advanceTimersByTime(600)
}

function root(): HTMLElement {
  const el = document.getElementById(PRELOADER_ELEMENT_ID)
  if (el === null) throw new Error('preloader element is absent')
  return el
}

beforeEach(() => {
  // rAF is unqueued in jsdom; route it through the fake clock so the deferred
  // class add is observable.
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => { cb(0) }, 0) as unknown as number)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('preloader rows', () => {
  it('renders a head stylesheet plus body markup and controller, so first paint carries the page', () => {
    const rows = bootPreloaderInjections()
    expect(rows.map(row => row.kind)).toEqual(['style', 'html', 'script'])
    expect(rows[1]).toMatchObject({ kind: 'html', placement: 'body' })
    expect(rows[2]).toMatchObject({ kind: 'script', placement: 'body' })
  })

  it('paints the brand mark and an active spinner over an opaque ground', () => {
    installPreloader()
    expect(root().querySelector('.logo svg')).not.toBeNull()
    expect(root().querySelector('.spinner')?.classList.contains('active')).toBe(true)
    expect(root().querySelector('.background')).not.toBeNull()
  })

  it('themes through currentColor so the dark override repaints both glyphs', () => {
    installPreloader()
    expect(root().querySelector('.logo g')?.getAttribute('fill')).toBe('currentColor')
    expect(root().querySelector('.spinner path')?.getAttribute('stroke')).toBe('currentColor')
  })

  it('never closes its own style or script element', () => {
    for (const row of bootPreloaderInjections()) {
      if (row.kind === 'style') expect(row.text).not.toContain('</style')
      if (row.kind === 'script') expect(row.text).not.toContain('</script')
    }
  })

  it('fades out, then takes the page out of the layout and stops the spinner', () => {
    const control = installPreloader()
    control.hide()
    vi.advanceTimersByTime(0)
    expect(root().classList.contains('animate')).toBe(true)
    expect(root().classList.contains('hide')).toBe(true)
    expect(root().classList.contains('screen-hidden')).toBe(false)
    settleFade()
    expect(root().classList.contains('animate')).toBe(false)
    expect(root().classList.contains('screen-hidden')).toBe(true)
    expect(root().querySelector('.spinner')?.classList.contains('active')).toBe(false)
  })

  it('cuts straight to hidden without animation, for the boot failure report', () => {
    const control = installPreloader()
    control.hide(false)
    expect(root().classList.contains('animate')).toBe(false)
    expect(root().classList.contains('hide')).toBe(true)
    expect(root().classList.contains('screen-hidden')).toBe(true)
  })

  it('ignores a repeat hide once the page is already dismissed', () => {
    const control = installPreloader()
    control.hide(false)
    control.hide()
    vi.advanceTimersByTime(0)
    expect(root().classList.contains('animate')).toBe(false)
  })

  it('restores the page through show, reactivating the spinner', () => {
    const control = installPreloader()
    control.hide(false)
    control.show(false)
    expect(root().classList.contains('hide')).toBe(false)
    expect(root().classList.contains('screen-hidden')).toBe(false)
    expect(root().querySelector('.spinner')?.classList.contains('active')).toBe(true)
  })

  it('tolerates a document that never received the markup', () => {
    const control = installPreloader()
    document.body.innerHTML = ''
    expect(() => { control.hide() }).not.toThrow()
    expect(() => { control.show() }).not.toThrow()
  })
})
