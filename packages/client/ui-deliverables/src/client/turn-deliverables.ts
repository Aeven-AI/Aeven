/**
 * Turn-scoped produced-file Definition and readers. Client-only and
 * model-free: paths come from successful first-party mutation calls and
 * verified generated-file result metadata, never the closing prose.
 */
import { diffArrays } from 'diff'
import { isAppendSurfaceEvent } from '@aeven/session/surface'
import type { TurnTailOwnerProps } from '@aeven/client-ui-chat/client'
import type { ConversationNodeDefinition } from '@aeven/client-ui-conversation/client'
import type { MarkdownFileMentions } from '@aeven/client-ui-primitives'

/** Lines one successful mutation added and deleted. */
interface LineCounts {
  readonly added: number
  readonly deleted: number
}

/** One successful mutation of a path. */
interface ProducedPath {
  readonly seq: number
  readonly path: string
  /** Whether the mutation created the file rather than changing an existing one. */
  readonly created: boolean
  /** Line counts, absent when the tool records none. */
  readonly counts?: LineCounts | undefined
}

/** One produced file of a turn, its mutations folded together. */
export interface ProducedFile {
  /** The path as the first mutation spelled it. */
  readonly path: string
  /** Whether the turn's first mutation of the path created the file. */
  readonly created: boolean
  /** Summed line counts, absent when any mutation of the path recorded none. */
  readonly counts?: LineCounts | undefined
}

/** A recognized mutation call, held until its result settles. */
interface MutationCall {
  readonly name: string
  readonly path: string
  /** The `write` tool's full new content, whose lines a create adds. */
  readonly content?: string | undefined
  /** Whether the call itself names a create (`str_replace_editor` `create`). */
  readonly creates: boolean
}

/** Immutable produced-file facts published against one Turn. */
export interface DeliverablesTurnData {
  readonly produced: readonly ProducedPath[]
}

declare module '@aeven/client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Successful mutation paths accumulated in this Turn. */
    deliverables: DeliverablesTurnData
  }
}

interface DeliverablesState extends DeliverablesTurnData {
  readonly turn: number
  readonly calls: ReadonlyMap<string, readonly MutationCall[]>
}

/**
 * Extract the paths from a supported first-party mutation call: one per
 * file, several for an `edit` with a `files` list. Session
 * `tool/call` events are root calls; Code Dispatch children do not enter this
 * Definition independently.
 * @param name - wire tool name.
 * @param argsRaw - model-produced JSON arguments.
 * @returns each mutated path and what its result needs; empty when the call is not a supported mutation.
 */
