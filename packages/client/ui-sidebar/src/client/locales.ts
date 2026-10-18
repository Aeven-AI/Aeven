/** `sidebar` namespace dictionaries: shell controls (brand row, New chat link, Imagine row). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'session.new': '对话',
  'session.new.label': '对话',
} satisfies Record<string, string>

/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'session.new': 'Chat',
  'session.new.label': 'Chat',
} satisfies Record<SidebarKey, string>

/** Spanish dictionary, checked complete against the zh key set. */
export const es = {
  'session.new': 'Chat',
  'session.new.label': 'Chat',
} satisfies Record<SidebarKey, string>
