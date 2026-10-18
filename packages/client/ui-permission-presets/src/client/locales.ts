/** `settings.permission` namespace dictionaries (the Permission row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '权限',
  'description': '选择新会话的默认权限模式',
  'loading': '加载中',
  'unavailable': '不可用',
  'preset.readOnly': '仅可查看',
  'preset.workspaceWrite': '需要时先询问',
  'preset.fullAccess': '完全权限',
  'confirm.title': '确认启用完全权限？',
  'confirm.description': '启用完全权限会移除沙箱边界并停止审批询问：新会话中的智能体可以修改任何文件、运行任何命令，包括工作区之外的内容。除非你完全信任后续任务，否则建议改用「需要时先询问」。',
  'confirm.acknowledge': '我已了解风险，并愿意继续',
  'confirm.cancel': '取消',
  'confirm.enable': '启用完全权限',
} satisfies Record<string, string>

/** The settings.permission namespace key union. */
export type PermissionSettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Permission',
  'description': 'Choose the default permission mode for new sessions',
  'loading': 'Loading',
  'unavailable': 'Unavailable',
  'preset.readOnly': 'Read only',
  'preset.workspaceWrite': 'Ask for approval',
  'preset.fullAccess': 'Full access',
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access removes the sandbox boundary and stops approval prompts: agents in new sessions can change any file and run any command, including outside your workspace. Use Ask for approval instead unless you trust subsequent tasks completely.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
} satisfies Record<PermissionSettingsKey, string>

/** Simplified Chinese dictionary for the current-session popup gate. */
export const accessZh = {
  'preset.readOnly': '仅可查看',
  'preset.workspaceWrite': '需要时先询问',
  'preset.fullAccess': '完全权限',
  'confirm.title': '确认启用完全权限？',
  'confirm.description': '启用完全权限会移除沙箱边界并停止审批询问：智能体可以修改任何文件、运行任何命令，包括工作区之外的内容。除非你完全信任当前任务，否则建议改用「需要时先询问」。',
  'confirm.acknowledge': '我已了解风险，并愿意继续',
  'confirm.cancel': '取消',
  'confirm.enable': '启用完全权限',
} satisfies Record<string, string>

/** Current-session popup-gate key union. */
export type PermissionAccessKey = keyof typeof accessZh

/** English dictionary for the current-session popup gate. */
export const accessEn = {
  'preset.readOnly': 'Read only',
  'preset.workspaceWrite': 'Ask for approval',
  'preset.fullAccess': 'Full access',
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access removes the sandbox boundary and stops approval prompts: the agent can change any file and run any command, including outside your workspace. Use Ask for approval instead unless you trust this task completely.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
} satisfies Record<PermissionAccessKey, string>

/** Spanish dictionary, checked complete against the zh key set. */
export const es = {
  'title': 'Permisos',
  'description': 'Elige el modo de permisos predeterminado para las sesiones nuevas',
  'loading': 'Cargando',
  'unavailable': 'No disponible',
  'preset.readOnly': 'Solo lectura',
  'preset.workspaceWrite': 'Pedir aprobación',
  'preset.fullAccess': 'Acceso completo',
  'confirm.title': '¿Activar el acceso completo?',
  'confirm.description': 'El acceso completo elimina el límite del sandbox y detiene las solicitudes de aprobación: los agentes de las sesiones nuevas pueden modificar cualquier archivo y ejecutar cualquier comando, incluso fuera de tu espacio de trabajo. Usa «Pedir aprobación» en su lugar, a menos que confíes por completo en las próximas tareas.',
  'confirm.acknowledge': 'Entiendo los riesgos y quiero continuar',
  'confirm.cancel': 'Cancelar',
  'confirm.enable': 'Activar el acceso completo',
} satisfies Record<PermissionSettingsKey, string>

/** Spanish dictionary for the current-session popup gate. */
export const accessEs = {
  'preset.readOnly': 'Solo lectura',
  'preset.workspaceWrite': 'Pedir aprobación',
  'preset.fullAccess': 'Acceso completo',
  'confirm.title': '¿Activar el acceso completo?',
  'confirm.description': 'El acceso completo elimina el límite del sandbox y detiene las solicitudes de aprobación: el agente puede modificar cualquier archivo y ejecutar cualquier comando, incluso fuera de tu espacio de trabajo. Usa «Pedir aprobación» en su lugar, a menos que confíes por completo en esta tarea.',
  'confirm.acknowledge': 'Entiendo los riesgos y quiero continuar',
  'confirm.cancel': 'Cancelar',
  'confirm.enable': 'Activar el acceso completo',
} satisfies Record<PermissionAccessKey, string>
