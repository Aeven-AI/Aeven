/** Right sidebar content selection copy. */

/** English dictionary; the key union is derived from it. */
export const en = {
  'browser.title': 'Browser',
  'browser.description': 'Open a page beside this session',
  'terminal.title': 'Terminal',
  'terminal.description': 'Run a shell in this workspace',
  'files.title': 'Workspace files',
  'files.description': 'Browse the files this session works on',
  'device.title': 'Device simulator',
  'device.description': 'Run an iOS simulator or Android emulator',
  'entry.unavailable': 'Not available yet',
  'back.label': 'Choose content',
}

/** Dictionary key union owned by this plugin. */
export type SidebarSelectKey = keyof typeof en

/** Chinese dictionary. */
export const zh: Record<SidebarSelectKey, string> = {
  'browser.title': '浏览器',
  'browser.description': '在此会话旁打开网页',
  'terminal.title': '终端',
  'terminal.description': '在此工作区运行 Shell',
  'files.title': '工作区文件',
  'files.description': '浏览此会话处理的文件',
  'device.title': '设备模拟器',
  'device.description': '运行 iOS 模拟器或 Android 模拟器',
  'entry.unavailable': '尚不可用',
  'back.label': '选择内容',
}
