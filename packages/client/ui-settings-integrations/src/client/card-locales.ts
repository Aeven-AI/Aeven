/** Typed copy for the connector cards drawn in the conversation. */

/** English dictionary and key source. */
export const en = {
  whatsapp: 'WhatsApp',
  you: 'You',
  voiceNote: 'Voice note',
  play: 'Play',
  pause: 'Pause',
  sticker: 'Sticker',
  gif: 'GIF',
  photo: 'Photo',
  video: 'Video',
  document: 'Document',
  download: 'Download',
  loading: 'Loading',
  unavailable: 'Not available on this device',
  messageCount: '{count} messages',
}

/** Keys of the connector card dictionary. */
export type ConnectorCardKey = keyof typeof en

/** Spanish dictionary. */
export const es: Record<ConnectorCardKey, string> = {
  whatsapp: 'WhatsApp',
  you: 'Tú',
  voiceNote: 'Nota de voz',
  play: 'Reproducir',
  pause: 'Pausar',
  sticker: 'Sticker',
  gif: 'GIF',
  photo: 'Foto',
  video: 'Vídeo',
  document: 'Documento',
  download: 'Descargar',
  loading: 'Cargando',
  unavailable: 'No disponible en este dispositivo',
  messageCount: '{count} mensajes',
}

/** Chinese dictionary. */
export const zh: Record<ConnectorCardKey, string> = {
  whatsapp: 'WhatsApp',
  you: '你',
  voiceNote: '语音消息',
  play: '播放',
  pause: '暂停',
  sticker: '贴纸',
  gif: 'GIF',
  photo: '照片',
  video: '视频',
  document: '文件',
  download: '下载',
  loading: '加载中',
  unavailable: '此设备上不可用',
  messageCount: '{count} 条消息',
}
