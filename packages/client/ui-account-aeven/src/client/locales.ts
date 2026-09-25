/** `account.aeven` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'account.aeven'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger.aria': '账户菜单',
  'avatar.alt': '头像',
  'account': '账户',
  'settings': '设置',
  'logout': '退出登录',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<AccountAevenKey, string> = {
  'trigger.aria': 'Account menu',
  'avatar.alt': 'profile',
  'account': 'Account',
  'settings': 'Settings',
  'logout': 'Log out',
}

/** Key domain of the Aeven account namespace. */
export type AccountAevenKey = keyof typeof zh
