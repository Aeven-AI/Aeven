/** The inlined first-paint sheet fades on the timing the preloader control waits out. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FADE_DELAY_MS, FADE_MS } from '../src/preloader.ts'

const sheet = readFileSync(
  fileURLToPath(new URL('../../../../apps/web/src/preloader.css', import.meta.url)),
  'utf8',
)

describe('first-paint preloader.css', () => {
  it('delays both fades by the hold the control waits out', () => {
    // The control's fallback timer has to outlast the delay and the fade, or it
    // would cut `.screen-hidden` in while the opaque cover is still fading.
    expect(sheet).toContain(`transition: opacity ${FADE_MS}ms linear ${FADE_DELAY_MS}ms`)
    expect(sheet).toContain(`transition: filter ${FADE_MS}ms ease-out ${FADE_DELAY_MS}ms`)
  })

  it('drags the macOS window by an element, and takes the cover out with it', () => {
    // Chromium reads `-webkit-app-region` from elements only, so the sheet styles
    // the band element each document carries rather than a pseudo-element.
    const band = /html\[data-avn-traffic-lights\] \.avn-drag-band \{([^}]*)\}/u.exec(sheet)?.[1] ?? ''
    expect(band).toContain('-webkit-app-region: drag')
    expect(band).toContain('height: calc(8px + var(--dsw-aeven-control-size, 40px))')
    // The cover is the drag region until the client mounts, and it leaves the
    // layout once hidden, so it cannot intercept the toolbar's clicks.
    expect(sheet).toMatch(/html\[data-avn-traffic-lights\] #avn-preloader \{\s*-webkit-app-region: drag;/u)
    expect(sheet).toMatch(/html\[data-avn-traffic-lights\] #avn-preloader\.screen-hidden \{\s*display: none;/u)
  })
})
