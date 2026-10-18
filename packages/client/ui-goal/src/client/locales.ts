/** `goal` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'objective.aria': '目标内容',
  'commandInput.aria': '指令输入',
  'action.save': '保存目标',
  'action.cancel': '取消编辑',
  'action.pause': '暂停目标',
  'action.resume': '恢复目标',
  'action.edit': '编辑目标',
  'action.clear': '清除目标',
} satisfies Record<string, string>

/** The goal namespace key union. */
export type GoalKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'objective.aria': 'Goal objective',
  'commandInput.aria': 'Command input',
  'action.save': 'Save goal',
  'action.cancel': 'Cancel edit',
  'action.pause': 'Pause goal',
  'action.resume': 'Resume goal',
  'action.edit': 'Edit goal',
  'action.clear': 'Clear goal',
} satisfies Record<GoalKey, string>

/** Spanish dictionary, checked complete against the zh key set. */
export const es = {
  'objective.aria': 'Objetivo de la meta',
  'commandInput.aria': 'Entrada de comandos',
  'action.save': 'Guardar la meta',
  'action.cancel': 'Cancelar la edición',
  'action.pause': 'Pausar la meta',
  'action.resume': 'Reanudar la meta',
  'action.edit': 'Editar la meta',
  'action.clear': 'Borrar la meta',
} satisfies Record<GoalKey, string>
