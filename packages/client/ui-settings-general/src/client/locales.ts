/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'general.nav': '通用设置',
  'general.intro': '新会话的默认设置，以及界面语言。',
  'choice.on': '开启',
  'choice.off': '关闭',
  'background.title': '后台运行',
  'background.description': '关闭窗口后，Æven 会留在菜单栏或系统托盘中，继续执行正在运行的任务和自动化。',
  'developer.title': '开发者模式',
  'developer.description': '显示为构建 Æven 本身准备的设置，例如 Agent 预设。',
  'connection.error': '连接异常',
  'connection.retry': '立即重连',
  'connection.connecting': '连接中',
  'connection.connected': '连接成功',
  'connection.reconnect': '连接异常，点击立即重连',
  'connection.restart': '连接中，点击立即重连',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'general.nav': 'General',
  'general.intro': 'Defaults for new sessions and the interface language.',
  'choice.on': 'On',
  'choice.off': 'Off',
  'background.title': 'Run in the background',
  'background.description': 'When you close the window, Æven stays in the menu bar or system tray and keeps working on running tasks and automations.',
  'developer.title': 'Developer mode',
  'developer.description': 'Show settings for building Æven itself, such as agent presets.',
  'connection.error': 'Disconnected',
  'connection.retry': 'Reconnect now',
  'connection.connecting': 'Connecting',
  'connection.connected': 'Connected',
  'connection.reconnect': 'Disconnected, reconnect now',
  'connection.restart': 'Connecting, restart now',
} satisfies Record<SettingsKey, string>
