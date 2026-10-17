import { describe, expect, it } from 'vitest'
import { START_PAGE_PATH, startPageDocument, startPageUrl } from '../src/start-screen.ts'

describe('desktop start screen', () => {
  it('draws the loading face the client preloader continues', () => {
    const html = startPageDocument('darwin')
    // The Æven mark and the spinner glyph, at the client preloader's own geometry.
    expect(html).toContain('m225.301 0 305.5 529.142')
    expect(html).toContain('M16 16L19 19')
    expect(html).toContain('width:50px;height:50px')
    expect(html).toContain('margin:0 0 4px')
    expect(html).toContain('width:18px;height:18px')
    expect(html).toContain('loader-spin 900ms linear infinite')
    expect(html).toContain('prefers-reduced-motion:reduce')
  })

  it('centres the face on the colours the application paints next', () => {
    const html = startPageDocument('darwin')
    expect(html).toContain('name="color-scheme" content="light dark"')
    expect(html).toContain('--avn-start-bg:rgb(242,242,242)')
    // The dark arm repeats the preloader's own cover and ink.
    expect(html).toContain('@media (prefers-color-scheme:dark)')
    expect(html).toContain('--avn-start-bg:#111111')
    expect(html).toContain('--avn-start-ink:rgb(249,250,251)')
    expect(html).toContain('body{display:flex;align-items:center;justify-content:center}')
  })

  it('carries no copy of its own, so nothing shifts when the application loads', () => {
    const html = startPageDocument('darwin')
    expect(html).toContain('<body><main>')
    expect(html).not.toContain('class="status"')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('margin:20px')
  })

  it('drags the macOS window before any client code runs, and no other platform', () => {
    const mac = startPageDocument('darwin')
    // The band is the window's drag area: full width, one header row tall, and
    // above this page's own cover so it is live on the first painted frame.
    expect(mac).toContain('-webkit-app-region:drag')
    expect(mac).toContain('height:calc(8px + var(--dsw-aeven-control-size,40px))')
    expect(mac).toContain('z-index:2001')
    expect(mac).toContain('pointer-events:none')
    // Windows and Linux keep their title strip; their start screen drags there.
    expect(startPageDocument('win32')).not.toContain('-webkit-app-region')
    expect(startPageDocument('linux')).not.toContain('-webkit-app-region')
  })

  it('serves the page from the shell origin', () => {
    expect(startPageUrl()).toBe(`avn-app://shell${START_PAGE_PATH}`)
    expect(new URL(startPageUrl()).pathname).toBe(START_PAGE_PATH)
  })
})
