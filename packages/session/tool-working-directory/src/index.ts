/**
 * The `working_directory` model tool: read where the session's tools run, or
 * move the session to another directory.
 *
 * A change is a logged `session/cwd`, so the model's next call resolves against
 * the new directory without the model tracking it itself, and a resumed or
 * forked session starts where the log left it.
 *
 * @module @aeven/tool-working-directory
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@aeven/tools'
import type {} from '@aeven/working-directory'

/** Cordis plugin name. */
export const name = 'tool-working-directory'

/** Services this plugin registers against and executes through. */
export const inject = ['tools', 'workingDirectory']

const DESCRIPTION =
  'Read or change this session\'s working directory. With no path, report the current directory. '
  + 'With a path, resolve it (absolute, or relative to the current directory), require an existing '
  + 'directory, and make it the directory every later file, shell, and search call resolves against. '
  + 'The change lasts for the rest of the session; there is no directory stack to pop.'

/**
 * Register `working_directory`.
 * @param ctx - tool registry plus the working-directory capability.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'working_directory',
    description: DESCRIPTION,
    parameters: {
      path: {
        type: 'string',
        description: 'Directory to enter: absolute, or relative to the current working directory. Omit to read the current directory.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cwd: { type: 'string', required: true },
          changed: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.changed
          ? `Working directory is now ${value.cwd}. Later calls resolve relative paths against it.`
          : `Working directory is ${value.cwd}.`,
      }],
    },
    async execute(args, exec) {
      const session = exec.agent?.session
      if (session === undefined) {
        throw new Error('working_directory requires an owning agent session')
      }
      const path = args.path
      if (path === undefined || path.trim() === '') {
        const cwd = ctx.workingDirectory.of(session)
        if (cwd === undefined) {
          throw new Error('working_directory: this session has no working directory; pass an absolute path')
        }
        return { cwd, changed: false }
      }
      const cwd = await ctx.workingDirectory.change(session, path)
      return { cwd, changed: true }
    },
  }))
}
