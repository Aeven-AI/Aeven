import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { withTransientProbeWindow } from './transient-probe-window.ts'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const tsxCli = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url))

/** One private project per case, so no case compiles another case's output. */
const projects: string[] = []

async function tinyProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'avn-run-tsc-'))
  projects.push(root)
  await writeFile(join(root, 'index.ts'), 'export const answer = 42\n')
  await writeFile(join(root, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: { strict: true, noEmit: true, target: 'es2022', module: 'esnext', moduleResolution: 'bundler' },
    include: ['index.ts'],
  }, null, 2)}\n`)
  return join(root, 'tsconfig.json')
}

function runTsc(project: string | undefined): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [
    tsxCli,
    'scripts/run-tsc.ts',
    ...project === undefined ? [] : [project],
  ], { cwd: repositoryRoot, encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

afterEach(async () => {
  await Promise.all(projects.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

// Every case spawns tsx and then a whole `tsc` process, so each one takes the
// lane's budget: the default five seconds is smaller than a compiler start on a
// loaded runner, and the window the runner waits for is not a reason to fail.
describe('run-tsc', () => {
  it('compiles the requested project', async () => {
    const project = await tinyProject()
    const { status, output } = runTsc(project)

    expect(status, output).toBe(0)
  }, 90_000)

  it('fails loud without a project', () => {
    const { status, output } = runTsc(undefined)

    expect(status).not.toBe(0)
    expect(output).toContain('run-tsc: pass one project')
  }, 90_000)

  it('starts the compiler only after an open probe window closes', async () => {
    const project = await tinyProject()
    const holdMs = 600
    const started = Date.now()
    const holder = withTransientProbeWindow(async () => {
      await new Promise(resolve => setTimeout(resolve, holdMs))
    })

    const { status, output } = runTsc(project)

    expect(status, output).toBe(0)
    // The compiler owns the window too, so its run cannot start before the
    // holder releases it: a shorter run would mean the two overlapped.
    expect(Date.now() - started).toBeGreaterThanOrEqual(holdMs)
    await holder
  }, 90_000)
})
