/** Right sidebar content selection copy. */

/** English dictionary; the key union is derived from it. */
export const en = {
  'browser.title': 'Browser',
  'browser.description': 'Open a page beside this session',
  'terminal.title': 'Terminal',
  'terminal.description': 'Run a shell in this workspace',
  'files.title': 'Workspace files',
  'files.description': 'Browse the files this session works on',
  'device.title': 'Device simulator',
  'device.description': 'Run an iOS simulator or Android emulator',
  'entry.unavailable': 'Not available yet',
  'back.label': 'Choose content',
  'browser.tab': 'Browser',
  'terminal.tab': 'Terminal',
  'files.tab': 'Files',
  'device.tab': 'Device Emulator',
  'tabs.add': 'Add a surface',
  'tabs.close': 'Close {title}',
  'fullscreen.enter': 'Full screen',
  'fullscreen.exit': 'Exit full screen',
  'menu.close': 'Close',
  'menu.closeOthers': 'Close others',
  'menu.closeRight': 'Close to the right',
  'menu.closeAll': 'Close all',
}

/** Dictionary key union owned by this plugin. */
export type SidebarSelectKey = keyof typeof en

/** Chinese dictionary. */
export const zh: Record<SidebarSelectKey, string> = {
  'browser.title': '浏览器',
  'browser.description': '在此会话旁打开网页',
  'terminal.title': '终端',
  'terminal.description': '在此工作区运行 Shell',
  'files.title': '工作区文件',
  'files.description': '浏览此会话处理的文件',
  'device.title': '设备模拟器',
  'device.description': '运行 iOS 模拟器或 Android 模拟器',
  'entry.unavailable': '尚不可用',
  'back.label': '选择内容',
  'browser.tab': '浏览器',
  'terminal.tab': '终端',
  'files.tab': '文件',
  'device.tab': '设备模拟器',
  'tabs.add': '添加面板',
  'tabs.close': '关闭 {title}',
  'fullscreen.enter': '全屏',
  'fullscreen.exit': '退出全屏',
  'menu.close': '关闭',
  'menu.closeOthers': '关闭其他',
  'menu.closeRight': '关闭右侧',
  'menu.closeAll': '全部关闭',
}

/**
 * Spanish dictionary, checked complete against the zh key set.
 */
export const es = {
  'browser.title': 'Navegador',
  'browser.description': 'Abre una página junto a esta sesión',
  'terminal.title': 'Terminal',
  'terminal.description': 'Ejecuta un shell en este espacio de trabajo',
  'files.title': 'Archivos del espacio de trabajo',
  'files.description': 'Explora los archivos en los que trabaja esta sesión',
  'device.title': 'Simulador de dispositivos',
  'device.description': 'Ejecuta un simulador de iOS o un emulador de Android',
  'entry.unavailable': 'Aún no disponible',
  'back.label': 'Elegir contenido',
  'browser.tab': 'Navegador',
  'terminal.tab': 'Terminal',
  'files.tab': 'Archivos',
  'device.tab': 'Emulador de dispositivos',
  'tabs.add': 'Agregar panel',
  'tabs.close': 'Cerrar {title}',
  'fullscreen.enter': 'Pantalla completa',
  'fullscreen.exit': 'Salir de pantalla completa',
  'menu.close': 'Cerrar',
  'menu.closeOthers': 'Cerrar los demás',
  'menu.closeRight': 'Cerrar a la derecha',
  'menu.closeAll': 'Cerrar todos',
} satisfies Record<SidebarSelectKey, string>
