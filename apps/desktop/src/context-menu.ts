/** Right-click menu for every page the shell hosts: Chromium shows none unless the embedder builds one. */

import {
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  type ContextMenuParams,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron'
import { appMenuRows } from './app-menu.ts'
import { DESKTOP_IPC, type DesktopMenuItem } from './ipc.ts'
import type { DesktopMessages } from './locale.ts'

/**
 * Menu items for one right-click: spelling suggestions and undo/redo in an
 * editable field, the edit actions on every page with each enabled from
 * Chromium's edit flags, and link or image copy actions.
 * @param contents - page that was right-clicked.
 * @param params - Chromium's description of the click target.
 * @param messages - shell copy for the items without an Electron role.
 * @returns the items in display order; empty when nothing applies.
 */
export function contextMenuTemplate(
  contents: WebContents,
  params: ContextMenuParams,
  messages: DesktopMessages,
): MenuItemConstructorOptions[] {
  const groups: MenuItemConstructorOptions[][] = []
  if (params.isEditable && params.misspelledWord !== '') {
    groups.push(params.dictionarySuggestions.map(suggestion => ({
      label: suggestion,
      click: () => { contents.replaceMisspelling(suggestion) },
    })))
  }
  if (params.isEditable) {
    groups.push([
      { role: 'undo', enabled: params.editFlags.canUndo },
      { role: 'redo', enabled: params.editFlags.canRedo },
    ])
  }
  groups.push([
    { role: 'cut', enabled: params.editFlags.canCut },
    { role: 'copy', enabled: params.editFlags.canCopy },
    { role: 'paste', enabled: params.editFlags.canPaste },
    { role: 'selectAll', enabled: params.editFlags.canSelectAll },
  ])
  if (params.linkURL !== '') {
    groups.push([{ label: messages.copyLink, click: () => { clipboard.writeText(params.linkURL) } }])
  }
  if (params.mediaType === 'image' && params.hasImageContents) {
    groups.push([{ label: messages.copyImage, click: () => { contents.copyImageAt(params.x, params.y) } }])
  }
  return groups
    .filter(group => group.length > 0)
    .flatMap((group, index) => index === 0 ? group : [{ type: 'separator' as const }, ...group])
}

/**
 * Show the context menu on every right-click in one page.
 * @param contents - page to attach to.
 * @param messages - shell copy for the non-role items.
 */
export function installContextMenu(contents: WebContents, messages: DesktopMessages): void {
  contents.on('context-menu', (_event, params) => {
    // Native edit roles act on the focused contents, which may still be
    // another page of this window when the click lands in a guest page.
    contents.focus()
    const template = contextMenuTemplate(contents, params, messages)
    if (template.length > 0) Menu.buildFromTemplate(template).popup()
  })
}

/**
 * Pop one menu the app page described, at the pointer, and settle on the row
 * the reader chose.
 *
 * The menu is drawn in this process because a native menu is the only one that
 * behaves like the rest of the desktop; the rows come from the page because it
 * is the side that knows what its own links and file names mean. A menu
 * dismissed without a choice settles on null, which is the same answer for a
 * reader who pressed Escape and one who clicked elsewhere.
 * @param window - the window the menu belongs to, which keeps it up while the window is key.
 * @param rows - the validated rows to show, in display order.
 * @returns the chosen row's id, or null when the menu closed without a choice.
 */
export async function popupAppMenu(window: BrowserWindow, rows: readonly DesktopMenuItem[]): Promise<string | null> {
  return await new Promise<string | null>((resolve) => {
    let settled = false
    const settle = (id: string | null): void => {
      if (settled) return
      settled = true
      resolve(id)
    }
    const template: MenuItemConstructorOptions[] = rows.map(row => row.type === 'separator'
      ? { type: 'separator' }
      : {
        id: row.id,
        label: row.label,
        ...row.enabled === undefined ? {} : { enabled: row.enabled },
        click: () => { settle(row.id) },
      })
    Menu.buildFromTemplate(template).popup({ window, callback: () => { settle(null) } })
  })
}

/**
 * Register the app page's menu requests.
 * @param isAppSender - whether a message comes from the application window's own page.
 */
export function registerContextMenuIpc(isAppSender: (event: IpcMainInvokeEvent) => boolean): void {
  ipcMain.handle(DESKTOP_IPC.appMenuShow, async (event, items: unknown) => {
    if (!isAppSender(event)) throw new Error('avn desktop: rejected a menu request from an unowned renderer')
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window === null) throw new Error('avn desktop: a menu request named no window')
    return await popupAppMenu(window, appMenuRows(items))
  })
}

