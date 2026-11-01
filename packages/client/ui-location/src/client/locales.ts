/** `location` namespace dictionaries. */

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  title: '允许 Aeven 获取你的精确位置？',
  approvePrompt: '请允许系统的位置提示，然后等待位置。',
  blocked: '此网站的位置权限已被浏览器阻止。请在浏览器的网站设置中允许，然后按“好”。',
  denied: '你的系统设置不允许 Aeven 使用你的位置信息。请在那里允许，然后按“好”。',
  unavailable: '无法获取位置：{reason}',
  openSettings: '打开设置',
  no: '不',
  ok: '好',
} satisfies Record<string, string>

/** Location dictionary key union. */
export type LocationKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  title: 'Allow Aeven to know your precise location?',
  approvePrompt: 'Approve the location prompt, then wait for the position.',
  blocked: 'Location is blocked for this site. Allow it in your browser\'s site settings, then press OK.',
  denied: 'Your system settings do not allow Aeven to use your location. Allow it there, then press OK.',
  unavailable: 'Your location is unavailable: {reason}',
  openSettings: 'Open settings',
  no: 'No',
  ok: 'OK',
} satisfies Record<LocationKey, string>

/** Spanish dictionary, checked complete against the zh key set. */
export const es = {
  title: '¿Permitir que Aeven conozca tu ubicación exacta?',
  approvePrompt: 'Acepta la solicitud de ubicación y espera la posición.',
  blocked: 'La ubicación está bloqueada para este sitio. Permítela en los ajustes del sitio de tu navegador y luego pulsa Aceptar.',
  denied: 'Los ajustes de tu sistema no permiten que Aeven use tu ubicación. Permítelo allí y luego pulsa Aceptar.',
  unavailable: 'Tu ubicación no está disponible: {reason}',
  openSettings: 'Abrir ajustes',
  no: 'No',
  ok: 'Aceptar',
} satisfies Record<LocationKey, string>
