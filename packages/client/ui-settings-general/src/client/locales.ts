/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'general.nav': '通用设置',
  'general.intro': '新会话的默认设置，以及界面语言。',
  'general.advanced': '高级',
  'group.account': '账户',
  'background.title': '后台运行',
  'background.description': '关闭窗口后继续工作。',
  'background.info': '关闭窗口后，Æven 会留在菜单栏或系统托盘中，继续执行正在运行的任务和自动化。',
  'recall.title': '筛选记忆',
  'recall.description': '更精确，但更慢。',
  'recall.info': '开启后会影响速度：每个回答大约晚一秒开始。开启时，Æven 会在回答前多做一次模型调用，只挑出与这条消息相关的记忆。关闭时（默认），Æven 会拿到记忆找到的全部内容，并在回答时自行取舍。',
  'developer.title': '开发者模式',
  'developer.description': '显示为构建 Æven 本身准备的设置，例如 Agent 预设。',
  'connection.error': '连接异常',
  'connection.connecting': '连接中',
  'connection.connected': '连接成功',
  'connection.reconnect': '连接异常，点击立即重连',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'general.nav': 'General',
  'general.intro': 'Defaults for new sessions and the interface language.',
  'general.advanced': 'Advanced',
  'group.account': 'Account',
  'background.title': 'Run in the background',
  'background.description': 'Keep working after you close the window.',
  'background.info': 'When you close the window, Æven stays in the menu bar or system tray and keeps working on running tasks and automations.',
  'recall.title': 'Filter memories',
  'recall.description': 'More selective, but slower.',
  'recall.info': 'Turning this on slows Æven down: every answer starts about a second later. When on, Æven makes one extra model call before answering to pick only the memories that fit your message. When off (the default), Æven gets everything memory found and decides what matters while it answers.',
  'developer.title': 'Developer mode',
  'developer.description': 'Show settings for building Æven itself, such as agent presets.',
  'connection.error': 'Disconnected',
  'connection.connecting': 'Connecting',
  'connection.connected': 'Connected',
  'connection.reconnect': 'Disconnected, reconnect now',
} satisfies Record<SettingsKey, string>

/** Spanish dictionary, checked complete against the zh key set. */
export const es = {
  'trigger': 'Ajustes',
  'title': 'Ajustes',
  'close': 'Cerrar',
  'general.nav': 'General',
  'general.intro': 'Valores predeterminados para las sesiones nuevas y el idioma de la interfaz.',
  'general.advanced': 'Avanzado',
  'group.account': 'Cuenta',
  'background.title': 'Ejecutar en segundo plano',
  'background.description': 'Sigue trabajando al cerrar la ventana.',
  'background.info': 'Cuando cierres la ventana, Æven permanece en la barra de menús o en la bandeja del sistema y sigue trabajando en las tareas y automatizaciones en curso.',
  'recall.title': 'Filtrar recuerdos',
  'recall.description': 'Más selectivo, pero más lento.',
  'recall.info': 'Activarlo hace que Æven sea más lento: cada respuesta empieza aproximadamente un segundo más tarde. Si está activado, Æven hace una llamada extra al modelo antes de responder para elegir solo los recuerdos que encajan con tu mensaje. Si está desactivado (predeterminado), Æven recibe todo lo que la memoria encontró y decide qué importa mientras responde.',
  'developer.title': 'Modo desarrollador',
  'developer.description': 'Muestra los ajustes para construir Æven, como los preajustes de agentes.',
  'connection.error': 'Desconectado',
  'connection.connecting': 'Conectando',
  'connection.connected': 'Conectado',
  'connection.reconnect': 'Desconectado, reconectar ahora',
} satisfies Record<SettingsKey, string>
