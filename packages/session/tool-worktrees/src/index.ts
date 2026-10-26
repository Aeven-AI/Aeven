/**
 * The `create_worktree` model tool: give the task its own branch-backed
 * checkout, and work in it from the next call on.
 *
 * Creating one runs `git worktree add` through `ctx.worktrees` and moves the
 * session into the checkout, so two agents on the same repository stop
 * contending for one working tree and one branch.
 *
 * @module @aeven/tool-worktrees
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@aeven/tools'
import type {} from '@aeven/worktrees'

/** Cordis plugin name. */
export const name = 'tool-worktrees'

/** Services this plugin registers against and executes through. */
export const inject = ['tools', 'worktrees']

const DESCRIPTION =
  'Create a git worktree on a new branch and move this session into it. Use it when a task needs its '
  + 'own checkout: work in parallel with another agent on the same repository, try a change without '
  + 'touching the main working tree, or leave a build in place while starting something else. '
  + 'The new checkout is created from HEAD, or from the revision you name, and every later file, shell, '
  + 'and search call resolves against it.'

/**
 * Register `create_worktree`.
 * @param ctx - tool registry plus the worktree capability.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'create_worktree',
    description: DESCRIPTION,
    parameters: {
      name: {
        type: 'string',
        description: 'Worktree name: letters, digits, dots, dashes, or underscores. The branch and the checkout directory both use it. Omit for a generated name.',
      },
      from: {
        type: 'string',
        description: 'Revision the new branch starts from: a branch, tag, or commit. Defaults to HEAD of the session\'s repository.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          branch: { type: 'string', required: true },
          baseCommit: { type: 'string', required: true },
          repositoryRoot: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Created worktree ${value.path} on branch ${value.branch} (from ${value.baseCommit.slice(0, 12)}). `
          + 'This session now works there; later calls resolve relative paths against it.',
      }],
    },
    async execute(args, exec) {
      const session = exec.agent?.session
      if (session === undefined) {
        throw new Error('create_worktree requires an owning agent session')
      }
      const created = await ctx.worktrees.create(session, {
        ...args.name === undefined || args.name.trim() === '' ? {} : { name: args.name },
        ...args.from === undefined || args.from.trim() === '' ? {} : { from: args.from },
      }, exec.signal)
      return created
    },
  }))
}
