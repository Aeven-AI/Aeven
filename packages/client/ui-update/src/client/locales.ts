/** `update` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'update'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': 'Aeven 更新',
  'close': '关闭',
  'checking': '正在检查更新',
  'current': '当前已是最新版本。',
  'downloading': '正在下载更新',
  'downloadingPercent': '正在下载更新 - {percent}%',
  'preparing': '正在准备更新',
  'ready': '更新已可安装。',
  'readyDetail': '重启即切换到新版本。',
  'restart': '重启并安装',
  'later': '稍后',
  'installing': '正在安装更新',
  'failed': '无法检查更新。',
  'failedWith': '无法检查更新：{message}',
  'retry': '重试',
} as const

/** Dictionary key set. */
export type UpdateKey = keyof typeof zh

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<UpdateKey, string> = {
  'title': 'Aeven update',
  'close': 'Close',
  'checking': 'Checking for updates',
  'current': 'You already have the latest version.',
  'downloading': 'Downloading update',
  'downloadingPercent': 'Downloading update - {percent}%',
  'preparing': 'Preparing update',
  'ready': 'Update is ready to install.',
  'readyDetail': 'Restart switches to the new version.',
  'restart': 'Restart and install',
  'later': 'Later',
  'installing': 'Installing update',
  'failed': 'The update could not be checked.',
  'failedWith': 'The update could not be checked: {message}',
  'retry': 'Try again',
}

/**
 * Spanish dictionary, checked complete against the zh key set.
 */
export const es = {
  'title': 'Actualización de Aeven',
  'close': 'Cerrar',
  'checking': 'Buscando actualizaciones',
  'current': 'Ya tienes la última versión.',
  'downloading': 'Descargando actualización',
  'downloadingPercent': 'Descargando actualización - {percent}%',
  'preparing': 'Preparando actualización',
  'ready': 'Actualización lista para instalar.',
  'readyDetail': 'Al reiniciar cambias a la nueva versión.',
  'restart': 'Reiniciar e instalar',
  'later': 'Más tarde',
  'installing': 'Instalando actualización',
  'failed': 'No se pudo buscar la actualización.',
  'failedWith': 'No se pudo buscar la actualización: {message}',
  'retry': 'Reintentar',
} satisfies Record<UpdateKey, string>
