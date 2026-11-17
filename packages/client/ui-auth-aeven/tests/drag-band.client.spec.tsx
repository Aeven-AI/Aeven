// @vitest-environment jsdom
/**
 * The macOS desktop window has no title bar, so every screen must carry the element it drags by. The sign-in screens
 * render outside the application frame, which carries its own band, so they carry one themselves. These specs fail
 * when a sign-in screen, a follow-up step, or the first-paint sheet that styles the band loses it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { mountAuthScreen, mountNameScreen, mountRestoreScreen, type MountedAuthScreen } from '../src/client/auth/mount.tsx'

let mounted: MountedAuthScreen | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  act(() => { mounted?.unmount() })
  container?.remove()
  mounted = undefined
  container = undefined
  cleanup()
  window.history.replaceState(null, '', '/')
})

function mount(open: (root: HTMLDivElement) => MountedAuthScreen | undefined): HTMLDivElement {
  container = document.createElement('div')
  document.body.append(container)
  const root = container
  act(() => { mounted = open(root) })
  return root
}

describe('the macOS window drag band on the sign-in screens', () => {
  it.each(['/sign-in', '/sign-in/email', '/sign-in/passkey', '/sign-up', '/sign-up/email'])('%s carries the band', (path) => {
    window.history.replaceState(null, '', path)
    const root = mount(node => mountAuthScreen(node, path))
    expect(root.querySelectorAll('.avn-drag-band')).toHaveLength(1)
    expect(root.querySelector('.avn-drag-band')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('the name and restore steps carry the band', () => {
    expect(mount(node => mountNameScreen(node, '/')).querySelectorAll('.avn-drag-band')).toHaveLength(1)
    act(() => { mounted?.unmount() })
    container?.remove()
    expect(mount(node => mountRestoreScreen(node, '2026-12-17T00:00:00.000Z')).querySelectorAll('.avn-drag-band')).toHaveLength(1)
  })

  it('the first-paint sheet makes the band a window drag region and the sign-in controls stay clickable', () => {
    const sheet = readFileSync(join(import.meta.dirname, '../../../../apps/web/src/preloader.css'), 'utf8')
    const band = /html\[data-avn-traffic-lights\] \.avn-drag-band \{([^}]*)\}/u.exec(sheet)?.[1] ?? ''
    expect(band).toContain('position: fixed')
    expect(band).toContain('-webkit-app-region: drag')
    const auth = readFileSync(join(import.meta.dirname, '../src/vendor/aeven-auth.css'), 'utf8')
    expect(auth).toMatch(/html\[data-avn-traffic-lights\] #app-root :is\(button, a, input[^)]*\)[^{]*\{\s*-webkit-app-region: no-drag;/u)
  })
})
