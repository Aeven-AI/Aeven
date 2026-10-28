/** `voice-input` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'voice-input'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  dictate: '听写',
  cancelRecording: '取消录音',
  transcribe: '转写录音',
  cancelTranscription: '取消转写',
  transcribing: '正在转写',
  failed: '语音识别失败：{message}',
  title: '语音输入',
  intro: '听写会把你说的话添加到消息中。',
  model: '语音模型',
  modelUnprepared: '需要下载后使用听写。',
  modelPreparing: '正在准备语音模型…',
  modelReady: '可直接使用',
  modelFailed: '语音模型下载失败。请重试。',
  prepare: '下载',
  retryPrepare: '重试',
  downloadProgress: '下载进度',
  reconnecting: '正在连接语音服务…',
  loading: '正在读取语音服务…',
  unavailable: '当前浏览器不支持录音，请使用支持麦克风的浏览器。',
  permission: '麦克风权限未开启，请在浏览器和系统设置中允许访问。',
}

/** Keys of the voice-input dictionaries. */
export type VoiceKey = keyof typeof zh

/** English dictionary with the same complete key set. */
export const en: Record<VoiceKey, string> = {
  dictate: 'Dictate',
  cancelRecording: 'Cancel recording',
  transcribe: 'Transcribe recording',
  cancelTranscription: 'Cancel transcription',
  transcribing: 'Transcription in progress',
  failed: 'Speech recognition failed: {message}',
  title: 'Voice input',
  intro: 'Dictation adds what you say to your message.',
  model: 'Voice model',
  modelUnprepared: 'Download it to use dictation.',
  modelPreparing: 'Getting the voice model ready…',
  modelReady: 'Ready for use',
  modelFailed: 'Could not download the voice model. Please try again.',
  prepare: 'Download',
  retryPrepare: 'Retry',
  downloadProgress: 'Download progress',
  reconnecting: 'Connecting to Voice…',
  loading: 'Loading Voice…',
  unavailable: 'This browser cannot record audio. Use a browser with microphone support.',
  permission: 'Microphone access is disabled. Allow it in browser and system settings.',
}

/**
 * Spanish dictionary, checked complete against the zh key set.
 */
export const es = {
  'dictate': 'Dictar',
  'cancelRecording': 'Cancelar grabación',
  'transcribe': 'Transcribir grabación',
  'cancelTranscription': 'Cancelar transcripción',
  'transcribing': 'Transcripción en curso',
  'failed': 'Falló el reconocimiento de voz: {message}',
  'title': 'Entrada de voz',
  'intro': 'El dictado agrega lo que dices a tu mensaje.',
  'model': 'Modelo de voz',
  'modelUnprepared': 'Descárgalo para usar el dictado.',
  'modelPreparing': 'Preparando el modelo de voz…',
  'modelReady': 'Listo para usar',
  'modelFailed': 'No se pudo descargar el modelo de voz. Inténtalo de nuevo.',
  'prepare': 'Descargar',
  'retryPrepare': 'Reintentar',
  'downloadProgress': 'Progreso de la descarga',
  'reconnecting': 'Conectando con Voz…',
  'loading': 'Cargando Voz…',
  'unavailable': 'Este navegador no puede grabar audio. Usa uno compatible con micrófono.',
  'permission': 'El acceso al micrófono está desactivado. Actívalo en los ajustes del navegador y del sistema.',
} satisfies Record<VoiceKey, string>
