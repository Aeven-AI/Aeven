/** `deliverables` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'deliverables'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'produced.label': '产物',
  'produced.title': '已创建 {count} 个文件',
  'produced.fileKind': '文件',
  'produced.preview': '在侧边栏预览',
  'produced.all': '全部 {count} 个文件',
  'produced.collapse': '收起',
  'changes.title': '已编辑 {count} 个文件',
  'changes.singleTitle': '已编辑 {name}',
  'changes.added': '+{count}',
  'changes.deleted': '-{count}',
  'produced.open': '打开 {name}',
  'produced.showInFolder': '在文件夹中显示',
  'produced.showInFinder': '在访达中显示',
  'produced.showInExplorer': '在资源管理器中显示',
  'file.open': '打开',
  'file.openIn': '在 {app} 中打开',
  'file.copyRelativePath': '复制相对路径',
  'file.copyFullPath': '复制完整路径',
}

/** English dictionary (same key set). */
export const en: Record<DeliverablesKey, string> = {
  'produced.label': 'Produced',
  'produced.title': 'Created {count} files',
  'produced.fileKind': 'File',
  'produced.preview': 'Preview in sidebar',
  'produced.all': 'All {count} files',
  'produced.collapse': 'Collapse',
  'changes.title': 'Edited {count} files',
  'changes.singleTitle': 'Edited {name}',
  'changes.added': '+{count}',
  'changes.deleted': '-{count}',
  'produced.open': 'Open {name}',
  'produced.showInFolder': 'Show in folder',
  'produced.showInFinder': 'Show in Finder',
  'produced.showInExplorer': 'Show in Explorer',
  'file.open': 'Open',
  'file.openIn': 'Open in {app}',
  'file.copyRelativePath': 'Copy relative path',
  'file.copyFullPath': 'Copy full path',
}

/** Union of this namespace's dictionary keys. */
export type DeliverablesKey = keyof typeof zh

/** Spanish dictionary, checked complete against the zh key set. */
export const es: Record<DeliverablesKey, string> = {
  'produced.label': 'Archivos generados',
  'produced.title': '{count} archivos creados',
  'produced.fileKind': 'Archivo',
  'produced.preview': 'Vista previa en la barra lateral',
  'produced.all': 'Los {count} archivos',
  'produced.collapse': 'Contraer',
  'changes.title': '{count} archivos editados',
  'changes.singleTitle': 'Editado {name}',
  'changes.added': '+{count}',
  'changes.deleted': '-{count}',
  'produced.open': 'Abrir {name}',
  'produced.showInFolder': 'Mostrar en la carpeta',
  'produced.showInFinder': 'Mostrar en Finder',
  'produced.showInExplorer': 'Mostrar en el Explorador',
  'file.open': 'Abrir',
  'file.openIn': 'Abrir en {app}',
  'file.copyRelativePath': 'Copiar la ruta relativa',
  'file.copyFullPath': 'Copiar la ruta completa',
}
