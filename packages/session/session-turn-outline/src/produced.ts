/**
 * Produced-file facts read from one Turn's tool calls and results, shared by the client's turn-scoped
 * `deliverables` Definition and the Host's `turnDeliverables` projection unit so both list the same files.
 * Environment-neutral and model-free: paths come from successful first-party mutation calls and verified
 * generated-file result metadata, never from assistant prose.
 *
 * @module @aeven/session-turn-outline/produced
 */

import { diffArrays } from 'diff'
import type { ImageAttachmentRef } from '@aeven/attachment'

/** Lines one successful mutation added and deleted. */
export interface LineCounts {
  readonly added: number
  readonly deleted: number
}

/** One successful mutation of a path. */
export interface ProducedPath {
  readonly seq: number
  readonly path: string
  /** Whether the mutation created the file rather than changing an existing one. */
  readonly created: boolean
  /** Line counts, absent when the tool records none. */
  readonly counts?: LineCounts | undefined
  /** The stored copy of the file the deployment shared, absent when it shared none. */
  readonly attachmentId?: string | undefined
  /** That copy's full reference when the result shared it as an image, which the image renderer draws. */
  readonly image?: ImageAttachmentRef | undefined
  /** Whether a command declared the file as an output, rather than a file tool writing it. */
  readonly declared?: true | undefined
}

/** A recognized mutation call, held until its result settles. */
export interface MutationCall {
  readonly name: string
  readonly path: string
  /** Lines of the `write` tool's full new content, which a create adds. */
  readonly lines?: number | undefined
  /** Whether the call itself names a create (`str_replace_editor` `create`). */
  readonly creates: boolean
}

/**
 * Narrow parsed JSON to an object.
 * @param value - any parsed value.
 * @returns whether the value is a non-array object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A non-blank path, with the exact spelling supplied to the tool.
 * @param value - a candidate path value.
 * @returns the path, or null for a missing or blank one.
 */
export function pathValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/**
 * Trailing path segment, the part that identifies the file at a glance.
 * @param path - Slash- or backslash-separated path.
 * @returns The final segment, or the whole string when separator-free.
 */
export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/** Lines a text holds, not counting the empty remainder after a final newline. */
function lineCount(text: string): number {
  if (text === '') return 0
  const lines = text.split('\n').length
  return text.endsWith('\n') ? lines - 1 : lines
}

/**
 * Extract the paths from a supported first-party mutation call: one per file, several for an `edit` with a
 * `files` list. Session `tool/call` events are root calls; Code Dispatch children do not enter independently.
 * @param name - wire tool name.
 * @param argsRaw - model-produced JSON arguments.
 * @returns each mutated path and what its result needs; empty when the call is not a supported mutation.
 */
export function mutationCalls(name: string, argsRaw: string): MutationCall[] {
  let args: unknown
  try {
    args = JSON.parse(argsRaw) as unknown
  } catch {
    // Malformed model JSON is not a mutation the tool ran.
    return []
  }
  if (!isRecord(args)) return []
  let path: string | null
  switch (name) {
    case 'write':
      path = typeof args.content === 'string' ? pathValue(args.file_path) : null
      return path === null ? [] : [{ name, path, lines: lineCount(args.content as string), creates: false }]
    case 'edit': {
      const files = args.files === undefined ? [args] : args.files
      if (!Array.isArray(files) || files.length === 0) return []
      const calls: MutationCall[] = []
      for (const file of files as unknown[]) {
        path = isRecord(file) && validEditArgs(file) ? pathValue(file.file_path) : null
        if (path === null) return []
        calls.push({ name, path, creates: false })
      }
      return calls
    }
    case 'str_replace_editor':
      path = editorMutationPath(args)
      return path === null ? [] : [{ name, path, creates: args.command === 'create' }]
    default:
      return []
  }
}

/**
 * Added and deleted lines of the `write`/`edit` result-time hunks. Each hunk carries three context lines on each
 * side, so the counts come from a line diff of the hunk's two sides rather than their lengths.
 * @param meta - the tool result's opaque `meta`, `{ diffs: [{ path, oldText, newText }] }` for these tools.
 * @param path - the mutated path; only its hunks count, since one `edit` call can change several files.
 * @returns the counts, or undefined when `meta` holds no hunks.
 */
function hunkCounts(meta: unknown, path: string): LineCounts | undefined {
  if (!isRecord(meta) || !Array.isArray(meta.diffs)) return undefined
  let added = 0
  let deleted = 0
  for (const hunk of meta.diffs as unknown[]) {
    if (!isRecord(hunk) || typeof hunk.newText !== 'string') return undefined
    if (hunk.path !== path) continue
    const before = typeof hunk.oldText === 'string' ? hunk.oldText.split('\n') : []
    for (const part of diffArrays(before, hunk.newText.split('\n'))) {
      if (part.added) added += part.count
      else if (part.removed) deleted += part.count
    }
  }
  return { added, deleted }
}

