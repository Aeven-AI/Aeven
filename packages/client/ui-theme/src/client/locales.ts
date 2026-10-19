/** `settings.theme` namespace dictionaries (the Appearance and font-size rows' copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'appearance.title': '外观',
  'appearance.intro': '主题、字号，以及对话的显示方式。',
  'appearance.light': '浅色',
  'appearance.dark': '深色',
  'appearance.system': '跟随系统',
  'fontSize.title': '字号大小',
  'fontSize.description': '影响整个界面',
  'fontSize.increase': '增大字号',
  'fontSize.decrease': '减小字号',
} satisfies Record<string, string>

/** The settings.theme namespace key union. */
export type ThemeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'appearance.title': 'Appearance',
  'appearance.intro': 'Theme, text size, and how conversations look.',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.system': 'System',
  'fontSize.title': 'Font size',
  'fontSize.description': 'Affects the whole interface',
  'fontSize.increase': 'Increase font size',
  'fontSize.decrease': 'Decrease font size',
} satisfies Record<ThemeKey, string>

/** Spanish dictionary, checked complete against the zh key set. */
export const es = {
  'appearance.title': 'Apariencia',
  'appearance.intro': 'Tema, tamaño del texto y aspecto de las conversaciones.',
  'appearance.light': 'Claro',
  'appearance.dark': 'Oscuro',
  'appearance.system': 'Sistema',
  'fontSize.title': 'Tamaño de fuente',
  'fontSize.description': 'Afecta a toda la interfaz',
  'fontSize.increase': 'Aumentar el tamaño de fuente',
  'fontSize.decrease': 'Reducir el tamaño de fuente',
} satisfies Record<ThemeKey, string>
