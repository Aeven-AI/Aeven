// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserOverlay } from '../src/overlay.ts'
import { installOverlay } from '../src/index.ts'
import { CLASS_PREFIX } from '../src/styles.ts'

/** The re-install hook `src/index.ts` hangs off `window` for a host that reloaded no bundle. */
interface OverlayModuleGlobal {
  __aevenOverlayModule?: { installOverlay: () => BrowserOverlay }
}

/** The installed overlay's root element, as a page's own selector queries would find it. */
function installedRoot(): Element | null {
  return document.documentElement.querySelector(`.${CLASS_PREFIX}`)
}

describe('overlay entry point', () => {
  let overlay: BrowserOverlay | undefined

  beforeEach(() => {
    // Each test starts from the entry's own install, on a page with no overlay.
    window.__aevenOverlay?.destroy()
    delete window.__aevenOverlay
    overlay = installOverlay()
  })

  afterEach(() => {
    overlay?.destroy()
    overlay = undefined
    delete window.__aevenOverlay
  })

  it('installs one attached overlay as a side effect of loading', () => {
    // The page never imports the bundle, so this side effect is the whole API: a
    // host evaluates the module and gets a live overlay on the document.
    expect(overlay).toBeInstanceOf(BrowserOverlay)
    expect(overlay?.attached).toBe(true)
    const root = installedRoot()
    expect(root).not.toBeNull()
    expect(root?.getAttribute('aria-hidden')).toBe('true')
  })

  it('returns the installed overlay on every later call', () => {
    const again = installOverlay()
    expect(again).toBe(overlay)
    // Idempotence is what a re-injection after a soft navigation relies on.
    expect(document.querySelectorAll(`.${CLASS_PREFIX}`)).toHaveLength(1)
  })

  it('exposes the module hook so a host can re-install without re-injecting', () => {
    const module = (window as unknown as OverlayModuleGlobal).__aevenOverlayModule
    expect(module?.installOverlay).toBe(installOverlay)
    expect(module?.installOverlay()).toBe(overlay)
  })

  it('installs over a destroyed overlay', () => {
    // A torn-down overlay is still the installed one, and the hook can put it
    // back on screen without a second copy of the bundle.
    overlay?.destroy()
    expect(installedRoot()).toBeNull()
    expect(installOverlay()).toBe(overlay)
    expect(overlay?.attach().attached).toBe(true)
    expect(installedRoot()).not.toBeNull()
  })

  it('defers the attach to DOMContentLoaded for a document-start injection', () => {
    // `Page.addScriptToEvaluateOnNewDocument` runs before the parser has created
    // `documentElement`, so the instance is built but must not be attached yet.
    overlay?.destroy()
    delete window.__aevenOverlay
    const loading = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
    const deferred = installOverlay()
    overlay = deferred
    expect(deferred.attached).toBe(false)
    loading.mockRestore()

    document.dispatchEvent(new Event('DOMContentLoaded'))
    expect(deferred.attached).toBe(true)
    expect(installedRoot()).not.toBeNull()
  })
})
