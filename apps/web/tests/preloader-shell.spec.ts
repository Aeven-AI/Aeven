/**
 * The first-paint shell is the only stylesheet live before the client mounts,
 * so the macOS desktop window's drag band lives here rather than in a
 * component that mounts later.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const shell = readFileSync(new URL('../src/preloader.css', import.meta.url), 'utf8')

/** Declarations of the one rule that draws the macOS band, which its gate owns. */
function bandDeclarations(css: string): string {
  return /html\[data-avn-traffic-lights\] body::before \{([^}]*)\}/u.exec(css)?.[1] ?? ''
}

describe('first-paint shell window band', () => {
  it('drags the macOS window from the first painted frame', () => {
    const band = bandDeclarations(shell)
    expect(band).toContain('-webkit-app-region: drag')
    expect(band).toContain('position: fixed')
    // Above this sheet's own preloader, which covers the frame until the client boots.
    expect(band).toContain('z-index: 2001')
    // Controls drawn in the band keep their clicks.
    expect(band).toContain('pointer-events: none')
  })

  it('carries the client header band height before the theme loads', () => {
    // No theme stylesheet has loaded yet, so the band states the product's own
    // control size as the fallback instead of collapsing to no drag area.
    expect(bandDeclarations(shell)).toContain('height: calc(8px + var(--dsw-aeven-control-size, 40px))')
  })
})
