/**
 * The source-control tools a model calls: read the checkout's branch, changed
 * paths, diffs, and history; stage and commit; move, create, and delete
 * branches; fetch and push; merge and report conflicts.
 *
 * Every tool resolves the calling session's directory and works from there, so
 * the same call finds the repository the session actually edits — including a
 * worktree the session was moved into — and never a path the repository does not
 * contain. Results are the seam's normalized report, rendered as text, so a
 * caller reads branch and change facts instead of parsing git's terminal output.
 * @module @aeven/tool-vcs
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@aeven/tools'
import type {} from '@aeven/vcs'
import { sessionDirectory } from '@aeven/working-directory'

/** Cordis plugin name. */
export const name = 'tool-vcs'

/** Services this plugin registers against and executes through. */
export const inject = ['tools', 'vcs']

const STATUS_DESCRIPTION =
  'Report the repository this session works in: checked-out branch, upstream and commits ahead or '
  + 'behind it, and every changed path with its staged and unstaged change. Start here before '
  + 'committing or switching branches.'

const DIFF_DESCRIPTION =
  'Show a unified diff of this session\'s repository. By default it compares the working tree with '
  + 'the index, so it shows what is not staged yet; use staged to compare the index with HEAD, or '
  + 'range for two revisions such as "main..HEAD". A long diff is cut and marked truncated.'

const LOG_DESCRIPTION =
  'List recent commits in this session\'s repository, newest first, with hash, author, date, and '
  + 'subject. Use it to see what landed before changing history or writing a commit message.'

const COMMIT_DESCRIPTION =
  'Record the staged changes as a commit. Pass paths to stage those paths first, or omit them to '
  + 'commit exactly what the index holds. The message goes to git verbatim, so keep it to one clear '
  + 'subject line and, when useful, a body after a blank line.'

const BRANCH_DESCRIPTION =
  'List, create, switch, or delete branches. Switching refuses while the checkout has uncommitted '
  + 'changes unless allow_dirty is true, because a switch would otherwise carry or block them '
  + 'unpredictably. Deleting refuses an unmerged branch unless force is true.'

const REMOTE_DESCRIPTION =
  'Fetch from a remote or push the current branch to it. Omit remote to use the branch\'s own remote '
  + 'and omit branch to push the branch that is checked out. The command\'s own output is returned.'

const MERGE_DESCRIPTION =
  'Merge a branch or revision into the checked-out branch. A merge that conflicts returns the paths '
  + 'left with conflicts instead of raising only an exit status; abort discards an in-progress merge.'

/**
 * The directory the calling session works in.
 * @param ctx - the tool plugin's context.
 * @param exec - the tool run, which carries the owning agent's session.
 * @returns the session's effective directory.
 * @throws {Error} when the call has no owning session or the session records no directory.
 */
function workingDirectory(ctx: Context, session: Parameters<typeof sessionDirectory>[1] | undefined): string {
  if (session === undefined) throw new Error('source-control tools require an owning agent session')
  const cwd = sessionDirectory(ctx, session)
  if (cwd === undefined) throw new Error('this session has no working directory')
  return cwd
}

/**
 * One changed path as a phrase a reader can scan.
 * @param change - the seam's per-path report.
 * @returns a description such as `modified, staged`.
 */
function describeChange(change: { staged?: string | null; worktree?: string | null }): string {
  const sides = [
    change.staged === undefined || change.staged === null ? null : `${change.staged} staged`,
    change.worktree === undefined || change.worktree === null ? null : `${change.worktree} unstaged`,
  ].filter(side => side !== null)
  return sides.length === 0 ? 'unchanged' : sides.join(', ')
}

