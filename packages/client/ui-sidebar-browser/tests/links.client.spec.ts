// @vitest-environment jsdom
/**
 * ui-sidebar-browser desktop links: which right-clicks the client answers for,
 * the rows the link menu shows, where each row leads, and that the shell's own
 * report of an opened address lands in the system-browser destination.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopLinksBridge, DesktopMenuBridge, DesktopMenuItem } from '../src/client/guest.ts'
import {
  LINK_MENU_ROWS, externalLinkAt, installLinkHandling, linkMenuRows, runLinkMenuRow,
  type LinkDestinations,
} from '../src/client/links.ts'

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/** A translate stand-in that names its own key, so a row's copy is readable. */
const t = ((key: string) => key) as unknown as Parameters<typeof linkMenuRows>[0]

function destinations(): LinkDestinations & { readonly calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    openInSidebar: url => { calls.push(`sidebar:${url}`) },
    openInSystemBrowser: url => { calls.push(`system:${url}`) },
    copyLink: url => { calls.push(`copy:${url}`) },
  }
}

function shells(): {
  readonly menus: DesktopMenuBridge
  readonly links: DesktopLinksBridge
  readonly shown: DesktopMenuItem[][]
  readonly reported: ((url: string) => void)[]
} {
  const shown: DesktopMenuItem[][] = []
  const reported: ((url: string) => void)[] = []
  return {
    shown,
    reported,
    menus: {
      show: (items) => {
        shown.push([...items])
        // The reader chooses the first row, which is the one every menu here shows.
        const first = items.find(item => item.type === 'row')
        return Promise.resolve(first === undefined ? null : first.id)
      },
    },
    links: {
      onOpen: (listener) => {
        reported.push(listener)
        return () => { reported.splice(reported.indexOf(listener), 1) }
      },
    },
  }
}

describe('the link menu', () => {
  it('names its three rows in the plugin dictionary, with one separator', () => {
    expect(linkMenuRows(t)).toEqual([
      { type: 'row', id: LINK_MENU_ROWS.system, label: 'link.open' },
      { type: 'row', id: LINK_MENU_ROWS.sidebar, label: 'link.openInSidebar' },
      { type: 'separator' },
      { type: 'row', id: LINK_MENU_ROWS.copy, label: 'link.copy' },
    ])
  })

  it('runs the destination each row names, and says which rows are its own', () => {
    const target = destinations()
    expect(runLinkMenuRow(LINK_MENU_ROWS.sidebar, 'https://a.test/', target)).toBe(true)
    expect(runLinkMenuRow(LINK_MENU_ROWS.system, 'https://b.test/', target)).toBe(true)
    expect(runLinkMenuRow(LINK_MENU_ROWS.copy, 'https://c.test/', target)).toBe(true)
    expect(runLinkMenuRow('something-else', 'https://d.test/', target)).toBe(false)
    expect(target.calls).toEqual(['sidebar:https://a.test/', 'system:https://b.test/', 'copy:https://c.test/'])
  })
})

describe('the address a right-click landed on', () => {
  it('reads the anchor it is inside, and only for addresses that leave this application', () => {
    document.body.innerHTML = `
      <p><span id="deep">text</span></p>
      <a id="remote" href="https://docs.test/page"><span id="inner">docs</span></a>
      <a id="local" href="/settings">settings</a>
      <a id="mail" href="mailto:dev@test">mail</a>
      <a id="script" href="javascript:void 0">script</a>`
    const origin = window.location.origin
    expect(externalLinkAt(document.getElementById('inner'), origin)).toBe('https://docs.test/page')
    expect(externalLinkAt(document.querySelector('#remote span'), origin)).toBe('https://docs.test/page')
    expect(externalLinkAt(document.getElementById('local'), origin)).toBeUndefined()
    expect(externalLinkAt(document.getElementById('mail'), origin)).toBeUndefined()
    expect(externalLinkAt(document.getElementById('script'), origin)).toBeUndefined()
    expect(externalLinkAt(document.getElementById('deep'), origin)).toBeUndefined()
    expect(externalLinkAt(null, origin)).toBeUndefined()
    expect(externalLinkAt(document, origin)).toBeUndefined()
  })
})

describe('installed link handling', () => {
  it('shows the menu for an external link, suppresses the platform menu, and runs the chosen row', async () => {
    document.body.innerHTML = '<a id="remote" href="https://docs.test/page">docs</a>'
    const shell = shells()
    const target = destinations()
    const stop = installLinkHandling({ ...shell, ...target, t, document })

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    document.getElementById('remote')?.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(shell.shown).toHaveLength(1)
    // The menu settles asynchronously through the shell, so the row runs a
    // microtask later.
    await Promise.resolve()
    await Promise.resolve()
    expect(target.calls).toEqual([`system:https://docs.test/page`])

    // A destination the page did not ask for shows no menu and stays platform.
    const plain = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    document.body.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(false)
    expect(shell.shown).toHaveLength(1)

    stop()
    document.getElementById('remote')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(shell.shown).toHaveLength(1)
  })

  it('dismissing the menu leaves the desktop alone', async () => {
    document.body.innerHTML = '<a id="remote" href="https://docs.test/page">docs</a>'
    const shell = shells()
    const target = destinations()
    const menus: DesktopMenuBridge = { show: () => Promise.resolve(null) }
    const stop = installLinkHandling({ ...shell, menus, ...target, t, document })
    document.getElementById('remote')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await Promise.resolve()
    await Promise.resolve()
    expect(target.calls).toEqual([])
    stop()
  })

  it('opens an address the page asked for in the system browser, and stops when disposed', () => {
    const shell = shells()
    const target = destinations()
    const stop = installLinkHandling({ ...shell, ...target, t, document })
    for (const listener of shell.reported) listener('https://docs.test/page')
    expect(target.calls).toEqual(['system:https://docs.test/page'])
    stop()
    expect(shell.reported).toHaveLength(0)
  })

  it('reports a shell that refuses the menu without taking the page down', async () => {
    document.body.innerHTML = '<a id="remote" href="https://docs.test/page">docs</a>'
    const shell = shells()
    const target = destinations()
    const failure = new Error('refused')
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const stop = installLinkHandling({
      ...shell,
      ...target,
      t,
      document,
      menus: { show: () => Promise.reject(failure) },
    })
    document.getElementById('remote')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await Promise.resolve()
    await Promise.resolve()
    expect(error).toHaveBeenCalledWith('ui-sidebar-browser: the shell refused to show the link menu', failure)
    stop()
  })
})
