/** Right-click menu for every page the shell hosts: Chromium shows none unless the embedder builds one. */

import { clipboard, Menu, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from 'electron'
import type { DesktopMessages } from './locale.ts'

/**
 * Menu items for one right-click: spelling suggestions and edit actions in an
 * editable field, Copy over a selection, and link or image copy actions.
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
    ], [
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll },
    ])
  } else if (params.selectionText.trim() !== '') {
    groups.push([{ role: 'copy' }])
  }
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
    const template = contextMenuTemplate(contents, params, messages)
    if (template.length > 0) Menu.buildFromTemplate(template).popup()
  })
}
