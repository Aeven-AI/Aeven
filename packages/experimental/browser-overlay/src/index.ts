/**
 * Auto-installing entry point for the overlay bundle.
 *
 * A host injects this bundle into a page it is operating; the page never imports
 * it. Installation is therefore a side effect of loading, and it is idempotent
 * through the `window` global so a re-injection after a soft navigation reuses the
 * live overlay instead of stacking a second one.
 *
 * A document-start injection runs before the parser has created `documentElement`,
 * which is the normal way a CDP host installs this — `Page.addScriptToEvaluateOnNewDocument`
 * fires first. {@link installOverlay} therefore defers the actual attach to
 * `DOMContentLoaded` when the document is still loading, so the call is safe at any
 * point in the document lifecycle.
 *
 * ```js
 * await session.send('Page.addScriptToEvaluateOnNewDocument', { source: bundle })
 * await session.send('Runtime.evaluate', { expression: 'window.__aevenOverlay.click({ x: 120, y: 340 })' })
 * ```
 * @module
 */

import { BrowserOverlay } from './overlay.ts'

declare global {
  interface Window {
    /** The page's single overlay instance, created on first load of the bundle. */
    __aevenOverlay?: BrowserOverlay
  }
}

/**
 * Attach the overlay, waiting for a document that can hold it.
 *
 * Returns the instance immediately so a caller can queue actions against it; those
 * actions are no-ops until the root exists, which is the correct behavior for a
 * document that has not been parsed yet.
 */
function attachWhenReady(overlay: BrowserOverlay): BrowserOverlay {
  // `readyState` is the honest discriminator: it is `loading` exactly when there
  // is no root element yet. `attach()` handles that case itself.
  if (document.readyState !== 'loading') {
    overlay.attach()
    return overlay
  }
  document.addEventListener('DOMContentLoaded', () => { overlay.attach() }, { once: true })
  return overlay
}

/**
 * The installed overlay, attaching it if this is the first evaluation.
 * @returns the page's overlay instance; every later call returns that same one.
 */
export function installOverlay(): BrowserOverlay {
  window.__aevenOverlay ??= attachWhenReady(new BrowserOverlay())
  return window.__aevenOverlay
}

export { BrowserOverlay }
export type { AttachOptions, CursorMode, Point, Rect } from './overlay.ts'

// Exposed so a host can re-install after a full teardown without re-injecting the
// bundle, and so an in-page test can assert that re-attachment stays idempotent.
;(window as unknown as { __aevenOverlayModule?: { installOverlay: typeof installOverlay } })
  .__aevenOverlayModule = { installOverlay }

installOverlay()
