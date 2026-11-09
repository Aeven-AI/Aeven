/** `read-aloud` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'read-aloud'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'voice.row': '系统语音',
  'voice.default': '默认',
  'voice.count': '{count} 个声音',
  'voice.loading': '正在加载声音…',
  'voice.unavailable': '无法加载声音列表',
  loading: '正在生成朗读',
  'message.read': '朗读这条消息',
  'message.stop': '停止朗读',
  'message.pause': '暂停朗读',
  'message.resume': '继续朗读',
  'message.failed': '无法朗读这条消息，点击重试',
}

/** Keys of the read-aloud dictionaries. */
export type ReadAloudKey = keyof typeof zh

/** English dictionary with the same complete key set. */
export const en: Record<ReadAloudKey, string> = {
  'voice.row': 'System voice',
  'voice.default': 'Default',
  'voice.count': '{count} voices',
  'voice.loading': 'Loading voices…',
  'voice.unavailable': 'Could not load the voice list',
  loading: 'Preparing the reading',
  'message.read': 'Read this message aloud',
  'message.stop': 'Stop reading',
  'message.pause': 'Pause reading',
  'message.resume': 'Resume reading',
  'message.failed': 'Could not read this message aloud; click to try again',
}

/** Spanish dictionary with the same complete key set. */
export const es: Record<ReadAloudKey, string> = {
  'voice.row': 'Voz del sistema',
  'voice.default': 'Predeterminada',
  'voice.count': '{count} voces',
  'voice.loading': 'Cargando voces…',
  'voice.unavailable': 'No se pudo cargar la lista de voces',
  loading: 'Preparando la lectura',
  'message.read': 'Leer este mensaje en voz alta',
  'message.stop': 'Detener la lectura',
  'message.pause': 'Pausar la lectura',
  'message.resume': 'Reanudar la lectura',
  'message.failed': 'No se pudo leer este mensaje en voz alta; haz clic para reintentar',
}
