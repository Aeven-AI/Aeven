/**
 * Model-facing UTF-8 read of one file or several through `files`. Each file takes one provider
 * stat for type, routing, and observed version, streams when large or size-unknown, renders a
 * bounded window, then emits the observation. Files read concurrently; in a several-file call a
 * file that fails reports its error in place, and the call fails only when every file does.
 * @module @aeven/tool-fs/src/read
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@aeven/tools'
import type { GenericCallView, ReadResultView, ToolExecution, ToolResult } from '@aeven/tools'
import type {} from '@aeven/fs'
import { buildWindow, formatReadOutput, langFromPath, readMetaFromMeta } from './read-render.ts'
import type { FileTextLine } from './read-render.ts'
import { resolveRegularReadTarget } from './read-target.ts'

/** Default and maximum number of lines returned by one `read` call (the `readLimit` config). */
export const READ_LIMIT = 2000

/**
 * Default streaming threshold (the `readStreamMinSize` config): files at or
 * above this size stream; smaller files read whole into memory.
 */
export const STREAM_MIN_SIZE = 10 * 1024 * 1024

/** Resolved read-tool caps — plugin config after defaulting (see `Config` in index.ts). */
export interface ReadToolCaps {
  /** Default and maximum number of lines returned by one call. */
  limit: number
  /** Maximum characters returned for a single line. */
  maxLineLength: number
  /** Maximum bytes returned for selected file lines. */
  maxBytes: number
  /** Files at or above this size stream; smaller files read whole into memory. */
  streamMinSize: number
}

/** Validated `read` arguments after defaulting. */
interface ReadInput {
  filePath: string
  offset: number
  limit: number
}

/** One file's read: the single-file arguments, also the form of each `files` entry. */
interface ReadFileArgs {
  file_path: string
  offset?: number
  limit?: number
}

/** The `read` tool's arguments: one file's top-level fields or a `files` list. */
interface ReadToolArgs extends Partial<ReadFileArgs> {
  files?: ReadFileArgs[]
}

/** One file's window in the `read` output. */
interface ReadWindowOutcome {
  path: string
  offset: number
  lines: FileTextLine[]
  totalLines: number
}

/** One file of a several-file call that failed, reported in place. */
interface ReadFailure {
  path: string
  error: string
}