/**
 * What one successful mutation did, read from its call and result.
 * @param call - the recognized call.
 * @param text - the result's model-facing text.
 * @param meta - the result's opaque `meta`.
 * @returns whether it created the file, and its line counts when the tool recorded them.
 */
export function settledMutation(call: MutationCall, text: string, meta: unknown): Pick<ProducedPath, 'created' | 'counts'> {
  if (call.name === 'str_replace_editor') return { created: call.creates }
  // `write` reports `Created file` for a path that did not exist, and records hunks only for an update, so a
  // create's lines are its whole content.
  if (call.name === 'write' && /\bCreated file\b/.test(text)) {
    return { created: true, counts: { added: call.lines ?? 0, deleted: 0 } }
  }
  return { created: false, counts: hunkCounts(meta, call.path) }
}

/** Validate the replacement fields that one `edit` file requires: the single form or an `edits` list. */
function validEditArgs(args: Readonly<Record<string, unknown>>): boolean {
  if (args.edits !== undefined) {
    return Array.isArray(args.edits) && args.edits.length > 0
      && (args.edits as unknown[]).every(edit => isRecord(edit) && validReplacement(edit))
  }
  return validReplacement(args)
}

/** Validate one literal replacement. */
function validReplacement(args: Readonly<Record<string, unknown>>): boolean {
  return typeof args.old_string === 'string'
    && args.old_string.length > 0
    && typeof args.new_string === 'string'
    && args.old_string !== args.new_string
    && (args.replace_all === undefined || typeof args.replace_all === 'boolean')
}

/** Extract a path only from a complete mutating editor command. */
function editorMutationPath(args: Readonly<Record<string, unknown>>): string | null {
  const path = pathValue(args.path)
  if (path === null) return null
  switch (args.command) {
    case 'create':
      return typeof args.file_text === 'string' ? path : null
    case 'str_replace':
      return typeof args.old_str === 'string'
        && args.old_str.length > 0
        && (args.new_str === undefined || typeof args.new_str === 'string')
        ? path
        : null
    case 'insert':
      return typeof args.insert_line === 'number'
        && Number.isInteger(args.insert_line)
        && args.insert_line >= 0
        && typeof args.new_str === 'string'
        ? path
        : null
    default:
      return null
  }
}

/**
 * The stored copies a tool result attached, by file name; a name two copies share maps to neither.
 * @param content - the result's content blocks.
 * @returns attachment ids by attachment name.
 */
export function storedCopies(content: readonly unknown[]): Map<string, string> {
  const copies = new Map<string, string>()
  const shared = new Set<string>()
  for (const block of content) {
    if (!isRecord(block) || (block.type !== 'file' && block.type !== 'image') || !isRecord(block.attachment)) continue
    const { name, attachmentId } = block.attachment
    if (typeof name !== 'string' || typeof attachmentId !== 'string') continue
    if (copies.has(name)) shared.add(name)
    copies.set(name, attachmentId)
  }
  for (const name of shared) copies.delete(name)
  return copies
}

/**
 * The images a tool result shared, by attachment id, with the full reference the image renderer draws them from.
 * @param content - the result's content blocks.
 * @returns image references by attachment id.
 */
export function sharedImages(content: readonly unknown[]): Map<string, ImageAttachmentRef> {
  const images = new Map<string, ImageAttachmentRef>()
  for (const block of content) {
    if (!isRecord(block) || block.type !== 'image' || !isRecord(block.attachment)) continue
    const ref = block.attachment as unknown as ImageAttachmentRef
    if (typeof ref.attachmentId === 'string') images.set(ref.attachmentId, ref)
  }
  return images
}

/**
 * The output files a command result declared in its `meta.producedFiles`, with their stored copies.
 * @param seq - the result's seq.
 * @param meta - the result's opaque `meta`.
 * @param content - the result's content blocks.
 * @returns the declared files, or undefined when the result declares none (a file-tool result).
 */
export function declaredOutputs(seq: number, meta: unknown, content: readonly unknown[]): ProducedPath[] | undefined {
  if (!isRecord(meta) || !Array.isArray(meta.producedFiles)) return undefined
  const stored = storedCopies(content)
  const images = sharedImages(content)
  return meta.producedFiles.flatMap((file: unknown) => {
    if (!isRecord(file) || pathValue(file.path) === null || typeof file.created !== 'boolean') return []
    // A result recorded before entries named their copy still attached it, under the file's own name.
    const attachmentId = typeof file.attachmentId === 'string' ? file.attachmentId : stored.get(basename(file.path as string))
    const image = attachmentId === undefined ? undefined : images.get(attachmentId)
    return [{
      seq, path: file.path as string, created: file.created, declared: true as const,
      ...attachmentId === undefined ? {} : { attachmentId },
      ...image === undefined ? {} : { image },
    }]
  })
}

/**
 * The model-facing text of a tool result.
 * @param content - the result's content blocks.
 * @returns the text blocks joined by newlines.
 */
export function resultText(content: readonly unknown[]): string {
  return content.map(block => isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : '').join('\n')
}
