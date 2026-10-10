/** Rows an app-page menu may contain, and the validation the shell applies to them before it pops one. */

import type { DesktopMenuItem } from './ipc.ts'

/** Most rows one app-page menu may carry; beyond this the page is not describing a menu. */
export const MAX_APP_MENU_ROWS = 32

/** Longest id one row may carry. */
const MAX_ID_LENGTH = 64

/** Longest label one row may carry, which is a model-free string the page supplies. */
const MAX_LABEL_LENGTH = 200

function fail(reason: string): never {
  throw new Error(`avn desktop: refusing an app-page menu ${reason}`)
}

function rowOf(value: unknown, index: number): DesktopMenuItem {
  if (typeof value !== 'object' || value === null) fail(`row ${String(index)} that is not an object`)
  const row = value as { type?: unknown; id?: unknown; label?: unknown; enabled?: unknown }
  if (row.type === 'separator') {
    if (row.id !== undefined || row.label !== undefined || row.enabled !== undefined) {
      fail(`separator ${String(index)} carrying a row's own fields`)
    }
    return { type: 'separator' }
  }
  if (row.type !== 'row') fail(`row ${String(index)} naming an unknown type`)
  if (typeof row.id !== 'string' || row.id === '' || row.id.length > MAX_ID_LENGTH) {
    fail(`row ${String(index)} without an id of at most ${String(MAX_ID_LENGTH)} characters`)
  }
  if (typeof row.label !== 'string' || row.label === '' || row.label.length > MAX_LABEL_LENGTH) {
    fail(`row ${String(index)} without a label of at most ${String(MAX_LABEL_LENGTH)} characters`)
  }
  if (row.enabled !== undefined && typeof row.enabled !== 'boolean') fail(`row ${String(index)} with a non-boolean enabled`)
  return { type: 'row', id: row.id, label: row.label, ...row.enabled === undefined ? {} : { enabled: row.enabled } }
}

/**
 * Validate the rows an app page asked the shell to show.
 *
 * The page is the only caller, and this is the wire into the shell's own
 * process, so a malformed list is refused rather than trimmed: a menu is
 * something a reader acts on, and a silently altered one would act on a row
 * the page never described.
 * @param input - the rows as the renderer sent them.
 * @returns the rows in display order.
 * @throws {Error} when the list is empty, oversized, or malformed.
 */
export function appMenuRows(input: unknown): DesktopMenuItem[] {
  if (!Array.isArray(input) || input.length === 0) fail('that is not a non-empty list')
  if (input.length > MAX_APP_MENU_ROWS) fail(`of more than ${String(MAX_APP_MENU_ROWS)} rows`)
  const rows = input.map((value, index) => rowOf(value, index))
  const ids = new Set<string>()
  for (const [index, row] of rows.entries()) {
    if (row.type === 'separator') {
      // A separator with nothing to separate is the page's own mistake, not a
      // layout the shell should guess at.
      if (index === 0 || index === rows.length - 1 || rows[index - 1]?.type === 'separator') {
        fail(`separator ${String(index)} with no rows to separate`)
      }
      continue
    }
    if (ids.has(row.id)) fail(`naming id "${row.id}" twice`)
    ids.add(row.id)
  }
  return rows
}
