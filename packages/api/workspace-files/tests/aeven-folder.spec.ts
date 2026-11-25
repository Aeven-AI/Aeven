/**
 * A conversation another device ran names its files by that device's absolute paths. This Host opens them from its
 * own copies through one resolver: a path inside any device's Aeven folder reads the account's Aeven folder here, a
 * path under a workspace root the conversation recorded on another device reads the same entry under the root here,
 * and a file this Host does not hold yet asks the workspace syncs to bring the workspace before the read gives up.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@aeven/fs-local'
import { SandboxPolicyService } from '@aeven/sandbox-policy'
import SessionProjectionRegistry from '@aeven/session-projection'
import TypertRegistry from '@aeven/typert-registry'
import { SessionId } from '@aeven/session'
import { afterEach, describe, expect, it } from 'vitest'
import { toLocal, WorkspaceFiles } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** The other device's Aeven folder and project root, as its paths name them. */
const DEVICE_FOLDER = '/Users/someone/Documents/Aeven'
const DEVICE_ROOT = '/Users/someone/Projects/site'

async function harness(options: { arriving?: (workspace: string) => void } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'avn-workspace-files-paths-'))
  dirs.push(base)
  const workspace = join(base, 'projects', 'site')
  const folder = join(base, 'accounts', 'owner-1')
  mkdirSync(workspace, { recursive: true })
  mkdirSync(join(folder, 'vase'), { recursive: true })
  writeFileSync(join(folder, 'vase', 'index.html'), '<canvas id="gl"></canvas>\n')
  writeFileSync(join(workspace, 'README.md'), '# site\n')
  const wanted: string[] = []
  const ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: workspace })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: workspace })
  await ctx.plugin(TypertRegistry)
  ctx.provide('sessionQuery')
  ctx.provide('aevenFolder')
  ctx.provide('workspaceRegistry')
  // An idle conversation the other device recorded: its log names that device's root, and this Host's directory for
  // it is its own copy.
  ctx.set('sessionQuery', {
    observeSession: async () => ({
      header: { id: 's1', cwd: workspace, owner: 'owner-1' },
      projections: { values: { workingDirectory: { cwd: DEVICE_ROOT, root: DEVICE_ROOT, roots: [DEVICE_ROOT] } } },
      [Symbol.dispose]() {},
    }),
  })
  ctx.set('aevenFolder', {
    folderOf: async () => folder,
    localPath: async (_owner: string, path: string) =>
      path.startsWith(`${DEVICE_FOLDER}/`) ? join(folder, path.slice(DEVICE_FOLDER.length + 1)) : undefined,
  })
  ctx.set('workspaceRegistry', {
    wantSessionFiles: async (sessionId: string) => {
      wanted.push(sessionId)
      options.arriving?.(workspace)
    },
  })
  // The schema fills every field with its default.
  await ctx.plugin(WorkspaceFiles, WorkspaceFiles.Config({} as Parameters<typeof WorkspaceFiles.Config>[0]))
  return { files: ctx.get('workspaceFiles') as WorkspaceFiles, wanted }
}

const signal = new AbortController().signal

describe('workspace file reads of paths another device recorded', () => {
  it('reads a file another device made in the Aeven folder from the account folder here', async () => {
    const { files } = await harness()
    const page = await files.read(SessionId('s1'), `${DEVICE_FOLDER}/vase/index.html`, signal)
    expect(page.text).toBe('<canvas id="gl"></canvas>')
  })

  it('reads a file under the workspace root another device recorded from the workspace here', async () => {
    const { files } = await harness()
    expect((await files.read(SessionId('s1'), `${DEVICE_ROOT}/README.md`, signal)).text).toBe('# site')
  })

  it('brings the workspace when the file has not arrived yet, then reads it', async () => {
    const { files, wanted } = await harness({ arriving: (workspace) => { writeFileSync(join(workspace, 'late.md'), 'arrived\n') } })
    expect((await files.read(SessionId('s1'), `${DEVICE_ROOT}/late.md`, signal)).text).toBe('arrived')
    expect(wanted).toEqual(['s1'])
  })

  it('reports a file that is on no copy here as missing after asking for the workspace', async () => {
    const { files, wanted } = await harness()
    await expect(files.read(SessionId('s1'), '/Users/someone/elsewhere/index.html', signal))
      .rejects.toMatchObject({ code: 'workspace-file/not-found' })
    expect(wanted).toEqual(['s1'])
  })

  it('asks for the workspace when the explorer opens, and lists a folder another device named from the copy here', async () => {
    const { files, wanted } = await harness()
    expect((await files.list(SessionId('s1'), '', signal)).entries.map(entry => entry.name)).toContain('README.md')
    expect(wanted).toEqual(['s1'])
    expect((await files.list(SessionId('s1'), DEVICE_ROOT, signal)).entries.map(entry => entry.name)).toContain('README.md')
  })
})

describe('toLocal', () => {
  const place = { root: '/srv/accounts/me/.aeven-projects/site', recorded: ['/Users/me/Projects/site', 'C:\\Users\\me\\site'] }

  it.each([
    ['/Users/me/Projects/site/src/main.js', '/srv/accounts/me/.aeven-projects/site/src/main.js'],
    ['/Users/me/Projects/site', '/srv/accounts/me/.aeven-projects/site'],
    ['C:\\Users\\me\\site\\notes\\a.md', '/srv/accounts/me/.aeven-projects/site/notes/a.md'],
    ['src/main.js', 'src/main.js'],
    ['/Users/me/Projects/site-other/a.js', '/Users/me/Projects/site-other/a.js'],
    ['/Users/me/Projects/site/../secret', '/Users/me/Projects/site/../secret'],
  ])('maps %j to %j', (path, local) => {
    expect(toLocal(place, path)).toBe(local)
  })
})
