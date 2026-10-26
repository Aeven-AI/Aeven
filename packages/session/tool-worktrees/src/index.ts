/**
 * The `create_worktree` and `remove_worktree` model tools: give a task its own
 * branch-backed checkout and work in it from the next call on, then remove the
 * checkout once its branch is merged or abandoned.
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

const CREATE_DESCRIPTION =
  'Create a git worktree on a new branch and move this session into it. Use it when a task needs its '
  + 'own checkout: work in parallel with another agent on the same repository, try a change without '
  + 'touching the main working tree, or leave a build in place while starting something else. '
  + 'The new checkout is created from HEAD, or from the revision you name; uncommitted changes in the '
  + 'current checkout do not carry over. Every later file, shell, and search call resolves against it, '
  + 'and file writes are confined to it. Subagents already get their own worktree automatically.'

const REMOVE_DESCRIPTION =
  'Remove a git worktree created by create_worktree or for a subagent, once its branch is merged or no '
  + 'longer needed. Without a name, removes the worktree this session works in and moves the session back '
  + 'to the repository\'s main checkout. Fails while the worktree has uncommitted changes. With '
  + 'delete_branch, also deletes its branch, which git refuses while the branch is unmerged.'

/**
 * Register `create_worktree` and `remove_worktree`.
 * @param ctx - tool registry plus the worktree capability.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'create_worktree',
    description: CREATE_DESCRIPTION,
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
          setup: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Created worktree ${value.path} on branch ${value.branch} (from ${value.baseCommit.slice(0, 12)}). `
          + 'This session now works there; later calls resolve relative paths against it.'
          + (value.setup === undefined ? '' : `\nDependency setup: ${value.setup}`),
      }],
    },
    async execute(args, exec) {
      const session = exec.agent?.session
      if (session === undefined) {
        throw new Error('create_worktree requires an owning agent session')
      }
      const { setup, ...created } = await ctx.worktrees.create(session, {
        ...args.name === undefined || args.name.trim() === '' ? {} : { name: args.name },
        ...args.from === undefined || args.from.trim() === '' ? {} : { from: args.from },
      }, exec.signal)
      return { ...created, ...setup === null ? {} : { setup } }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'remove_worktree',
    description: REMOVE_DESCRIPTION,
    parameters: {
      name: {
        type: 'string',
        description: 'Name of the worktree to remove, as its directory and branch name it (without the branch prefix). Omit to remove the worktree this session works in.',
      },
      delete_branch: {
        type: 'boolean',
        description: 'Also delete the worktree\'s branch. Git refuses while the branch is not merged.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          branch: { type: 'string' },
          branchDeleted: { type: 'boolean', required: true },
          cwd: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Removed worktree ${value.path}`
          + (value.branch === undefined ? '.' : value.branchDeleted ? ` and deleted branch ${value.branch}.` : `; branch ${value.branch} is kept.`)
          + (value.cwd === undefined ? '' : ` This session works in ${value.cwd}.`),
      }],
    },
    async execute(args, exec) {
      const session = exec.agent?.session
      if (session === undefined) {
        throw new Error('remove_worktree requires an owning agent session')
      }
      const removed = await ctx.worktrees.remove(
        session,
        args.name === undefined || args.name.trim() === '' ? undefined : args.name,
        { deleteBranch: args.delete_branch === true },
        exec.signal,
      )
      return {
        path: removed.path,
        ...removed.branch === undefined ? {} : { branch: removed.branch },
        branchDeleted: removed.branchDeleted,
        ...removed.cwd === undefined ? {} : { cwd: removed.cwd },
      }
    },
  }))
}
