/**
 * Model-facing literal edit, unique-match by default, of one replacement or an ordered list
 * applied all-or-nothing. It obtains an optional guard from the single intent slot, calls
 * `ctx.fs.editText`, then records the observed version; no policy means an unconditional atomic
 * edit. A target the session never observed is observed here instead of refused: the literal
 * match against current content proves the model knows the text it replaces, while a target the
 * session observed earlier keeps that version as its guard, so a file changed since still fails
 * stale.
 * @module @aeven/tool-fs/src/edit
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@aeven/tools'
import type { DiffCallView, DiffResultView, ToolResult } from '@aeven/tools'
import { FsError } from '@aeven/fs'
import type { FsEditRequest, FsTarget, FsVersion } from '@aeven/fs'
import type { ToolExecution } from '@aeven/tools'
import { computeHunkDiffs, diffsFromMeta } from './diff.ts'
import { remediateFsError } from './error.ts'
import { sessionResolveOptions } from './session-cwd.ts'
import type { FsSandboxController } from './sandbox.ts'

/** Validated `edit` arguments after defaulting. */
interface EditInput {
  filePath: string
  /** Replacements in application order; one for the single form. */
  edits: FsEditRequest[]
}

/** One replacement in the `edits` list form. */
interface EditReplacementArgs {
  old_string: string
  new_string: string
  replace_all?: boolean
}

/**
 * The `edit` tool's validated arguments: the base parameters plus the two
 * escalation fields, advertised only under a confining `ctx.fs` (absent from
 * the schema otherwise, so the validator rejects them before `execute`).
 */
interface EditToolArgs {
  file_path: string
  old_string?: string
  new_string?: string
  replace_all?: boolean
  edits?: EditReplacementArgs[]
  sandbox_permissions?: string
  justification?: string
}

/**
 * Validate one replacement: a non-empty `old_string` and `old_string !== new_string`
 * (an equal pair would be a guaranteed no-op edit).
 */
function parseReplacement(args: EditReplacementArgs, label: string): FsEditRequest {
  if (args.old_string.length === 0) throw new Error(`${label}old_string must be a non-empty string`)
  if (args.old_string === args.new_string) throw new Error(`${label}old_string and new_string must differ`)
  return { oldString: args.old_string, newString: args.new_string, replaceAll: args.replace_all ?? false }
}

/**
 * Validate value constraints the schema DSL can't express: a non-blank
 * `file_path`, and exactly one of the single form (`old_string` with
 * `new_string`) or a non-empty `edits` list, each replacement valid.
 * @param args - the schema-validated raw tool arguments.
 * @returns the file path and the replacements in order, `replace_all` defaulted to false.
 */
export function parseEditArgs(args: Omit<EditToolArgs, 'sandbox_permissions' | 'justification'>): EditInput {
  if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')
  const single = args.old_string !== undefined || args.new_string !== undefined
  if (args.edits !== undefined) {
    if (single || args.replace_all !== undefined) throw new Error('pass either edits or old_string/new_string, not both')
    if (args.edits.length === 0) throw new Error('edits must contain at least one replacement')
    return { filePath: args.file_path, edits: args.edits.map((edit, index) => parseReplacement(edit, `edits[${String(index)}]: `)) }
  }
  if (args.old_string === undefined || args.new_string === undefined) {
    throw new Error('old_string and new_string are required unless edits is given')
  }
  return {
    filePath: args.file_path,
    edits: [parseReplacement({ old_string: args.old_string, new_string: args.new_string, ...args.replace_all === undefined ? {} : { replace_all: args.replace_all } }, '')],
  }
}

/**
 * The edit's version guard from the single intent slot. A target this session
 * never observed is observed now — stat, record, ask again — instead of being
 * refused; absence and non-files fail as a read would.
 * @param ctx - the plugin context providing the intent slot and filesystem.
 * @param target - the resolved edit target.
 * @param exec - the tool execution whose session owns the observation.
 * @returns the guard, or undefined when no policy is composed.
 */
