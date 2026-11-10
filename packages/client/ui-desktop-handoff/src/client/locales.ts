/** `desktop-handoff` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'desktop-handoff'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '在 Aeven 桌面版中使用',
  'close': '关闭',
  'reason.files': '文件保存在你自己的电脑上。在 Aeven 桌面版中继续，即可直接处理它们。',
  'reason.browser': '对话旁的浏览器运行在你自己的电脑上。在 Aeven 桌面版中继续即可使用。',
  'reason.terminal': '终端会在你自己的电脑上运行命令。在 Aeven 桌面版中继续即可使用。',
  'reason.device': '模拟器运行在你自己的电脑上。在 Aeven 桌面版中继续即可使用。',
  'reason.folder': '这个对话在你电脑上的一个文件夹中进行，目前没有打开的 Aeven 桌面版在运行它。在 Aeven 桌面版中继续即可接着处理。',
  'reason.computer': '操控你电脑上的应用需要在你自己的电脑上进行。在 Aeven 桌面版中继续，Aeven 就能替你使用它们。',
  'reason.models': '本地模型运行在你自己的电脑上。在 Aeven 桌面版中继续即可使用。',
  'open': '在 Aeven 桌面版中打开',
  'download': '下载 Aeven',
  'notOpened': '没有打开？请先安装 Aeven 桌面版。',
}

/** Every copy key the desktop-handoff dialog reads from its dictionaries. */
export type DesktopHandoffKey = keyof typeof zh

/** English dictionary. */
export const en: Record<DesktopHandoffKey, string> = {
  'title': 'Available in Aeven Desktop',
  'close': 'Close',
  'reason.files': 'Your files stay on your own computer. Continue in Aeven Desktop to work with them directly.',
  'reason.browser': 'The browser beside the conversation runs on your own computer. Continue in Aeven Desktop to use it.',
  'reason.terminal': 'The terminal runs commands on your own computer. Continue in Aeven Desktop to use it.',
  'reason.device': 'Simulators and emulators run on your own computer. Continue in Aeven Desktop to use them.',
  'reason.folder': 'This conversation works in a folder on your computer, and no Aeven Desktop is running it right now. Continue in Aeven Desktop to keep working in it.',
  'reason.computer': 'Working in the apps on your computer happens on your own computer. Continue in Aeven Desktop and Aeven can use them for you.',
  'reason.models': 'Local models run on your own computer. Continue in Aeven Desktop to use them.',
  'open': 'Open in Aeven Desktop',
  'download': 'Download Aeven',
  'notOpened': 'Nothing opened? Install Aeven Desktop first.',
}

/** Spanish dictionary. */
export const es: Record<DesktopHandoffKey, string> = {
  'title': 'Disponible en Aeven para escritorio',
  'close': 'Cerrar',
  'reason.files': 'Tus archivos se quedan en tu propio ordenador. Continúa en Aeven para escritorio para trabajar con ellos directamente.',
  'reason.browser': 'El navegador junto a la conversación funciona en tu propio ordenador. Continúa en Aeven para escritorio para usarlo.',
  'reason.terminal': 'El terminal ejecuta comandos en tu propio ordenador. Continúa en Aeven para escritorio para usarlo.',
  'reason.device': 'Los simuladores y emuladores funcionan en tu propio ordenador. Continúa en Aeven para escritorio para usarlos.',
  'reason.folder': 'Esta conversación trabaja en una carpeta de tu ordenador y ahora no hay ningún Aeven para escritorio abierto que la ejecute. Continúa en Aeven para escritorio para seguir con ella.',
  'reason.computer': 'Trabajar con las aplicaciones de tu ordenador ocurre en tu propio ordenador. Continúa en Aeven para escritorio y Aeven podrá usarlas por ti.',
  'reason.models': 'Los modelos locales funcionan en tu propio ordenador. Continúa en Aeven para escritorio para usarlos.',
  'open': 'Abrir en Aeven para escritorio',
  'download': 'Descargar Aeven',
  'notOpened': '¿No se abrió nada? Instala primero Aeven para escritorio.',
}
