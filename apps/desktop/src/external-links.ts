/**
 * Addresses the shell hands on when the window's content asks for one, and the
 * two handoffs it chooses between.
 *
 * The window renders the client, so an address it opens comes from content the
 * reader chose: an assistant's Markdown link, a link in a page, a mail address.
 * The client owns where a web address lands, because it is the side that can
 * reach the session's own browser and the Chromium the agent drives, so a page
 * that says it listens receives the address and performs the open itself. A
 * page that says nothing — the shell's own windows, a Host served by another
 * build — gets the operating-system handoff below, which is the behaviour a
 * plain Electron window would have. Only schemes some handler exists for leave
 * the application, so a `file:` or `javascript:` destination in authored output
 * reaches nothing.
 */

import { shell, type WebContents } from 'electron'
import { DESKTOP_IPC } from './ipc.ts'

/** Schemes the shell hands to the operating system's default handler. */
const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/** Schemes the client can open in one of its own browsers. */
const CLIENT_SCHEMES = new Set(['http:', 'https:'])

/** Pages that asked to be told every address their content opens. */
const listening = new WeakSet<WebContents>()

/** Scheme of an address, or undefined when the text is not an address. */
function schemeOf(url: string): string | undefined {
  try {
    return new URL(url).protocol
  } catch {
    // Not an address at all: no handler applies to it.
    return undefined
  }
}

/**
 * Open one address in the operating system's default handler.
 * @param url - the address as the content wrote it.
 * @returns true when the address was handed over; false when no handler applies.
 */
export function openExternalAddress(url: string): boolean {
  const scheme = schemeOf(url)
  if (scheme === undefined || !EXTERNAL_SCHEMES.has(scheme)) return false
  void shell.openExternal(url).catch((error: unknown) => {
    console.error('avn desktop: the system browser refused an address', error)
  })
  return true
}

/**
 * Record that a page takes the addresses its own content opens.
 * @param contents - the page that subscribed.
 */
export function listenForPageLinks(contents: WebContents): void {
  listening.add(contents)
}

/**
 * Hand one address to the page that asked for it, or to the operating system.
 *
 * A listening page is told the address and opens it where its own policy says
 * (the session's browser, the Chromium the agent drives, or the system
 * browser), so the address is never opened twice. Everything else — a page the
 * client does not drive, and every scheme the client cannot load — keeps the
 * operating-system handoff.
 * @param contents - the page whose content asked to open the address.
 * @param url - the address as the content wrote it.
 * @returns true when the address was taken; false when nothing can open it.
 */
export function openContentAddress(contents: WebContents, url: string): boolean {
  const scheme = schemeOf(url)
  if (scheme === undefined) return false
  if (listening.has(contents) && CLIENT_SCHEMES.has(scheme)) {
    contents.send(DESKTOP_IPC.linksOpen, url)
    return true
  }
  return openExternalAddress(url)
}
