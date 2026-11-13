/** `share` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'action.share': '分享',
  'dialog.title': '分享消息',
  'dialog.description': '任何拿到链接的人都能查看这条回复。你的名字和对话的其余部分不会公开。再次创建会更新同一个链接。',
  'dialog.close': '关闭',
  'dialog.preview': '链接预览',
  'dialog.previewLoading': '正在生成预览…',
  'dialog.link': '分享链接',
  'dialog.share': '创建链接',
  'dialog.copy': '复制链接',
  'dialog.copied': '已复制',
  'dialog.manage': '管理',
  'manage.title': '已创建的链接',
  'manage.close': '关闭',
  'manage.empty': '你还没有创建过任何链接。',
  'manage.loading': '正在加载…',
  'manage.open': '打开链接',
  'manage.delete': '删除链接',
  'manage.deleteAll': '删除所有链接',
  'manage.retry': '重试',
  'confirm.title': '删除所有链接？',
  'confirm.description': '所有链接都将失效，打开它们的人会看到链接已不存在。此操作无法撤销。',
  'confirm.cancel': '取消',
  'confirm.delete': '全部删除',
  'error.signed-out': '请先登录 Aeven 账户再分享。',
  'error.session-not-found': '找不到这段对话。',
  'error.target-not-found': '这条消息还不能分享。',
  'error.too-large': '这条回复太大，无法分享。',
  'error.share-limit': '你的链接已达上限。请先删除一些。',
  'error.not-found': '这个链接已不存在。',
  'error.unavailable': '暂时无法连接 Aeven，请稍后再试。',
} satisfies Record<string, string>

/** The share namespace key union. */
export type MessageShareKey = keyof typeof zh

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The share action, share dialog, and link manager copy. */
    share: MessageShareKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'action.share': 'Share',
  'dialog.title': 'Share message',
  'dialog.description': 'Anyone with the link can view this response. Your name and the rest of the chat stay private. Creating it again updates the same link.',
  'dialog.close': 'Close',
  'dialog.preview': 'Link preview',
  'dialog.previewLoading': 'Creating the preview…',
  'dialog.link': 'Share link',
  'dialog.share': 'Create link',
  'dialog.copy': 'Copy link',
  'dialog.copied': 'Copied',
  'dialog.manage': 'Manage',
  'manage.title': 'Created links',
  'manage.close': 'Close',
  'manage.empty': 'You haven’t created any links yet.',
  'manage.loading': 'Loading…',
  'manage.open': 'Open link',
  'manage.delete': 'Delete link',
  'manage.deleteAll': 'Delete all links',
  'manage.retry': 'Try again',
  'confirm.title': 'Delete all links?',
  'confirm.description': 'Every link will stop working, and anyone who opens one will see that it no longer exists. This can’t be undone.',
  'confirm.cancel': 'Cancel',
  'confirm.delete': 'Delete all',
  'error.signed-out': 'Sign in to your Aeven account to share.',
  'error.session-not-found': 'This conversation could not be found.',
  'error.target-not-found': 'This message can’t be shared yet.',
  'error.too-large': 'This response is too large to share.',
  'error.share-limit': 'You’ve reached the limit of links. Delete some first.',
  'error.not-found': 'This link no longer exists.',
  'error.unavailable': 'Aeven can’t be reached right now. Try again shortly.',
} satisfies Record<MessageShareKey, string>

/** Spanish dictionary, checked complete against the zh key set. */
export const es = {
  'action.share': 'Compartir',
  'dialog.title': 'Compartir mensaje',
  'dialog.description': 'Cualquiera con el enlace puede ver esta respuesta. Tu nombre y el resto del chat siguen siendo privados. Crearlo de nuevo actualiza el mismo enlace.',
  'dialog.close': 'Cerrar',
  'dialog.preview': 'Vista previa del enlace',
  'dialog.previewLoading': 'Creando la vista previa…',
  'dialog.link': 'Enlace para compartir',
  'dialog.share': 'Crear enlace',
  'dialog.copy': 'Copiar enlace',
  'dialog.copied': 'Copiado',
  'dialog.manage': 'Gestionar',
  'manage.title': 'Enlaces creados',
  'manage.close': 'Cerrar',
  'manage.empty': 'Todavía no has creado ningún enlace.',
  'manage.loading': 'Cargando…',
  'manage.open': 'Abrir enlace',
  'manage.delete': 'Eliminar enlace',
  'manage.deleteAll': 'Eliminar todos los enlaces',
  'manage.retry': 'Reintentar',
  'confirm.title': '¿Eliminar todos los enlaces?',
  'confirm.description': 'Todos los enlaces dejarán de funcionar y quien abra uno verá que ya no existe. No se puede deshacer.',
  'confirm.cancel': 'Cancelar',
  'confirm.delete': 'Eliminar todos',
  'error.signed-out': 'Inicia sesión en tu cuenta de Aeven para compartir.',
  'error.session-not-found': 'No se encontró esta conversación.',
  'error.target-not-found': 'Este mensaje aún no se puede compartir.',
  'error.too-large': 'Esta respuesta es demasiado grande para compartirla.',
  'error.share-limit': 'Has alcanzado el límite de enlaces. Elimina algunos primero.',
  'error.not-found': 'Este enlace ya no existe.',
  'error.unavailable': 'No se puede conectar con Aeven ahora mismo. Inténtalo de nuevo en un momento.',
} satisfies Record<MessageShareKey, string>