function mutationCalls(name: string, argsRaw: string): MutationCall[] {
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
      return path === null ? [] : [{ name, path, content: args.content as string, creates: false }]
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
 * Lines a text holds, not counting the empty remainder after a final newline.
 * @param text - file text.
 * @returns the line count; 0 for empty text.
 */
function lineCount(text: string): number {
  if (text === '') return 0
  const lines = text.split('\n').length
  return text.endsWith('\n') ? lines - 1 : lines
}

/**
 * Added and deleted lines of the `write`/`edit` result-time hunks.
 *
 * Each hunk carries three context lines on each side, so the counts come from a
 * line diff of the hunk's two sides rather than their lengths.
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
function settledMutation(call: MutationCall, text: string, meta: unknown): Pick<ProducedPath, 'created' | 'counts'> {
  if (call.name === 'str_replace_editor') return { created: call.creates }
  // `write` reports `Created file` for a path that did not exist, and records
  // hunks only for an update, so a create's lines are its whole content.
  if (call.name === 'write' && /\bCreated file\b/.test(text)) {
    return { created: true, counts: { added: lineCount(call.content ?? ''), deleted: 0 } }
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

/** A non-blank path preserves the exact spelling supplied to the tool. */
function pathValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/** Narrow parsed JSON to an argument object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Files produced by one Turn data value.
 *
 * The source is the arguments of successful `write`, `edit`, and mutating
 * `str_replace_editor` calls and verified generated-file metadata, not the closing prose: a produced file must be
 * listed whether or not the model remembered to name it. Reads, unsupported
 * tools, malformed calls, and failed results contribute nothing. Paths keep
 * first-seen order and appear once, so a file written and then edited in the
 * same turn is one entry.
 *
 * The Conversation Location index owns turn membership before this function
 * runs, so paths cannot spill across turns and this derivation does not infer
 * boundaries from neighboring presentation Nodes.
 * @param data - engine-published Deliverables data for one Turn.
 * @param seq - closing Assistant seq; later Tool settlements are excluded.
 * @returns Produced paths in first-seen order; empty when the turn wrote nothing.
 */
export function producedForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly string[] {
  return producedFilesForClosing(data, seq).map(file => file.path)
}

/**
 * Files produced by one Turn data value, each path's mutations folded into
 * one entry: created when the first mutation created it, with line counts
 * summed while every mutation recorded them.
 * @param data - engine-published Deliverables data for one Turn.
 * @param seq - closing Assistant seq; later Tool settlements are excluded.
 * @returns Produced files in first-seen order; empty when the turn wrote nothing.
 */
export function producedFilesForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly ProducedFile[] {
  if (data === undefined) return []
  const files = new Map<string, ProducedFile>()
  for (const produced of data.produced) {
    if (produced.seq > seq) continue
    const seen = files.get(produced.path)
    if (seen === undefined) {
      files.set(produced.path, { path: produced.path, created: produced.created, counts: produced.counts })
      continue
    }
    const counts = seen.counts === undefined || produced.counts === undefined
      ? undefined
      : { added: seen.counts.added + produced.counts.added, deleted: seen.counts.deleted + produced.counts.deleted }
    files.set(produced.path, { ...seen, counts })
  }
  return [...files.values()]
}

/**
 * Claim the turn-tail chain only when its closing turn produced files.
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns Produced files as the component's match, or null to decline before mount.
 */
export function selectProducedFiles(owner: TurnTailOwnerProps): readonly ProducedFile[] | null {
  const files = producedFilesForClosing(owner.turn.data.get('deliverables'), owner.seq)
  return files.length === 0 ? null : files
}

/** Turn-local successful mutation accumulator; it publishes no view Node. */
export const deliverablesDefinition: ConversationNodeDefinition<DeliverablesState> = {
  kind: 'deliverables',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('deliverables start requires turn/start')
    return { turn: match.event.data.turn, calls: new Map(), produced: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      const calls = new Map(context.state.calls)
      calls.set(
        String(match.event.data.callId),
        mutationCalls(match.event.data.name, match.event.data.arguments),
      )
      return { ...context.state, calls }
    }
    if (match.event.type !== 'tool/result') return context.state
    const result = match.event.data.message.content[0]
    if (result.isError === true) return context.state
    const { seq, data: { meta } } = match.event
    if (isRecord(meta) && Array.isArray(meta.producedFiles)) {
      const produced = meta.producedFiles.flatMap((file: unknown) =>
        isRecord(file) && pathValue(file.path) !== null && typeof file.created === 'boolean'
          ? [{ seq, path: file.path as string, created: file.created }]
          : [])
      return { ...context.state, produced: [...context.state.produced, ...produced] }
    }
    const callId = String(match.event.data.message.source.callId)
    const calls = context.state.calls.get(callId)
    if (calls === undefined || calls.length === 0) return context.state
    const text = result.content.map(block => block.type === 'text' ? block.text : '').join('\n')
    const produced = calls.map(call => ({ seq, path: call.path, ...settledMutation(call, text, meta) }))
    return { ...context.state, produced: [...context.state.produced, ...produced] }
  },
  buildLocationData: (context, scope, previous) => {
    if (scope !== 'turn' || context.state === undefined) return null
    if (previous?.kind === 'turn'
      && previous.turn === context.state.turn
      && previous.key === 'deliverables'
      && previous.value.produced === context.state.produced) return previous
    return {
      kind: 'turn',
      turn: context.state.turn,
      key: 'deliverables',
      value: { produced: context.state.produced },
    }
  },
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

/**
 * The folder a path sits in, relative to the workspace root when it lies inside it.
 * @param path - A produced path, absolute or workspace-relative.
 * @param cwd - The session workspace root, when known.
 * @returns The folder below `cwd`, the folder as written otherwise, or `''` at the root.
 */
export function parentFolder(path: string, cwd: string | undefined): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const folder = at === -1 ? '' : path.slice(0, at)
  if (cwd === undefined) return folder
  const root = cwd.replace(/[\\/]+$/, '')
  if (folder === root) return ''
  const inside = folder.startsWith(`${root}/`) || folder.startsWith(`${root}\\`)
  return inside ? folder.slice(root.length + 1) : folder
}

/**
 * File-mention vocabulary over one turn's produced paths, for the closing
 * message's prose: an inline-code token opens the file it names. A token
 * resolves by exact path, or by being exactly the basename of exactly one
 * produced path — a basename two paths share stays inert rather than
 * guessing, so a mention link can never open the wrong file or 404.
 * @param paths - The turn's produced paths (tool order, already deduped).
 * @param openFile - The chat view's file opener.
 * @param label - Localizes the accessible open-label for a resolved path.
 * @param menu - Shows this reader's own menu for a resolved path; omitted where
 * the client has none, which leaves the platform's menu in place.
 * @returns The resolver MarkdownText consumes; the full path rides `title`,
 * the same disambiguator the row's chips carry.
 */
export function producedFileMentions(
  paths: readonly string[],
  openFile: (path: string) => void,
  label: (path: string) => string,
  menu?: (path: string) => void,
): MarkdownFileMentions {
  return {
    resolve(value) {
      const path = paths.includes(value) ? value : onlyPathWithBasename(paths, value)
      if (path === undefined) return undefined
      return {
        open: () => { openFile(path) },
        label: label(path),
        title: path,
        ...menu === undefined ? {} : { menu: () => { menu(path) } },
      }
    },
  }
}

/** The single produced path whose basename is exactly `value`, else undefined. */
function onlyPathWithBasename(paths: readonly string[], value: string): string | undefined {
  const matches = paths.filter(path => basename(path) === value)
  return matches.length === 1 ? matches[0] : undefined
}
