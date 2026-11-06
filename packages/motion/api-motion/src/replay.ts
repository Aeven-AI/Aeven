/**
 * Rebuild a `show_motion` composition from the conversation log, for a Host that lacks the folder: the files the
 * conversation's successful `write` and `edit` calls produced inside the folder, up to that call.
 * @module @aeven/api-motion/replay
 */
import { isAbsolute, relative, sep } from 'node:path'

/** The log events the rebuild reads; other fields are ignored. */
export interface ReplayEvent {
  readonly type: string
  readonly data?: unknown
}

/** One replacement an `edit` call applied. */
interface Replacement {
  readonly oldString: string
  readonly newString: string
  readonly replaceAll: boolean
}

/** One file change a successful call made. */
type FileChange =
  | { readonly kind: 'write'; readonly path: string; readonly content: string }
  | { readonly kind: 'edit'; readonly path: string; readonly edits: readonly Replacement[] }

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined

/** The object entries of a list value; anything else is no entries. */
const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.flatMap((item: unknown) => { const entry = record(item); return entry === undefined ? [] : [entry] }) : []

/** The `edit` tool's replacements for one file: its top-level form or its `edits` list. */
function replacements(args: Record<string, unknown>): Replacement[] {
  const one = (value: Record<string, unknown>): Replacement | undefined =>
    typeof value.old_string === 'string' && typeof value.new_string === 'string'
      ? { oldString: value.old_string, newString: value.new_string, replaceAll: value.replace_all === true }
      : undefined
  const items = Array.isArray(args.edits) ? records(args.edits) : [args]
  return items.flatMap((item) => { const edit = one(item); return edit === undefined ? [] : [edit] })
}

/** The file changes one `write` or `edit` call's arguments describe. */
function changesOf(name: string, args: Record<string, unknown>): FileChange[] {
  if (name === 'write') {
    return typeof args.file_path === 'string' && typeof args.content === 'string'
      ? [{ kind: 'write', path: args.file_path, content: args.content }]
      : []
  }
  if (name !== 'edit') return []
  const files = Array.isArray(args.files) ? records(args.files) : [args]
  return files.flatMap(file => typeof file.file_path === 'string'
    ? [{ kind: 'edit' as const, path: file.file_path, edits: replacements(file) }]
    : [])
}

/** The rebuilt folder, or why it cannot be rebuilt. */
export type ReplayResult =
  | { readonly folder: string; readonly files: ReadonlyMap<string, string> }
  | { readonly error: string }

/**
 * Rebuild the composition the `show_motion` call `callId` showed.
 * @param events - the conversation's log, in order.
 * @param callId - the `show_motion` call.
 * @returns the folder's absolute path and its files by slash-separated path relative to it, or the reason no
 *   rebuild is possible: no such call, no `index.html` written by the conversation, or an edit that no longer applies.
 */
export function replayComposition(events: readonly ReplayEvent[], callId: string): ReplayResult {
  const calls = new Map<string, { name: string; args: Record<string, unknown> }>()
  let folder: string | undefined
  // Changes are applied in log order once their call succeeded; paths stay absolute until the folder is known.
  const applied = new Map<string, string>()
  for (const event of events) {
    const data = record(event.data)
    if (data === undefined) continue
    if (event.type === 'tool/call' && typeof data.callId === 'string' && typeof data.name === 'string') {
      let args: unknown
      try {
        args = JSON.parse(typeof data.arguments === 'string' ? data.arguments : '{}')
      } catch {
        // Arguments that are not JSON describe no file change; the call failed at validation.
        args = {}
      }
      calls.set(data.callId, { name: data.name, args: record(args) ?? {} })
      continue
    }
    if (event.type !== 'tool/result') continue
    const blocks = record(data.message)?.content
    const content = Array.isArray(blocks) ? record(blocks[0]) : undefined
    const resultId = typeof content?.toolCallId === 'string' ? content.toolCallId : undefined
    if (resultId === undefined) continue
    const call = calls.get(resultId)
    if (call === undefined) continue
    if (resultId === callId) {
      if (call.name !== 'show_motion') return { error: 'that call did not show a motion film' }
      const dir = record(data.meta)?.compositionDir
      if (typeof dir !== 'string' || !isAbsolute(dir)) return { error: 'that call names no composition folder' }
      folder = dir
      break
    }
    if (content?.isError === true) continue
    for (const change of changesOf(call.name, call.args)) {
      if (change.kind === 'write') {
        applied.set(change.path, change.content)
        continue
      }
      const before = applied.get(change.path)
      if (before === undefined) continue
      let after = before
      for (const edit of change.edits) {
        if (!after.includes(edit.oldString)) return { error: `an edit of ${change.path} no longer applies` }
        after = edit.replaceAll ? after.replaceAll(edit.oldString, edit.newString) : after.replace(edit.oldString, () => edit.newString)
      }
      applied.set(change.path, after)
    }
  }
  if (folder === undefined) return { error: 'no such show_motion call in this conversation' }
  const files = new Map<string, string>()
  for (const [path, text] of applied) {
    const inside = relative(folder, path)
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) continue
    files.set(inside.split(sep).join('/'), text)
  }
  if (!files.has('index.html')) return { error: 'the conversation did not write this film\'s index.html' }
  return { folder, files }
}
