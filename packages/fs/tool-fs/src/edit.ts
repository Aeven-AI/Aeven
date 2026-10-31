/**
 * Model-facing literal edit, unique-match by default, of one replacement or an ordered list
 * applied all-or-nothing per file, for one file or several through `files`. Files apply in
 * order; a failure stops at that file, and its error names the files already changed. Each file
 * obtains an optional guard from the single intent slot, calls
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

/** One file's edit: the single-file arguments, also the form of each `files` entry. */
interface EditFileArgs {
  file_path: string
  old_string?: string
  new_string?: string
  replace_all?: boolean
  edits?: EditReplacementArgs[]
}

/**
 * The `edit` tool's validated arguments: one file's top-level fields or a
 * `files` list, plus the two escalation fields, advertised only under a
 * confining `ctx.fs` (absent from the schema otherwise, so the validator
 * rejects them before `execute`).
 */
interface EditToolArgs extends Partial<EditFileArgs> {
  files?: EditFileArgs[]
  sandbox_permissions?: string
  justification?: string
}

/** One applied file in the `edit` output. */
interface EditedFile {
  path: string
  before: string
  after: string
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
export function parseEditArgs(args: EditFileArgs): EditInput {
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
 * The files a call's arguments name, without validation: the `files` list, or
 * the top-level fields as one file. Presenters use it; `execute` validates
 * through {@link parseEditCall}.
 * @param args - the raw tool arguments.
 * @returns one entry per named file, in call order.
 */
function editFileArgs(args: EditToolArgs): EditFileArgs[] {
  if (args.files !== undefined) return args.files
  return args.file_path === undefined ? [] : [{ ...args, file_path: args.file_path }]
}

/**
 * Validate a whole call: exactly one of the top-level single-file form or a
 * non-empty `files` list, each file valid under {@link parseEditArgs}.
 * @param args - the schema-validated raw tool arguments.
 * @returns one validated input per file, in call order.
 */
export function parseEditCall(args: EditToolArgs): EditInput[] {
  if (args.files === undefined) {
    if (args.file_path === undefined) throw new Error('file_path is required unless files is given')
    return [parseEditArgs({ ...args, file_path: args.file_path })]
  }
  const single = args.file_path !== undefined || args.old_string !== undefined || args.new_string !== undefined
    || args.replace_all !== undefined || args.edits !== undefined
  if (single) throw new Error('pass either files or file_path with its replacements, not both')
  if (args.files.length === 0) throw new Error('files must contain at least one file')
  return args.files.map((file, index) => {
    try {
      return parseEditArgs(file)
    } catch (error: unknown) {
      throw new Error(`files[${String(index)}]: ${(error as Error).message}`, { cause: error })
    }
  })
}

/**
 * Pair each validated input with its applied output entry; `execute` returns
 * one entry per input, in call order.
 * @param args - the call's raw tool arguments.
 * @param files - the output's applied files.
 * @returns the pairs, in call order.
 */
function appliedFiles(args: EditToolArgs, files: readonly EditedFile[]): Array<{ input: EditInput; file: EditedFile }> {
  const inputs = parseEditCall(args)
  return files.flatMap((file, index) => {
    const input = inputs[index]
    return input === undefined ? [] : [{ input, file }]
  })
}

/**
 * Prefix a mid-call failure with the files already changed, keeping an
 * `FsError` code for machine routing.
 * @param error - the remediated failure of the file at `index`.
 * @param applied - the files changed before the failure.
 * @param skipped - how many files after the failing one were not attempted.
 * @returns the failure to throw.
 */
function partialEditFailure(error: unknown, applied: readonly EditedFile[], skipped: number): unknown {
  if (applied.length === 0 || !(error instanceof Error)) return error
  const message = `Already edited: ${applied.map(file => file.path).join(', ')}. Then: ${error.message}`
    + (skipped > 0 ? ` The remaining ${String(skipped)} file(s) were not edited.` : '')
  return error instanceof FsError ? new FsError(message, error.code, { cause: error }) : new Error(message, { cause: error })
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
 * The card title for an edit call.
 * @param files - the files the call names.
 * @returns `Edit <path>` for one file, `Edit <n> files` for several.
 */
function editTitle(files: readonly EditFileArgs[]): string {
  const [first] = files
  return first !== undefined && files.length === 1 ? `Edit ${first.file_path}` : `Edit ${String(files.length)} files`
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
      : 'Use the edit tool for targeted changes to existing UTF-8 text files. It replaces literal old_string with new_string; by default old_string must appear exactly once. If old_string appears multiple times, provide a more specific old_string or set replace_all to true. For several changes to one file, pass them together as edits in one call: they apply in order, each against the result of the previous ones, and none applies unless all match. To change several files whose edits are already decided, pass them together as files in one call, one entry per file in the same form as a single-file call: files apply in order, and a failure stops at that file and reports the files already changed. The text you replace must match the current file exactly, so take it from the file; a file that changed since you last read it is refused until you read it again.',
  })

  ctx.tools.register(defineTool({
    name: 'edit',
    description: 'Edit existing UTF-8 text files by replacing literal text. Several files whose edits are already decided go together in one call through files.',
    /* jscpd:ignore-start -- per-tool schema text stays literal; the nested files/edits properties mirror the top-level ones. */
    parameters: {
      file_path: { type: 'string', description: 'Path to edit, resolved by the filesystem backend. Required unless files is given.' },
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
      files: {
        type: 'array',
        description: 'Several files in one call, applied in order, each file at most once. Use instead of the top-level file_path and its replacements.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            file_path: { type: 'string', required: true, description: 'Path to edit, resolved by the filesystem backend.' },
            old_string: { type: 'string', description: 'Literal text to replace. Must match exactly. Required unless edits is given.' },
            new_string: { type: 'string', description: 'Literal replacement text. Required unless edits is given.' },
            replace_all: { type: 'boolean', description: 'Replace all matches. Defaults to false.' },
            edits: {
              type: 'array',
              description: 'Several replacements for this file, applied in order; none applies unless all match.',
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
          },
        },
      },
      ...sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {},
    },
    /* jscpd:ignore-end */
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          files: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                before: { type: 'string', required: true },
                after: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: appliedFiles(args, value.files)
          .map(({ input, file }) => {
            const replaceAll = input.edits.length === 1 && input.edits[0]?.replaceAll === true
            return formatEditOutput(file.path, replaceAll, input.edits.length)
          })
          .join('\n'),
      }],
      presentationMeta: (args, value) => ({
        diffs: appliedFiles(args, value.files).flatMap(({ input, file }) => computeHunkDiffs(input.filePath, file.before, file.after)
          .map(({ path, oldText, newText }) => ({ path, oldText, newText }))),
      }),
    },
    async execute(args: EditToolArgs, exec) {
      const inputs = parseEditCall(args)
      // Resolve the per-call sandbox policy (approved mode > session override
      // > backend default, plus the session cwd root) BEFORE anything executes.
      const sandboxPolicy = await sandbox.resolvePolicy('edit', args, exec)
      // Every path resolves before the first file changes, so a bad or repeated path edits nothing.
      const plans: Array<{ input: EditInput; target: FsTarget }> = []
      for (const input of inputs) {
        const target = await ctx.fs.resolve(input.filePath, sessionResolveOptions(ctx, exec, input.filePath, sandboxPolicy?.workspaceRoot))
        if (plans.some(plan => plan.target.targetKey === target.targetKey)) {
          throw new Error(`"${target.displayPath}" appears more than once in files; pass its replacements together as edits`)
        }
        plans.push({ input, target })
      }
      const files: EditedFile[] = []
      for (const [index, { input, target }] of plans.entries()) {
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
          const remediated = remediateFsError(sandbox.mapError(error, sandboxPolicy), target.displayPath)
          throw partialEditFailure(remediated, files, plans.length - index - 1)
        }
        ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)
        files.push({ path: target.displayPath, before: outcome.before, after: outcome.after })
      }
      return { files }
    },
    // Pure display: a diff card of the literal replacement (old_string → new_string), derived
    // from the call args. `oldText: old_string || null` matches claude-agent-acp's Edit arm;
    // new_string is a required arg here, so it maps straight to newText.
    presentCall(args): DiffCallView {
      const files = editFileArgs(args)
      return {
        card: 'diff',
        title: editTitle(files),
        diffs: files.flatMap(file => file.edits === undefined
          ? [{ path: file.file_path, oldText: file.old_string || null, newText: file.new_string ?? '' }]
          : file.edits.map(edit => ({ path: file.file_path, oldText: edit.old_string || null, newText: edit.new_string }))),
        locations: files.map(file => ({ path: file.file_path })),
      }
    },
    // Applied metadata replaces the call-time snippet; errors or malformed replay metadata use
    // the generic result rendering.
    presentResult(args, result: ToolResult): DiffResultView | undefined {
      if (result.isError) return undefined
      const diffs = diffsFromMeta(result.meta)
      if (diffs === undefined) return undefined
      return { card: 'diff', title: editTitle(editFileArgs(args)), diffs }
    },
  }))
}
