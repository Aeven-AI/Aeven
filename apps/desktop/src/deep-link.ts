/**
 * `aeven://` links: the web version's "Open in Aeven Desktop" hands a conversation to this app through them. Only
 * the app root and one conversation are addressable, so a link from a web page can never steer the window to an
 * arbitrary path.
 * @module
 */

/** The URL scheme the desktop app registers with the operating system. */
export const DEEP_LINK_SCHEME = 'aeven'

/** A conversation id as the Host mints them. */
const SESSION_ID = /^[0-9A-Za-z_-]{8,64}$/

/**
 * The app path an `aeven://` link opens: `aeven://c/<conversation>` that conversation, `aeven://` the app itself.
 * @param url - the link the operating system handed over.
 * @returns the path to show, or undefined for anything else.
 */
export function deepLinkPath(url: string): string | undefined {
  if (!URL.canParse(url)) return undefined
  const parsed = new URL(url)
  if (parsed.protocol !== `${DEEP_LINK_SCHEME}:`) return undefined
  const segments = [parsed.hostname, ...parsed.pathname.split('/')].filter(segment => segment !== '')
  if (segments.length === 0) return '/'
  const [kind, id] = segments
  if (segments.length === 2 && kind === 'c' && id !== undefined && SESSION_ID.test(id)) return `/c/${id}`
  return undefined
}

/**
 * The `aeven://` link among a process's arguments, as Windows and Linux pass it to a launch.
 * @param argv - the launch arguments.
 * @returns the link, or undefined when the launch carries none.
 */
export function deepLinkIn(argv: readonly string[]): string | undefined {
  return argv.find(argument => argument.startsWith(`${DEEP_LINK_SCHEME}:`))
}
