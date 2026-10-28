/** Copy dictionaries for the Settings → Sync section. */

/** English dictionary and key source of truth. */
export const en = {
  nav: 'Sync',
  intro: 'Your conversations, memory, and settings stay the same on every device you sign in on. They are encrypted before they leave this device.',
  loading: 'Loading…',
  error: 'Could not load this right now.',
  retry: 'Retry',
  failed: 'That did not work. Try again.',
  enabled: 'Sync this device',
  enabledBody: 'Turn this off to keep this device to itself. What it already has stays here.',
  disabled: 'Sync is off on this device',
  starting: 'Connecting to your account…',
  connecting: 'Connecting…',
  online: 'Up to date',
  offline: 'Offline. Changes are kept and sync when you are back online.',
  syncing: 'Syncing…',
  progress: '{sent} / {total}',
  devices: 'Devices',
  thisDevice: 'this device',
  unnamed: 'Unnamed device',
  remove: 'Remove',
}

/** Locale key of this section. */
export type SyncLocaleKey = keyof typeof en

/** Chinese dictionary. */
export const zh = {
  nav: '同步',
  intro: '你的对话、记忆和设置在你登录的每台设备上保持一致。它们在离开这台设备之前就已加密。',
  loading: '加载中…',
  error: '暂时无法加载。',
  retry: '重试',
  failed: '操作未成功，请重试。',
  enabled: '同步这台设备',
  enabledBody: '关闭后，这台设备的内容只留在本机。已有的内容会保留在这里。',
  disabled: '这台设备已关闭同步',
  starting: '正在连接你的账户…',
  connecting: '正在连接…',
  online: '已是最新',
  offline: '离线。更改会保留，恢复联网后同步。',
  syncing: '正在同步…',
  progress: '{sent} / {total}',
  devices: '设备',
  thisDevice: '这台设备',
  unnamed: '未命名设备',
  remove: '移除',
} satisfies Record<SyncLocaleKey, string>

/** Spanish dictionary. */
export const es = {
  nav: 'Sincronización',
  intro: 'Tus conversaciones, tu memoria y tus ajustes se mantienen iguales en cada dispositivo donde inicias sesión. Se cifran antes de salir de este dispositivo.',
  loading: 'Cargando…',
  error: 'No se pudo cargar ahora.',
  retry: 'Reintentar',
  failed: 'No funcionó. Inténtalo de nuevo.',
  enabled: 'Sincronizar este dispositivo',
  enabledBody: 'Desactívalo para que este dispositivo quede aparte. Lo que ya tiene se queda aquí.',
  disabled: 'La sincronización está desactivada en este dispositivo',
  starting: 'Conectando con tu cuenta…',
  connecting: 'Conectando…',
  online: 'Al día',
  offline: 'Sin conexión. Los cambios se guardan y se sincronizan cuando vuelvas a estar en línea.',
  syncing: 'Sincronizando…',
  progress: '{sent} / {total}',
  devices: 'Dispositivos',
  thisDevice: 'este dispositivo',
  unnamed: 'Dispositivo sin nombre',
  remove: 'Quitar',
} satisfies Record<SyncLocaleKey, string>
