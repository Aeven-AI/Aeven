/** Opening a page outside the application, in the system browser where one is available. */

/** Page global the desktop shell's preload states. */
interface DesktopScope {
  avnDesktop?: { browser?: { openExternal: (url: string) => Promise<void> } }
}

/**
 * Where an external page opens.
 *
 * The desktop shell denies every window the page opens, so there the system
 * browser takes the page through the shell's own bridge. Served over HTTP a
 * tab must be opened while the click is still being handled or the browser
 * blocks it as a popup; `navigate` then points it at the address once known.
 * @returns a handle to navigate, and to close when there is nowhere to go.
 */
export function externalWindow(): { navigate: (url: string) => void; cancel: () => void } {
  const desktop = (globalThis as DesktopScope).avnDesktop?.browser
  if (desktop !== undefined) {
    return { navigate: (url) => { void desktop.openExternal(url) }, cancel: () => {} }
  }
  const tab = window.open('', '_blank')
  if (tab !== null) tab.opener = null
  return {
    navigate: (url) => {
      if (tab === null) window.location.assign(url)
      else tab.location.href = url
    },
    cancel: () => { tab?.close() },
  }
}
