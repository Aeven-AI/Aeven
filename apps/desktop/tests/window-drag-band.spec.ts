// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { DRAG_BAND_ATTRIBUTE, DRAG_BAND_DECLARATIONS, installDragBand } from '../src/window-drag-band.ts'

/**
 * The band has to be an element: Chromium applies `-webkit-app-region` to
 * elements only, so a `body::before` band of any height and z-index never
 * becomes a draggable region — the regression these specs guard.
 */
describe('desktop window drag band', () => {
  it('installs a real element the window can drag by', () => {
    document.body.replaceChildren()
    const band = installDragBand(document, { height: 48 })

    expect(band.hasAttribute(DRAG_BAND_ATTRIBUTE)).toBe(true)
    expect(band.parentElement).toBe(document.body)
    expect(band.tagName).toBe('DIV')
    // jsdom's CSSOM drops the vendor-prefixed property from an element, so the
    // declaration itself is asserted where it is written.
    expect(DRAG_BAND_DECLARATIONS).toContain('-webkit-app-region:drag')
    expect(band.style.position).toBe('fixed')
    expect(band.style.top).toBe('0px')
    expect(band.style.height).toBe('48px')
    // Controls under the band keep their clicks; the band only drags the window.
    expect(band.style.pointerEvents).toBe('none')
  })

  it('updates the one band a document carries instead of stacking another', () => {
    document.body.replaceChildren()
    const first = installDragBand(document, { height: 48 })
    const second = installDragBand(document, { height: 32, background: '#f2f2f2' })

    expect(second).toBe(first)
    expect(document.querySelectorAll(`[${DRAG_BAND_ATTRIBUTE}]`)).toHaveLength(1)
    expect(second.style.height).toBe('32px')
    expect(second.style.background).toBe('rgb(242, 242, 242)')
  })

  it('holds the band on the document root until the parser creates a body', () => {
    const doc = document.implementation.createHTMLDocument('start')
    doc.documentElement.removeChild(doc.body)

    const band = installDragBand(doc, { height: 48 })
    expect(band.parentElement).toBe(doc.documentElement)

    const body = doc.createElement('body')
    doc.documentElement.append(body)
    expect(installDragBand(doc, { height: 48 }).parentElement).toBe(body)
  })
})