async function editIntent(ctx: Context, target: FsTarget, exec: ToolExecution): Promise<{ version: FsVersion } | undefined> {
  try {
    return await ctx.waterfall('fs/edit-intent', target, exec, () => undefined)
  } catch (error: unknown) {
    if (!(error instanceof FsError) || error.code !== 'FS_NOT_OBSERVED') throw error
  }
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) {
    ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
    throw new FsError(`cannot edit "${target.displayPath}": not found`, 'FS_NOT_FOUND')
  }
  if (info.type !== 'file') throw new FsError(`cannot edit "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
  ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
  return await ctx.waterfall('fs/edit-intent', target, exec, () => undefined)
}

/**
 * Format an edit success (single-match, replace-all, or a list) as a Claude-style model-facing message.
 * @param displayPath - the backend-resolved path shown to the model.
 * @param replaceAll - selects the all-occurrences wording over the single-replacement one.
 * @param count - how many replacements a list applied; 1 for the single form.
 * @returns the confirmation sentence the model sees as the tool result.
 */
export function formatEditOutput(displayPath: string, replaceAll: boolean, count = 1): string {
  if (count > 1) return `The file ${displayPath} has been updated with ${String(count)} replacements.`
  return replaceAll
    ? `The file ${displayPath} has been updated. All occurrences were successfully replaced.`
    : `The file ${displayPath} has been updated successfully.`
}

/**
 * Register the `edit` tool and its scope-aware system-prompt guidance.
 * @param ctx - the plugin context; registrations are effects scoped to it, and execution uses its `fs` service.
 * @param sandbox - the shared sandbox-escalation API (advertisement, mode stamping, denial mapping).
 */
export function applyEditTool(ctx: Context, sandbox: FsSandboxController): void {
  ctx.systemPrompt.section({
    name: 'tool:edit',
    order: ctx.systemPrompt.getSectionOrder('TOOL_EDIT'),
    text: ({ scope }) => ctx.tools.get('edit', scope) === undefined
      ? ''
      : 'Use the edit tool for targeted changes to existing UTF-8 text files. It replaces literal old_string with new_string; by default old_string must appear exactly once. If old_string appears multiple times, provide a more specific old_string or set replace_all to true. For several changes to one file, pass them together as edits in one call: they apply in order, each against the result of the previous ones, and none applies unless all match. The text you replace must match the current file exactly, so take it from the file; a file that changed since you last read it is refused until you read it again.',
  })

  ctx.tools.register(defineTool({
    name: 'edit',
    description: 'Edit an existing UTF-8 text file by replacing literal text.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to edit, resolved by the filesystem backend.' },
      old_string: { type: 'string', description: 'Literal text to replace. Must match exactly. Required unless edits is given.' },
      new_string: { type: 'string', description: 'Literal replacement text. Use an empty string to delete the match. Required unless edits is given.' },
      replace_all: { type: 'boolean', description: 'Replace all matches. Defaults to false; when false, old_string must appear exactly once.' },
      edits: {
        type: 'array',
        description: 'Several replacements for this file in one call, applied in order; none applies unless all match. Use instead of old_string/new_string.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            old_string: { type: 'string', required: true, description: 'Literal text to replace. Must match exactly.' },
            new_string: { type: 'string', required: true, description: 'Literal replacement text.' },
            replace_all: { type: 'boolean', description: 'Replace all matches of this old_string.' },
          },
        },
      },
      ...sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {},
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          before: { type: 'string', required: true },
          after: { type: 'string', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: formatEditOutput(value.path, args.replace_all ?? false, args.edits?.length ?? 1),
      }],
      presentationMeta: (args, value) => ({
        diffs: computeHunkDiffs(args.file_path, value.before, value.after)
          .map(({ path, oldText, newText }) => ({ path, oldText, newText })),
      }),
    },
    async execute(args: EditToolArgs, exec) {
      const input = parseEditArgs(args)
      // Resolve the per-call sandbox policy (approved mode > session override
      // > backend default, plus the session cwd root) BEFORE anything executes.
      const sandboxPolicy = await sandbox.resolvePolicy('edit', args, exec)
      const target = await ctx.fs.resolve(input.filePath, sessionResolveOptions(ctx, exec, input.filePath, sandboxPolicy?.workspaceRoot))
      // Single-slot decision: the policy plugin returns { version: vObserved }, and
      // an unread target is observed first; the bare default is undefined
      // (unconditional edit) and never stats. The intent sits inside the try so a
      // policy refusal and the provider's guarded-mutation failure both get the
      // model-facing remedy below.
      let outcome
      try {
        const intent = await editIntent(ctx, target, exec)
        outcome = await ctx.fs.editText(
          target,
          input.edits,
          intent,
          exec.signal,
          sandboxPolicy,
        )
      } catch (error: unknown) {
        // A sandbox denial becomes the shared [sandbox: …] marker (the model
        // recognizes it from bash); guarded mutation failures receive their
        // stable model-facing diagnostic; anything else passes through.
        throw remediateFsError(sandbox.mapError(error, sandboxPolicy), target.displayPath)
      }
      ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)
      return {
        path: target.displayPath,
        before: outcome.before,
        after: outcome.after,
      }
    },
    // Pure display: a diff card of the literal replacement (old_string → new_string), derived
    // from the call args. `oldText: old_string || null` matches claude-agent-acp's Edit arm;
    // new_string is a required arg here, so it maps straight to newText.
    presentCall(args): DiffCallView {
      return {
        card: 'diff',
        title: `Edit ${args.file_path}`,
        diffs: args.edits === undefined
          ? [{ path: args.file_path, oldText: args.old_string || null, newText: args.new_string ?? '' }]
          : args.edits.map(edit => ({ path: args.file_path, oldText: edit.old_string || null, newText: edit.new_string })),
        locations: [{ path: args.file_path }],
      }
    },
    // Applied metadata replaces the call-time snippet; errors or malformed replay metadata use
    // the generic result rendering.
    presentResult(args, result: ToolResult): DiffResultView | undefined {
      if (result.isError) return undefined
      const diffs = diffsFromMeta(result.meta)
      if (diffs === undefined) return undefined
      return { card: 'diff', title: `Edit ${args.file_path}`, diffs }
    },
  }))
}
