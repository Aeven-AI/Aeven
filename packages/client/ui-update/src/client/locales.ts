/** `update` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'update'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': 'Aeven 更新',
  'close': '关闭',
  'checking': '正在检查更新…',
  'current': '当前已是最新版本。',
  'downloading': '正在下载更新 {version}…',
  'downloadingPercent': '正在下载更新 {version} — {percent}%',
  'preparing': '正在后台准备更新 {version}，可继续使用 Aeven…',
  'ready': '更新 {version} 已可安装。',
  'readyDetail': '重启后即切换到新版本。',
  'restart': '重启并安装',
  'later': '稍后',
  'installing': '正在安装更新 {version}，Aeven 将重新启动。',
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
  'checking': 'Checking for updates…',
  'current': 'You already have the latest version.',
  'downloading': 'Downloading update {version}…',
  'downloadingPercent': 'Downloading update {version} — {percent}%',
  'preparing': 'Preparing update {version} in the background. You can keep using Aeven…',
  'ready': 'Update {version} is ready to install.',
  'readyDetail': 'Restarting switches Aeven to the new version.',
  'restart': 'Restart and install',
  'later': 'Later',
  'installing': 'Installing update {version}. Aeven restarts when it is done.',
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
  'checking': 'Buscando actualizaciones…',
  'current': 'Ya tienes la última versión.',
  'downloading': 'Descargando la actualización {version}…',
  'downloadingPercent': 'Descargando la actualización {version} — {percent}%',
  'preparing': 'Preparando la actualización {version} en segundo plano. Puedes seguir usando Aeven…',
  'ready': 'La actualización {version} está lista para instalar.',
  'readyDetail': 'Al reiniciar, Aeven pasa a la nueva versión.',
  'restart': 'Reiniciar e instalar',
  'later': 'Más tarde',
  'installing': 'Instalando la actualización {version}. Aeven se reiniciará al terminar.',
  'failed': 'No se pudo buscar la actualización.',
  'failedWith': 'No se pudo buscar la actualización: {message}',
  'retry': 'Reintentar',
} satisfies Record<UpdateKey, string>
