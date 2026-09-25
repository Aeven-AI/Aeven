/** `imagine` namespace dictionaries: the Imagine start page's own copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '想象',
  'placeholder': '描述你想象的画面…',
  'add': '添加',
  'send': '发送',
} satisfies Record<string, string>

/** The imagine namespace key union. */
export type ImagineKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Imagine',
  'placeholder': 'Describe what you want to imagine…',
  'add': 'Add',
  'send': 'Send',
} satisfies Record<ImagineKey, string>

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Imagine start page's copy. */
    imagine: ImagineKey
  }
}