function parsePositiveInteger(value: number, name: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

/**
 * Validate value constraints the schema DSL can't express. `maxLimit` is the deployment's line cap.
 * @param args - the schema-validated raw tool arguments; `offset`/`limit` must be positive integers when given.
 * @param maxLimit - the configured line cap: both the default `limit` and the largest one accepted.
 * @returns the validated input with `offset` defaulted to 1 and `limit` to `maxLimit`.
 */
export function parseReadArgs(args: { file_path: string; offset?: number; limit?: number }, maxLimit: number): ReadInput {
  if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')
  const offset = args.offset === undefined ? 1 : parsePositiveInteger(args.offset, 'offset')
  const limit = args.limit === undefined ? maxLimit : parsePositiveInteger(args.limit, 'limit')
  if (limit > maxLimit) throw new Error(`limit must be less than or equal to ${maxLimit}`)
  return { filePath: args.file_path, offset, limit }
}

/**
 * Validate a whole call: exactly one of the top-level single-file form or a
 * non-empty `files` list, each file valid under {@link parseReadArgs}.
 * @param args - the schema-validated raw tool arguments.
 * @param maxLimit - the configured line cap.
 * @returns one validated input per file, in call order.
 */
export function parseReadCall(args: ReadToolArgs, maxLimit: number): ReadInput[] {
  if (args.files === undefined) {
    if (args.file_path === undefined) throw new Error('file_path is required unless files is given')
    return [parseReadArgs({ ...args, file_path: args.file_path }, maxLimit)]
  }
  if (args.file_path !== undefined || args.offset !== undefined || args.limit !== undefined) {
    throw new Error('pass either files or file_path with its window, not both')
  }
  if (args.files.length === 0) throw new Error('files must contain at least one file')
  return args.files.map((file, index) => {
    try {
      return parseReadArgs(file, maxLimit)
    } catch (error: unknown) {
      throw new Error(`files[${String(index)}]: ${(error as Error).message}`, { cause: error })
    }
  })
}

/**
 * The files a call's arguments name, without validation, for the pure presenters.
 * @param args - the raw tool arguments.
 * @returns one entry per named file, in call order.
 */
function readFileArgs(args: ReadToolArgs): ReadFileArgs[] {
  if (args.files !== undefined) return args.files
  return args.file_path === undefined ? [] : [{ ...args, file_path: args.file_path }]
}

/**
 * Read one file's window and record the observation.
 * @param ctx - the plugin context providing the filesystem.
 * @param exec - the current tool execution.
 * @param input - the validated file input.
 * @param caps - the deployment's read caps.
 * @returns the rendered window.
 */
async function readWindow(ctx: Context, exec: ToolExecution, input: ReadInput, caps: ReadToolCaps): Promise<ReadWindowOutcome> {
  // One stat: absence observation OR type check + size routing + present version.
  // A concurrent write can only make a later guarded mutation fail stale and require reread.
  const { target, info } = await resolveRegularReadTarget(ctx, exec, input.filePath)

  // Stream when the file is large OR size is unknown, so a size-less backend
  // never buffers an arbitrarily large file.
  const chunks = info.size === undefined || info.size >= caps.streamMinSize
    ? await ctx.fs.streamText(target, exec.signal)
    : [await ctx.fs.readText(target, exec.signal)]
  const window = await buildWindow(
    chunks,
    { offset: input.offset, limit: input.limit, maxLineLength: caps.maxLineLength, maxBytes: caps.maxBytes },
    target.displayPath,
  )
  // Record the present observation (a no-op when no policy plugin listens). The
  // read already succeeded; an fs/observed listener is contractually a
  // synchronous, side-effect-only recorder.
  ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
  return { path: target.displayPath, offset: input.offset, lines: window.lines, totalLines: window.totalLines }
}

/**
 * Render one file's window as the model-facing read envelope.
 * @param outcome - the file's window.
 * @param limit - the validated line limit the window was read with.
 * @returns the envelope text.
 */
function renderWindow(outcome: ReadWindowOutcome, limit: number): string {
  const endLine = outcome.lines.at(-1)?.number ?? Math.max(0, outcome.offset - 1)
  const truncatedByBytes = outcome.lines.length < limit && endLine < outcome.totalLines
  return formatReadOutput(outcome.path, {
    offset: outcome.offset,
    lines: outcome.lines,
    totalLines: outcome.totalLines,
    ...truncatedByBytes ? { truncatedByBytes: true } : {},
  })
}

/**
 * Register the `read` tool and its scope-aware system-prompt guidance.
 * @param ctx - the plugin context; registrations are effects scoped to it, and execution uses its `fs` service.
 * @param caps - the deployment's resolved read caps (plugin config after defaulting).
 */
export function applyReadTool(ctx: Context, caps: ReadToolCaps): void {
  ctx.systemPrompt.section({
    name: 'tool:read',
    order: ctx.systemPrompt.getSectionOrder('TOOL_READ'),
    text: ({ scope }) => ctx.tools.get('read', scope) === undefined
      ? ''
      : 'Use the read tool — not shell commands like cat — to inspect text files. Results include line numbers. Use offset and limit to continue reading large files. To read several files you already know you need, pass them together as files in one call instead of one call per file.',
  })

  ctx.tools.register(defineTool({
    name: 'read',
    description: 'Read UTF-8 text files and return line-numbered content. Several files you already know you need go together in one call through files.',
    parameters: {
      file_path: { type: 'string', description: 'Path to read, resolved by the filesystem backend. Required unless files is given.' },
      offset: { type: 'number', description: '1-based first line to return. Defaults to 1.' },
      limit: { type: 'number', description: `Maximum number of lines to return. Defaults to ${caps.limit}.` },
      files: {
        type: 'array',
        description: 'Several files in one call, read concurrently and returned in order. Use instead of the top-level file_path, offset, and limit.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            file_path: { type: 'string', required: true, description: 'Path to read, resolved by the filesystem backend.' },
            offset: { type: 'number', description: '1-based first line to return. Defaults to 1.' },
            limit: { type: 'number', description: `Maximum number of lines to return. Defaults to ${caps.limit}.` },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          files: {
            type: 'array',
            required: true,
            items: {
              oneOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    path: { type: 'string', required: true },
                    offset: { type: 'integer', required: true },
                    lines: {
                      type: 'array',
                      required: true,
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          number: { type: 'integer', required: true },
                          text: { type: 'string', required: true },
                        },
                      },
                    },
                    totalLines: { type: 'integer', required: true },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    path: { type: 'string', required: true },
                    error: { type: 'string', required: true },
                  },
                },
              ],
            },
          },
        },
      },
      render: (args, value) => {
        const inputs = parseReadCall(args, caps.limit)
        const outcomes = value.files
        return [{
          type: 'text',
          text: outcomes.map((outcome, index) => 'error' in outcome
            ? `<path>${outcome.path}</path>\n<error>${outcome.error}</error>`
            : renderWindow(outcome, inputs[index]?.limit ?? caps.limit)).join('\n\n'),
        }]
      },
      // Project a single-file window into persisted `meta` so a UI's read card
      // survives replay: the raw canonical output object is not on the wire, only
      // the model-facing text, from which the line/lang data cannot be recovered.
      // A several-file call has no read card and persists no window.
      presentationMeta: (_args, value) => {
        const [only] = value.files
        if (only === undefined || value.files.length !== 1 || 'error' in only) return {}
        const lang = langFromPath(only.path)
        return {
          path: only.path,
          offset: only.offset,
          lines: only.lines.map(({ number, text }) => ({ number, text })),
          totalLines: only.totalLines,
          ...lang === undefined ? {} : { lang },
        }
      },
    },
    // Observation races fail closed because guarded mutations re-check the version in-lock.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const inputs = parseReadCall(args, caps.limit)
      const [only] = inputs
      if (only !== undefined && inputs.length === 1) return { files: [await readWindow(ctx, exec, only, caps)] }
      const files = await Promise.all(inputs.map(async (input): Promise<ReadWindowOutcome | ReadFailure> => {
        try {
          return await readWindow(ctx, exec, input, caps)
        } catch (error: unknown) {
          if (exec.signal.aborted) throw error
          return { path: input.filePath, error: error instanceof Error ? error.message : String(error) }
        }
      }))
      const failures = files.filter((file): file is ReadFailure => 'error' in file)
      if (failures.length === files.length) throw new Error(failures.map(failure => failure.error).join('\n'))
      return { files }
    },
    // Result-time display: a `read` card carrying the structured line window a
    // capable UI renders as a line-numbered, syntax-highlighted view. The
    // structured data is narrowed from the persisted `meta` (replay-safe); the
    // envelope-stripped model-facing text rides along as `content` so a UI without
    // the read capability still shows the file text. A malformed or absent meta,
    // or a result whose text is not the read envelope, declines to `undefined`
    // (the generic fallback), never throwing on replay of obsolete logged output.
    presentResult(_args, result: ToolResult): ReadResultView | undefined {
      if (result.isError) return undefined
      const meta = readMetaFromMeta(result.meta)
      if (meta === undefined) return undefined
      const only = result.content.length === 1 ? result.content[0] : undefined
      const text = only?.type === 'text' ? only.text : undefined
      if (text === undefined) return undefined
      // Group 1 always captures (possibly empty) when the envelope matches.
      const body = /^<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\n([\s\S]*)\n<\/content>$/u.exec(text)?.[1]
      if (body === undefined) return undefined
      return {
        card: 'read',
        path: meta.path,
        offset: meta.offset,
        lines: meta.lines,
        totalLines: meta.totalLines,
        ...meta.lang === undefined ? {} : { lang: meta.lang },
        content: [{ type: 'text', text: body }],
      }
    },
    // Pure display: a generic card titled by the file with the read window appended (`Read
    // foo.txt (5 - 8)`), `read` kind (icon), and a follow-along location whose line is the
    // read's offset (defaulting to 1). The window reflects raw args, so an omitted limit keeps
    // the title bare instead of smuggling config into this pure presenter.
    presentCall(args): GenericCallView {
      const files = readFileArgs(args)
      const [first] = files
      if (first === undefined || files.length !== 1) {
        return {
          card: 'generic',
          title: `Read ${String(files.length)} files`,
          kind: 'read',
          locations: files.map(file => ({ path: file.file_path, line: file.offset ?? 1 })),
        }
      }
      const { offset, limit } = first
      const window = limit !== undefined && limit > 0
        ? ` (${offset ?? 1} - ${(offset ?? 1) + limit - 1})`
        : offset !== undefined ? ` (from line ${offset})` : ''
      return {
        card: 'generic',
        title: `Read ${first.file_path}${window}`,
        kind: 'read',
        locations: [{ path: first.file_path, line: offset ?? 1 }],
      }
    },
  }))
}
