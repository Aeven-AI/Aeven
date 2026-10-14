/**
 * Surface routing: which full-page surface owns the center column. A surface
 * claims a path root such as `/i`; the address bar then decides the surface
 * — the root itself and every path beneath it belong to it. A path no surface
 * claims leaves the column to the conversation.
 */
import type { HostObservable } from '@aeven/client-ui-slots'

/** One surface's claim on the address space. */
export interface SurfaceRoute {
  /** Surface id; the key its page registers under in the `surface` slot. */
  id: string
  /** Path root the surface owns, as `/<segment>`, e.g. `/i`. */
  root: string
}

/* jscpd:ignore-start -- mirrors client-ui-workspace's SessionUrlWindow; each address projection declares the browser face it reads. */
/** Browser members the router reads and writes. */
export interface SurfaceWindow {
  readonly location: { readonly href: string }
  readonly history: {
    pushState(data: unknown, unused: string, url?: string | URL | null): void
    replaceState(data: unknown, unused: string, url?: string | URL | null): void
  }
  addEventListener(type: 'popstate', listener: () => void): void
  removeEventListener(type: 'popstate', listener: () => void): void
}
/* jscpd:ignore-end */

/** The outward surface-routing face (`ctx.layout.surfaces`). */
export interface ISurfaces {
  /**
   * Claim a path root for a surface.
   * @param route - the surface id and the root it owns.
   * @returns the disposer that releases the claim.
   */
  register(route: SurfaceRoute): () => void
  /** The id of the surface owning the current path; undefined leaves the column to the conversation. */
  readonly current: HostObservable<string | undefined>
  /**
   * Read the current path.
   * @returns the address bar's pathname.
   */
  pathname(): string
  /**
   * Move to a path as a new history entry.
   * @param path - absolute path, e.g. `/i/<uuid>`.
   */
  push(path: string): void
  /**
   * Rewrite the current history entry.
   * @param path - absolute path, e.g. `/i/<uuid>`.
   */
  replace(path: string): void
}

/** A root is one non-empty segment: `/i`, never `/`, `/i/`, or `/a/b`. */
const ROOT_PATTERN = /^\/[^/]+$/

/** Browser implementation over the History API. */
export class Surfaces implements ISurfaces {
  readonly #routes = new Set<SurfaceRoute>()
  readonly #listeners = new Set<() => void>()
  #popstate: (() => void) | undefined

  readonly current: HostObservable<string | undefined> = {
    getSnapshot: () => this.#match(),
    /* jscpd:ignore-start -- mirrors ui-settings-general's settings-url.ts popstate lifetime; each projection owns its own subscription. */
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
    /* jscpd:ignore-end */
  }

  /**
   * @param window - resolves the browser window; a thunk, so constructing the
   * router touches no browser global.
   */
  constructor(private readonly window: () => SurfaceWindow) {}

  register(route: SurfaceRoute): () => void {
    if (!ROOT_PATTERN.test(route.root)) {
      throw new Error(`layout.surfaces: root "${route.root}" of surface "${route.id}" must be one path segment such as "/i"`)
    }
    for (const claimed of this.#routes) {
      if (claimed.id === route.id || claimed.root === route.root) {
        throw new Error(`layout.surfaces: surface "${route.id}" at "${route.root}" collides with "${claimed.id}" at "${claimed.root}"`)
      }
    }
    // A copy is the registration's identity, so disposing one claim cannot
    // release another made with an equal object.
    const claim = { ...route }
    this.#routes.add(claim)
    this.#notify()
    return () => {
      this.#routes.delete(claim)
      this.#notify()
    }
  }

  pathname(): string {
    return new URL(this.window().location.href).pathname
  }

  push(path: string): void {
    this.#write('pushState', path)
  }

  replace(path: string): void {
    this.#write('replaceState', path)
  }

  #write(method: 'pushState' | 'replaceState', path: string): void {
    this.window().history[method](null, '', path)
    // History writes raise no popstate; the router announces its own.
    this.#notify()
  }

  #match(): string | undefined {
    const pathname = this.pathname()
    for (const route of this.#routes) {
      if (pathname === route.root || pathname.startsWith(`${route.root}/`)) return route.id
    }
    return undefined
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener()
  }
}
