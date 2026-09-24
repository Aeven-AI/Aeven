/** Right sidebar shell controls copy. */

/** English dictionary; the key union is derived from it. */
export const en = {
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Close sidebar',
}

/** Dictionary key union owned by this plugin. */
export type SidebarRightKey = keyof typeof en

/** Chinese dictionary. */
export const zh: Record<SidebarRightKey, string> = {
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '关闭侧边栏',
}
