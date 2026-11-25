/** Typed English and Chinese copy owned by the Electron shell. */

export const en = {
  startupFailed: 'Aeven could not start',
  startupFailedDetail: 'Startup stopped with the error below. View → Toggle Developer Tools stays available; close this window to quit.',
  startupFailedUpdateChecking: 'Checking for a newer version…',
  startupFailedUpdateDownloading: 'Downloading version {version}… {percent}%',
  startupFailedUpdateCurrent: 'No newer version is available yet.',
  startupFailedUpdateError: 'Could not check for a newer version: {message}',
  startupFailedUpdateReady: 'Version {version} is downloaded and installs when Æven restarts.',
  startupFailedUpdateQuestion: 'Version {version} is ready to install',
  startupFailedUpdateQuestionDetail: 'Æven could not start. Restarting installs the newer version, which may fix the problem.',
  restartAndUpdate: 'Restart and Update',
  notNow: 'Not Now',
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
  aboutMenu: 'About Aeven',
  aboutVersionLine: 'Version {version}',
  aboutCopyrightLine: '© Aeven',
  aboutElectronLine: 'Electron {version}',
  aboutBackendLine: 'Backend {version}',
  updateCheckAfterStartup: 'Checking for updates',
  setupUnpacking: 'Unpacking packages',
  setupInstalling: 'Installing packages',
  setupChecking: 'Starting for the first time',
  updateUnpacking: 'Unpacking packages',
  updateInstalling: 'Installing packages',
  updateChecking: 'Checking the new version',
  skippedPluginsTitle: 'Æven started without some features',
  skippedPluginsDetail: 'These parts failed to start and are switched off until the next start:\n\n{list}',
  quitWhileWorkingTitle: 'Aeven is still working',
  quitWhileWorkingDetail: 'Quitting stops the tasks that are running now.',
  quitAnyway: 'Quit Anyway',
  cancel: 'Cancel',
  openApplication: 'Open Aeven',
  quitApplication: 'Quit Aeven',
  copyLink: 'Copy Link',
  copyImage: 'Copy Image',
} as const

/** Every Desktop locale supplies the complete English key set. */
export type DesktopMessages = { readonly [Key in keyof typeof en]: string }

export const zh = {
  startupFailed: 'Aeven 无法启动',
  startupFailedDetail: '启动因以下错误而停止。仍可使用“视图 → 切换开发者工具”；关闭此窗口即可退出。',
  startupFailedUpdateChecking: '正在检查新版本…',
  startupFailedUpdateDownloading: '正在下载版本 {version}… {percent}%',
  startupFailedUpdateCurrent: '暂时没有更新的版本。',
  startupFailedUpdateError: '无法检查新版本：{message}',
  startupFailedUpdateReady: '版本 {version} 已下载，Æven 重新启动时安装。',
  startupFailedUpdateQuestion: '版本 {version} 已可安装',
  startupFailedUpdateQuestionDetail: 'Æven 无法启动。重新启动将安装新版本，可能会解决此问题。',
  restartAndUpdate: '重新启动并更新',
  notNow: '以后再说',
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
  aboutMenu: '关于 Aeven',
  aboutVersionLine: '版本 {version}',
  aboutCopyrightLine: '© Aeven',
  aboutElectronLine: 'Electron {version}',
  aboutBackendLine: '后端 {version}',
  updateCheckAfterStartup: '检查更新',
  setupUnpacking: '解压软件包',
  setupInstalling: '安装软件包',
  setupChecking: '首次启动',
  updateUnpacking: '解压软件包',
  updateInstalling: '安装软件包',
  updateChecking: '检查新版本',
  skippedPluginsTitle: 'Æven 启动时停用了部分功能',
  skippedPluginsDetail: '以下部分启动失败，在下次启动前保持关闭：\n\n{list}',
  quitWhileWorkingTitle: 'Aeven 仍在工作',
  quitWhileWorkingDetail: '退出将停止正在运行的任务。',
  quitAnyway: '仍然退出',
  cancel: '取消',
  openApplication: '打开 Aeven',
  quitApplication: '退出 Aeven',
  copyLink: '复制链接',
  copyImage: '复制图片',
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
