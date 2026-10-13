/** Right sidebar browser copy: the pane's chrome and its Settings section. */
import type { SearchEngineId } from '../search-engines.ts'

/** English dictionary; the key union is derived from it. */
export const en = {
  'address.label': 'Address',
  'address.suggestions': 'Search suggestions',
  'address.search.google': 'Search Google or enter a URL',
  'address.search.duckduckgo': 'Search DuckDuckGo or enter a URL',
  'navigation': 'Navigation',
  'back': 'Back',
  'forward': 'Forward',
  'refresh': 'Refresh',
  'stop': 'Stop',
  'loading': 'Loading…',
  'openInChrome': 'Open in Chrome',
  'link.open': 'Open',
  'link.openInSidebar': 'Open in sidebar',
  'link.copy': 'Copy Link',
  'capture': 'Copy screenshot',
  'capture.done': 'Screenshot copied',
  'capture.failed': 'Screenshot failed',
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
  'browser.engine': 'Search engine',
  'browser.engine.description': 'Used when an address-bar entry is not a web address.',
  'engine.google': 'Google',
  'engine.duckduckgo': 'DuckDuckGo',
}

/** Dictionary key union owned by this plugin. */
export type SidebarBrowserKey = keyof typeof en

/** Placeholder naming the engine an address-bar query searches with. */
export const SEARCH_PLACEHOLDER_KEYS: Record<SearchEngineId, SidebarBrowserKey> = {
  google: 'address.search.google',
  duckduckgo: 'address.search.duckduckgo',
}

/** Engine names offered by the Settings row, in offer order. */
export const ENGINE_NAME_KEYS: Record<SearchEngineId, SidebarBrowserKey> = {
  google: 'engine.google',
  duckduckgo: 'engine.duckduckgo',
}

/** Chinese dictionary. */
export const zh: Record<SidebarBrowserKey, string> = {
  'address.label': '地址',
  'address.suggestions': '搜索建议',
  'address.search.google': '使用 Google 搜索或输入网址',
  'address.search.duckduckgo': '使用 DuckDuckGo 搜索或输入网址',
  'navigation': '导航',
  'back': '后退',
  'forward': '前进',
  'refresh': '刷新',
  'stop': '停止',
  'loading': '加载中…',
  'openInChrome': '在 Chrome 中打开',
  'link.open': '打开',
  'link.openInSidebar': '在侧边栏中打开',
  'link.copy': '复制链接',
  'capture': '复制截图',
  'capture.done': '截图已复制',
  'capture.failed': '截图失败',
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
  'browser.engine': '搜索引擎',
  'browser.engine.description': '当地址栏输入的不是网址时使用。',
  'engine.google': 'Google',
  'engine.duckduckgo': 'DuckDuckGo',
}
