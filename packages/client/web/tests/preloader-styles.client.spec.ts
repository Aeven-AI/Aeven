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
})
