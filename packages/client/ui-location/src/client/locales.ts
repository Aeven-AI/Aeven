/** `location` namespace dictionaries. */

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  title: '允许 Aeven 获取你的精确位置？',
  approvePrompt: '请在浏览器的位置提示中选择允许。',
  blocked: '此网站的位置权限已被浏览器阻止。请在浏览器的网站设置中允许，然后按“好”。',
  unavailable: '无法获取位置：{reason}',
  no: '不',
  ok: '好',
} satisfies Record<string, string>

/** Location dictionary key union. */
export type LocationKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  title: 'Allow Aeven to know your precise location?',
  approvePrompt: 'Approve the location prompt from your browser.',
  blocked: 'Location is blocked for this site. Allow it in your browser\'s site settings, then press OK.',
  unavailable: 'Your location is unavailable: {reason}',
  no: 'No',
  ok: 'OK',
} satisfies Record<LocationKey, string>
