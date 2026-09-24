/** Right sidebar browser copy. */

/** English dictionary; the key union is derived from it. */
export const en = {
  'address.placeholder': 'Enter URL',
  'address.label': 'Address',
  'navigation': 'Navigation',
  'back': 'Back',
  'forward': 'Forward',
  'refresh': 'Refresh',
  'stop': 'Stop',
  'loading': 'Loading…',
  'openExternal': 'Open in system browser',
  'capture': 'Copy screenshot',
  'capture.done': 'Screenshot copied',
  'menu.label': 'More',
  'menu.hardReload': 'Hard reload',
  'menu.devtools': 'Open DevTools',
  'menu.appearance': 'Appearance',
  'menu.zoom': 'Zoom',
  'menu.clearCookies': 'Clear cookies',
  'menu.clearCache': 'Clear cache',
  'scheme.system': 'System',
  'scheme.light': 'Light',
  'scheme.dark': 'Dark',
  'zoom.in': 'Zoom in',
  'zoom.out': 'Zoom out',
  'zoom.reset': 'Reset zoom',
}

/** Dictionary key union owned by this plugin. */
export type SidebarBrowserKey = keyof typeof en

/** Chinese dictionary. */
export const zh: Record<SidebarBrowserKey, string> = {
  'address.placeholder': '输入网址',
  'address.label': '地址',
  'navigation': '导航',
  'back': '后退',
  'forward': '前进',
  'refresh': '刷新',
  'stop': '停止',
  'loading': '加载中…',
  'openExternal': '在系统浏览器中打开',
  'capture': '复制截图',
  'capture.done': '截图已复制',
  'menu.label': '更多',
  'menu.hardReload': '强制重新加载',
  'menu.devtools': '打开开发者工具',
  'menu.appearance': '外观',
  'menu.zoom': '缩放',
  'menu.clearCookies': '清除 Cookie',
  'menu.clearCache': '清除缓存',
  'scheme.system': '跟随系统',
  'scheme.light': '浅色',
  'scheme.dark': '深色',
  'zoom.in': '放大',
  'zoom.out': '缩小',
  'zoom.reset': '重置缩放',
}
