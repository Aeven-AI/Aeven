/** Typed English and Chinese copy owned by the Electron shell. */

export const en = {
  startupFailed: 'Aeven could not start',
  startupFailedDetail: 'Startup stopped with the error below. View → Toggle Developer Tools stays available; close this window to quit.',
  settingsMenu: 'Settings…',
  fileMenu: 'File',
  editMenu: 'Edit',
  viewMenu: 'View',
  pasteAsTextMenu: 'Paste as Text',
  dictateMenu: 'Dictate with Aeven',
  speechMenu: 'Speech',
  actualSizeMenu: 'Actual Size',
  minimizeWindow: 'Minimize',
  maximizeWindow: 'Maximize',
  closeWindow: 'Close',
  zoomInMenu: 'Zoom In',
  zoomOutMenu: 'Zoom Out',
  enterFullScreenMenu: 'Enter Full Screen',
  exitFullScreenMenu: 'Exit Full Screen',
  checkUpdatesMenu: 'Check for Updates…',
  updateCheckFailedTitle: 'Update Check Failed',
  unknownError: 'Unknown error',
  updateCheckTitle: 'Check for Updates',
  updateCurrent: 'You already have the latest version.',
  updateTitle: 'Aeven Update',
  updateAvailable: 'An update is available',
  updateDetail: 'Aeven {version}\n\nThis release includes its matching avn version. The application will restart after installation.',
  installAndRestart: 'Install and Restart',
  later: 'Later',
  updateFailedTitle: 'Update Failed',
  quitWhileWorkingTitle: 'Aeven is still working',
  quitWhileWorkingDetail: 'Quitting stops the tasks that are running now.',
  quitAnyway: 'Quit Anyway',
  cancel: 'Cancel',
  openApplication: 'Open Aeven',
  quitApplication: 'Quit Aeven',
  copyLink: 'Copy Link',
  copyImage: 'Copy Image',
  signInContinuing: 'Continuing to sign in…',
  signInDone: 'You are signed in to Aeven. You can close this tab and return to the app.',
  signInFailed: 'Sign-in did not finish. Return to Aeven and try again.',
} as const

/** Every Desktop locale supplies the complete English key set. */
export type DesktopMessages = { readonly [Key in keyof typeof en]: string }

export const zh = {
  startupFailed: 'Aeven 无法启动',
  startupFailedDetail: '启动因以下错误而停止。仍可使用“视图 → 切换开发者工具”；关闭此窗口即可退出。',
  settingsMenu: '设置…',
  fileMenu: '文件',
  editMenu: '编辑',
  viewMenu: '视图',
  pasteAsTextMenu: '粘贴为纯文本',
  dictateMenu: '使用 Aeven 听写',
  speechMenu: '语音',
  actualSizeMenu: '实际大小',
  minimizeWindow: '最小化',
  maximizeWindow: '最大化',
  closeWindow: '关闭',
  zoomInMenu: '放大',
  zoomOutMenu: '缩小',
  enterFullScreenMenu: '进入全屏幕',
  exitFullScreenMenu: '退出全屏幕',
  checkUpdatesMenu: '检查更新…',
  updateCheckFailedTitle: '更新检查失败',
  unknownError: '未知错误',
  updateCheckTitle: '检查更新',
  updateCurrent: '当前已是最新版本。',
  updateTitle: 'Aeven 更新',
  updateAvailable: '发现可用更新',
  updateDetail: 'Aeven {version}\n\n新版本绑定匹配的 avn，安装后将重新启动。',
  installAndRestart: '安装并重启',
  later: '稍后',
  updateFailedTitle: '更新失败',
  quitWhileWorkingTitle: 'Aeven 仍在工作',
  quitWhileWorkingDetail: '退出将停止正在运行的任务。',
  quitAnyway: '仍然退出',
  cancel: '取消',
  openApplication: '打开 Aeven',
  quitApplication: '退出 Aeven',
  copyLink: '复制链接',
  copyImage: '复制图片',
  signInContinuing: '正在继续登录…',
  signInDone: '已登录 Aeven。可以关闭此标签页并返回应用。',
  signInFailed: '登录未完成。请返回 Aeven 重试。',
} as const satisfies DesktopMessages

/** Locale payload exposed to the Desktop-owned renderer. */
export interface DesktopLocale {
  readonly id: 'en' | 'zh-CN'
  readonly messages: DesktopMessages
}

/** Resolve Electron's locale to one shipped Desktop dictionary. */
export function resolveDesktopLocale(locale: string): DesktopLocale {
  return locale.toLowerCase().startsWith('zh')
    ? { id: 'zh-CN', messages: zh }
    : { id: 'en', messages: en }
}

/** Replace named placeholders in one locale-owned message. */
export function formatDesktopMessage(
  message: string,
  values: Readonly<Record<string, string>>,
): string {
  return message.replaceAll(/\{([^{}]+)\}/gu, (placeholder, key: string) => values[key] ?? placeholder)
}