/**
 * Register the source-control tools.
 * @param ctx - tool registry plus the version-control capability.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'git_status',
    description: STATUS_DESCRIPTION,
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repository: { type: 'string', required: true },
          branch: { type: 'string' },
          detached: { type: 'boolean', required: true },
          upstream: { type: 'string' },
          ahead: { type: 'number', required: true },
          behind: { type: 'number', required: true },
          truncated: { type: 'boolean', required: true },
          changes: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                staged: { type: 'string' },
                worktree: { type: 'string' },
              },
            },
          },
        },
      },
      render(_args, value) {
        const branch = value.detached ? 'detached HEAD' : value.branch
        const tracking = value.upstream === undefined
          ? ''
          : ` tracking ${value.upstream} (${String(value.ahead)} ahead, ${String(value.behind)} behind)`
        const lines = [`${value.repository} on ${branch}${tracking}`]
        if (value.changes.length === 0) lines.push('working tree clean')
        for (const change of value.changes) {
          lines.push(`- ${change.path}: ${describeChange(change)}`)
        }
        if (value.truncated) lines.push('more changed paths exist than are listed')
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(_args, exec) {
      const cwd = workingDirectory(ctx, exec.agent?.session)
      const status = await ctx.vcs.status(cwd, exec.signal)
      return {
        repository: status.repositoryRoot,
        ...status.branch === null ? {} : { branch: status.branch },
        detached: status.branch === null,
        ...status.upstream === null ? {} : { upstream: status.upstream },
        ahead: status.ahead,
        behind: status.behind,
        truncated: status.truncated,
        changes: status.changes.map(change => ({
          path: change.path,
          ...change.staged === null ? {} : { staged: change.staged },
          ...change.worktree === null ? {} : { worktree: change.worktree },
        })),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'git_diff',
    description: DIFF_DESCRIPTION,
    parameters: {
      path: { type: 'string', description: 'Repository-relative path to diff; omit for the whole checkout.' },
      staged: { type: 'boolean', description: 'Compare the index with HEAD instead of the working tree with the index.' },
      range: { type: 'string', description: 'Two revisions to compare, such as "main..HEAD". Takes precedence over staged.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          diff: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render(_args, value) {
        if (value.diff === '') return [{ type: 'text', text: 'no differences' }]
        return [{
          type: 'text',
          text: value.truncated ? `${value.diff}\n[diff truncated at the provider bound]` : value.diff,
        }]
      },
    },
    async execute(args, exec) {
      const cwd = workingDirectory(ctx, exec.agent?.session)
      const result = await ctx.vcs.diff(cwd, {
        ...args.path === undefined || args.path.trim() === '' ? {} : { path: args.path },
        ...args.staged === undefined ? {} : { staged: args.staged },
        ...args.range === undefined || args.range.trim() === '' ? {} : { range: args.range },
      }, exec.signal)
      return { diff: result.text, truncated: result.truncated }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'git_log',
    description: LOG_DESCRIPTION,
    parameters: {
      limit: { type: 'number', description: 'How many commits to report. Omit for the configured default.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          commits: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                hash: { type: 'string', required: true },
                short_hash: { type: 'string', required: true },
                author: { type: 'string', required: true },
                date: { type: 'string', required: true },
                subject: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render(_args, value) {
        if (value.commits.length === 0) return [{ type: 'text', text: 'no commits yet' }]
        return [{
          type: 'text',
          text: value.commits
            .map(commit => `${commit.short_hash} ${commit.date} ${commit.author}: ${commit.subject}`)
            .join('\n'),
        }]
      },
    },
    async execute(args, exec) {
      const cwd = workingDirectory(ctx, exec.agent?.session)
      const log = await ctx.vcs.log(cwd, args.limit === undefined ? {} : { limit: args.limit }, exec.signal)
      return {
        commits: log.commits.map(commit => ({
          hash: commit.hash,
          short_hash: commit.shortHash,
          author: commit.author,
          date: commit.date,
          subject: commit.subject,
        })),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'git_commit',
    description: COMMIT_DESCRIPTION,
    parameters: {
      message: { type: 'string', required: true, description: 'Commit message, passed to git verbatim.' },
      paths: {
        type: 'array',
        description: 'Repository-relative paths to stage before committing; omit to commit the index as it stands.',
        items: { type: 'string' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hash: { type: 'string', required: true },
          short_hash: { type: 'string', required: true },
          subject: { type: 'string', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: `committed ${value.short_hash}: ${value.subject}` }]
      },
    },
    async execute(args, exec) {
      const cwd = workingDirectory(ctx, exec.agent?.session)
      const { commit } = await ctx.vcs.commit(cwd, {
        message: args.message,
        ...args.paths === undefined || args.paths.length === 0 ? {} : { paths: args.paths },
      }, exec.signal)
      return { hash: commit.hash, short_hash: commit.shortHash, subject: commit.subject }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'git_branch',
    description: BRANCH_DESCRIPTION,
    parameters: {
      operation: {
        type: 'string',
        required: true,
        enum: ['list', 'switch', 'create', 'delete'],
        description: 'What to do: list every local branch, switch to one, create one, or delete one.',
      },
      name: { type: 'string', description: 'Branch name; required for switch, create, and delete.' },
      from: { type: 'string', description: 'Revision a created branch starts from. Defaults to HEAD.' },
      allow_dirty: { type: 'boolean', description: 'Switch even though the checkout has uncommitted changes.' },
      force: { type: 'boolean', description: 'Delete a branch that is not merged.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          branches: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                current: { type: 'boolean', required: true },
              },
            },
          },
          branch: { type: 'string' },
          created: { type: 'boolean' },
          deleted: { type: 'string' },
        },
      },
      render(args, value) {
        if (value.branches !== undefined) {
          return [{
            type: 'text',
            text: value.branches.map(branch => `${branch.current ? '*' : ' '} ${branch.name}`).join('\n'),
          }]
        }
        if (value.deleted !== undefined) return [{ type: 'text', text: `deleted branch ${value.deleted}` }]
        return [{
          type: 'text',
          text: `${value.created === true ? 'created and switched to' : 'switched to'} ${value.branch ?? args.name ?? ''}`,
        }]
      },
    },
    async execute(args, exec) {
      const cwd = workingDirectory(ctx, exec.agent?.session)
      const branch = args.name?.trim() ?? ''
      switch (args.operation) {
        case 'list': {
          const branches = await ctx.vcs.listBranches(cwd, exec.signal)
          return { branches: branches.map(entry => ({ name: entry.name, current: entry.current })) }
        }
        case 'switch':
        case 'create': {
          const result = await ctx.vcs.switchBranch(cwd, {
            name: branch,
            create: args.operation === 'create',
            ...args.from === undefined || args.from.trim() === '' ? {} : { from: args.from },
            ...args.allow_dirty === undefined ? {} : { allowDirty: args.allow_dirty },
          }, exec.signal)
          return { branch: result.branch, created: result.created }
        }
        case 'delete': {
          await ctx.vcs.deleteBranch(cwd, {
            name: branch,
            ...args.force === undefined ? {} : { force: args.force },
          }, exec.signal)
          return { deleted: branch }
        }
        default:
          throw new Error(`git_branch received an unsupported operation: ${String(args.operation)}`)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'git_remote',
    description: REMOTE_DESCRIPTION,
    parameters: {
      operation: {
        type: 'string',
        required: true,
        enum: ['fetch', 'push'],
        description: 'Fetch remote updates, or push the current branch.',
      },
      remote: { type: 'string', description: 'Remote name; omit to use the branch\'s own remote.' },
      branch: { type: 'string', description: 'Branch to push; omit to push the checked-out branch.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          output: { type: 'string', required: true },
        },
      },
      render(args, value) {
        return [{
          type: 'text',
          text: value.output === '' ? `${args.operation} completed` : value.output,
        }]
      },
    },
    async execute(args, exec) {
      const cwd = workingDirectory(ctx, exec.agent?.session)
      const result = await ctx.vcs.remote(cwd, {
        operation: args.operation,
        ...args.remote === undefined || args.remote.trim() === '' ? {} : { remote: args.remote },
        ...args.branch === undefined || args.branch.trim() === '' ? {} : { branch: args.branch },
      }, exec.signal)
      return { output: result.output }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'git_merge',
    description: MERGE_DESCRIPTION,
    parameters: {
      ref: { type: 'string', description: 'Branch or revision to merge into the checked-out branch.' },
      abort: { type: 'boolean', description: 'Abort an in-progress merge instead of starting one.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          outcome: { type: 'string', required: true, enum: ['merged', 'conflicted', 'up-to-date', 'aborted'] },
          conflicts: { type: 'array', required: true, items: { type: 'string' } },
          output: { type: 'string', required: true },
        },
      },
      render(_args, value) {
        const headline =
          value.outcome === 'merged'
            ? 'merged'
            : value.outcome === 'up-to-date'
              ? 'already up to date'
              : value.outcome === 'aborted'
                ? 'merge aborted'
                : `merge stopped with ${String(value.conflicts.length)} conflicted path${value.conflicts.length === 1 ? '' : 's'}`
        const lines = [headline, ...value.conflicts.map(path => `- ${path}`)]
        if (value.output !== '') lines.push(value.output)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const cwd = workingDirectory(ctx, exec.agent?.session)
      if (args.abort !== true && (args.ref === undefined || args.ref.trim() === '')) {
        throw new Error('git_merge needs a ref, or abort to discard an in-progress merge')
      }
      const result = await ctx.vcs.merge(cwd, {
        ref: args.ref ?? '',
        ...args.abort === undefined ? {} : { abort: args.abort },
      }, exec.signal)
      return { outcome: result.outcome, conflicts: [...result.conflicts], output: result.output }
    },
  }))
}
