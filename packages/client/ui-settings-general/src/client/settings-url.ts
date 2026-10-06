/** Browser address-bar projection for the settings panel. */

import type { HostObservable } from '@aeven/client-ui-slots'

/** Fragment the panel owns: `#!/settings` and every path beneath it. */
const SETTINGS_FRAGMENT = '#!'

/** The one segment naming the settings panel inside that fragment. */
const SETTINGS_SEGMENT = 'settings'

/** Section the panel shows when the address names none. */
export interface SettingsAddress {
  /** Section id the address names, absent when it names the panel's first section. */
  section?: string
  /** Page inside that section, such as one connector; absent shows the section itself. */
  detail?: string
}

/**
 * Read the settings panel's address.
 *
 * The address names a section id, never a translated label, so one reader's
 * bookmark resolves for another. `#!/settings`, `#!/settings/<section>`, and
 * `#!/settings/<section>/<detail>` are the addresses {@link settingsFragment}
 * writes; a hand-typed `#!settings`
 * without the slash after the bang names the same panel and reads the same.
 * @param href - the address bar's href.
 * @returns the settings address, or undefined when the fragment is not the panel's.
 */
export function settingsAddressOf(href: string): SettingsAddress | undefined {
  const segments = new URL(href).hash.slice(SETTINGS_FRAGMENT.length).split('/').filter(part => part !== '')
  if (segments[0] !== SETTINGS_SEGMENT) return undefined
  if (segments.length === 1) return {}
  const [, section, detail] = segments
  if (section === undefined || segments.length > 3) return undefined
  try {
    const decoded = decodeURIComponent(section)
    return detail === undefined ? { section: decoded } : { section: decoded, detail: decodeURIComponent(detail) }
  } catch {
    // A malformed escape names no section; it is not another address's either.
    return undefined
  }
}

/**
 * The fragment naming the panel at one section, or at one page inside it.
 * @param section - section id; absent names the panel's first section.
 * @param detail - page inside the section; ignored without a section.
 * @returns the fragment, `#!` included.
 */
export function settingsFragment(section?: string, detail?: string): string {
  const path = `${SETTINGS_FRAGMENT}/${SETTINGS_SEGMENT}`
  if (section === undefined) return path
  const sectionPath = `${path}/${encodeURIComponent(section)}`
  return detail === undefined ? sectionPath : `${sectionPath}/${encodeURIComponent(detail)}`
}

/** Browser members the settings address reads and writes. */
export interface SettingsAddressWindow {
  readonly location: { readonly href: string }
  readonly history: {
    pushState(data: unknown, unused: string, url?: string | URL | null): void
  }
  addEventListener(type: 'popstate', listener: () => void): void
  removeEventListener(type: 'popstate', listener: () => void): void
}

/** The panel's address-bar face: what the shell renders from and navigates through. */
export interface SettingsAddressRoute {
  /** Address of the open panel; undefined while the panel is closed. */
  readonly current: HostObservable<SettingsAddress | undefined>
  /**
   * Address the panel at a section, or a page inside it, opening the panel
   * when it was closed. A no-op while the address already names that section
   * and page, so re-opening the panel never adds a history entry the reader
   * cannot get back past.
   * @param section - section id; absent addresses the panel's first section.
   * @param detail - page inside the section; absent addresses the section itself.
   */
  show(section?: string, detail?: string): void
  /** Drop the panel's address, closing it. A no-op while the panel is closed. */
  close(): void
}

/**
 * Browser implementation over `#!/settings/<section>/<detail>` fragments.
 *
 * The window arrives as a thunk, not a value: applying this plugin costs no
 * browser access, and only an actual navigation needs one.
 */
export class BrowserSettingsAddressRoute implements SettingsAddressRoute {
  readonly #listeners = new Set<() => void>()
  #popstate: (() => void) | undefined
  #href: string | undefined
  #address: SettingsAddress | undefined

  constructor(private readonly window: () => SettingsAddressWindow) {}

  readonly current: HostObservable<SettingsAddress | undefined> = {
    // Re-parsing per call would hand React a fresh object every time and spin
    // its subscription; one parse per href keeps the snapshot stable between
    // address changes.
    getSnapshot: () => {
      const href = this.window().location.href
      if (href !== this.#href) {
        this.#href = href
        this.#address = settingsAddressOf(href)
      }
      return this.#address
    },
    subscribe: (listener) => {
      this.#listeners.add(listener)
      if (this.#popstate === undefined) {
        this.#popstate = () => { this.#notify() }
        this.window().addEventListener('popstate', this.#popstate)
      }
      return () => {
        this.#listeners.delete(listener)
        if (this.#listeners.size > 0 || this.#popstate === undefined) return
        this.window().removeEventListener('popstate', this.#popstate)
        this.#popstate = undefined
      }
    },
  }

  show(section?: string, detail?: string): void {
    const href = this.window().location.href
    const current = settingsAddressOf(href)
    if (current !== undefined && current.section === section && current.detail === detail) return
    this.#write(href, settingsFragment(section, detail))
  }

  close(): void {
    const href = this.window().location.href
    if (settingsAddressOf(href) === undefined) return
    this.#write(href, '')
  }

  /**
   * @param href - the address to rewrite.
   * @param hash - the fragment to leave in place of the current one; empty clears it.
   */
  #write(href: string, hash: string): void {
    const url = new URL(href)
    // Path and query are the rest of the client's: the panel only claims the fragment.
    this.window().history.pushState(null, '', `${url.pathname}${url.search}${hash}`)
    // History writes raise no popstate; the route announces its own.
    this.#notify()
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener()
  }
}
