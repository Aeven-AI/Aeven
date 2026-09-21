/** Right sidebar shell controls copy. */

/** English dictionary; the key union is derived from it. */
export const en = {
  'toggle.open': 'Open right sidebar',
  'toggle.collapse': 'Collapse right sidebar',
}

/** Dictionary key union owned by this plugin. */
export type SidebarRightKey = keyof typeof en

/** Chinese dictionary. */
export const zh: Record<SidebarRightKey, string> = {
  'toggle.open': '打开右侧边栏',
  'toggle.collapse': '收起右侧边栏',
}
