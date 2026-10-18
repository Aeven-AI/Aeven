/** `deliverables` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'deliverables'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'produced.label': '产物',
  'produced.file': '文件',
  'produced.folder': '所在文件夹',
  'produced.moreOne': '+ 1 个文件',
  'produced.more': '+ {count} 个文件',
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
  'produced.file': 'File',
  'produced.folder': 'Folder',
  'produced.moreOne': '+ 1 file',
  'produced.more': '+ {count} files',
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
  'produced.label': 'Generados',
  'produced.file': 'Archivo',
  'produced.folder': 'Carpeta',
  'produced.moreOne': '+ 1 archivo',
  'produced.more': '+ {count} archivos',
  'produced.open': 'Abrir {name}',
  'produced.showInFolder': 'Mostrar en la carpeta',
  'produced.showInFinder': 'Mostrar en Finder',
  'produced.showInExplorer': 'Mostrar en el Explorador',
  'file.open': 'Abrir',
  'file.openIn': 'Abrir en {app}',
  'file.copyRelativePath': 'Copiar la ruta relativa',
  'file.copyFullPath': 'Copiar la ruta completa',
}
