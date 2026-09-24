/** Browser address-bar projection for the selected Session. */

import type { SessionId } from '@aeven/session/types'

const SESSION_PATH_PREFIX = '/c/'

/**
 * The Host mints every Session id as `session-<uuid>`, and repeating that word
 * in a path already meaning "conversation" makes the address twice as long as
 * it reads. The prefix is dropped on the way out and restored on the way in,
 * so the id the rest of the client handles is unchanged.
 */
const SESSION_ID_PREFIX = 'session-'

/**
 * A Session address names a Host-minted id, whose part after the prefix is a
 * UUID. Anything else is not a chat: accepting it would create a Session under
 * whatever the address happened to say.
 */
const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Session address for one Session id, as `/c/<uuid>`.
 *
 * Shared by the History projection and by the New Session link, so a real
 * `href` and a `pushState` can never disagree about the shape of a Session
 * address. Accepts the id with or without its `session-` prefix.
 * @param sessionId - the Session to address.
 * @returns the absolute path naming that Session.
 */
export function sessionPathOf(sessionId: string): string {
  const bare = sessionId.startsWith(SESSION_ID_PREFIX)
    ? sessionId.slice(SESSION_ID_PREFIX.length)
    : sessionId
  return `${SESSION_PATH_PREFIX}${encodeURIComponent(bare)}`
}

/** Address-bar operations consumed by Workspace navigation policy. */
export interface SessionUrlNavigation {
  /** Read the Session requested by the current URL; an address without a Host-minted `<uuid>` id requests none. */
  read(): SessionId | undefined
  /** Add a user-visible Session transition to browser history. */
  push(sessionId: SessionId | undefined): void
  /** Rewrite the current history entry during initial reconciliation. */
  replace(sessionId: SessionId | undefined): void
  /** Observe browser Back and Forward navigation. */
  subscribe(listener: () => void): () => void
}

/** Browser members required by the URL projection. */
export interface SessionUrlWindow {
  readonly location: { readonly href: string }
  readonly history: {
    pushState(data: unknown, unused: string, url?: string | URL | null): void
    replaceState(data: unknown, unused: string, url?: string | URL | null): void
  }
  addEventListener(type: 'popstate', listener: () => void): void
  removeEventListener(type: 'popstate', listener: () => void): void
}

/**
 * Browser implementation using `/c/:id` SPA paths.
 *
 * The window arrives as a thunk, not a value: applying this plugin then costs
 * no browser access, and only an actual navigation needs one. Reading the
 * ambient global at construction instead made `apply` browser-only, which is a
 * requirement the plugin does not otherwise have.
 */
export class BrowserSessionUrlNavigation implements SessionUrlNavigation {
  /** @param window - resolves the current browser window's URL, History, and event faces. */
  constructor(private readonly window: () => SessionUrlWindow) {}

  /** The browser face for this operation. */
  private get browser(): SessionUrlWindow {
    return this.window()
  }

  read(): SessionId | undefined {
    const { pathname } = new URL(this.browser.location.href)
    if (!pathname.startsWith(SESSION_PATH_PREFIX)) return undefined
    const encoded = pathname.slice(SESSION_PATH_PREFIX.length)
    if (encoded.length === 0 || encoded.includes('/')) return undefined
    try {
      const value = decodeURIComponent(encoded)
      /* v8 ignore next -- kept as a parser guard: no non-empty percent-encoding
       * decodes to the empty string, and the empty path was rejected above. */
      if (value.length === 0) return undefined
      // An address written before the prefix was dropped still names its
      // session, so it is accepted as it stands rather than prefixed twice.
      const bare = value.startsWith(SESSION_ID_PREFIX) ? value.slice(SESSION_ID_PREFIX.length) : value
      if (!SESSION_UUID.test(bare)) return undefined
      return `${SESSION_ID_PREFIX}${bare.toLowerCase()}` as SessionId
    } catch {
      return undefined
    }
  }

  push(sessionId: SessionId | undefined): void {
    this.write('pushState', sessionId)
  }

  replace(sessionId: SessionId | undefined): void {
    this.write('replaceState', sessionId)
  }

  subscribe(listener: () => void): () => void {
    this.browser.addEventListener('popstate', listener)
    return () => { this.browser.removeEventListener('popstate', listener) }
  }

  private write(
    method: 'pushState' | 'replaceState',
    sessionId: SessionId | undefined,
  ): void {
    if (this.read() === sessionId) return
    const next = new URL(this.browser.location.href)
    next.pathname = sessionId === undefined ? '/' : sessionPathOf(sessionId)
    this.browser.history[method](null, '', `${next.pathname}${next.search}${next.hash}`)
  }
}
