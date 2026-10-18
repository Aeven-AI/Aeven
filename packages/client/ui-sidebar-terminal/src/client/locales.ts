/** Copy owned by the sidebar terminal feature. */
import type {} from '@aeven/client-ui-slots'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    sidebarTerminal: keyof typeof zh
  }
}

/** Simplified Chinese terminal copy. */
export const zh = {
  recoveryFailed: '恢复终端失败：{message}', retryRecovery: '重试恢复终端',
  shell: '选择 Shell', shellLoading: '正在读取 Shell…', shellEmpty: '没有可用的 Shell', description: '在会话工作区运行命令',
  title: '终端', new: '新建终端', loading: '正在读取终端环境…', creating: '正在启动…',
  connecting: '正在连接…', disconnected: '连接已断开。', reconnect: '重新连接',
  readonly: '此页面当前只读。', control: '接管输入',
  closed: '终端已关闭。', exited: '进程已退出（{code}）', failed: '终端错误：{message}',
  rename: '终端名称', unavailable: '不可用', retry: '重试',
  cleanupFailed: '终端「{title}」未能结束：{message}',
  missingTerminal: '此终端已不存在，请新建终端。',
  inputFull: '输入缓冲区已满，请重新连接后重试。',
  attachmentEnded: '终端连接已结束，请重新连接。',
  invalidOutput: '终端画面传输异常，请重新连接。',
  terminalLimit: '终端数量已达上限，请关闭不用的终端后重试。已退出的终端也计入数量。',
} satisfies Record<string, string>

/** English terminal copy. */
export const en = {
  recoveryFailed: 'Terminal recovery failed: {message}', retryRecovery: 'Retry terminal recovery',
  shell: 'Choose shell', shellLoading: 'Loading shells…', shellEmpty: 'No shells available', description: 'Run commands in the Session workspace',
  title: 'Terminal', new: 'New terminal', loading: 'Reading terminal environment…', creating: 'Starting…',
  connecting: 'Connecting…', disconnected: 'Disconnected.', reconnect: 'Reconnect',
  readonly: 'This view is read-only.', control: 'Take control',
  closed: 'Terminal closed.', exited: 'Process exited ({code})', failed: 'Terminal error: {message}',
  rename: 'Terminal name', unavailable: 'Unavailable', retry: 'Retry',
  cleanupFailed: 'Terminal “{title}” could not be ended: {message}',
  missingTerminal: 'This terminal no longer exists. Open a new terminal.',
  inputFull: 'The input buffer is full. Reconnect and try again.',
  attachmentEnded: 'The terminal connection ended. Reconnect to continue.',
  invalidOutput: 'The terminal screen could not be received. Reconnect to recover it.',
  terminalLimit: 'The terminal limit has been reached. Close unused terminals and try again. Exited terminals also count toward the limit.',
} satisfies Record<keyof typeof zh, string>

/**
 * Spanish dictionary, checked complete against the zh key set.
 */
export const es = {
  'recoveryFailed': 'No se pudo recuperar la terminal: {message}',
  'retryRecovery': 'Reintentar recuperación de la terminal',
  'shell': 'Elegir shell',
  'shellLoading': 'Cargando shells…',
  'shellEmpty': 'No hay shells disponibles',
  'description': 'Ejecuta comandos en el espacio de trabajo de la sesión',
  'title': 'Terminal',
  'new': 'Nueva terminal',
  'loading': 'Leyendo el entorno de terminal…',
  'creating': 'Iniciando…',
  'connecting': 'Conectando…',
  'disconnected': 'Conexión cerrada.',
  'reconnect': 'Reconectar',
  'readonly': 'Esta vista es de solo lectura.',
  'control': 'Tomar control',
  'closed': 'Terminal cerrada.',
  'exited': 'El proceso terminó ({code})',
  'failed': 'Error de terminal: {message}',
  'rename': 'Nombre de la terminal',
  'unavailable': 'No disponible',
  'retry': 'Reintentar',
  'cleanupFailed': 'No se pudo cerrar la terminal «{title}»: {message}',
  'missingTerminal': 'Esta terminal ya no existe. Abre una nueva terminal.',
  'inputFull': 'El búfer de entrada está lleno. Reconecta e inténtalo de nuevo.',
  'attachmentEnded': 'La conexión de la terminal terminó. Reconecta para continuar.',
  'invalidOutput': 'No se pudo recibir la pantalla de la terminal. Reconecta para recuperarla.',
  'terminalLimit': 'Se alcanzó el límite de terminales. Cierra las terminales sin usar e inténtalo de nuevo. Las terminales ya terminadas también cuentan para el límite.',
} satisfies Record<keyof typeof zh, string>
