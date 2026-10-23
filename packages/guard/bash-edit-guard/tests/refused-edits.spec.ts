/**
 * Refusal behavior of @aeven/bash-edit-guard: a shell command that would change an
 * existing source file in place is refused before the tool body runs, and the
 * refusal names the file it would have changed.
 */

import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
import { guardConfig, mountGuard, textOf } from './harness.ts'

/** The guarded package itself, which holds source files the repository always ships. */
const packageRoot = fileURLToPath(new URL('..', import.meta.url))

describe('in-place edits of an existing source file', () => {
  it('refuses an in-place sed edit and names the file relative to the call workdir', async () => {
    const guard = await mountGuard()
    const result = await guard.run("sed -i 's/one/two/' src/index.ts", packageRoot)

    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      'Error: bash refused: this command would change the existing file src/index.ts in place. '
      + 'Change existing files with the edit tool (or write to replace a whole file): it fails when the text to replace is absent and records the change. '
      + 'Keep bash for builds, git, installs, and running programs; creating new files and writing scratch output are not refused.',
    )
    expect(guard.executed).toEqual([])
  })

  it('refuses a scripting write call that names the source file', async () => {
    const guard = await mountGuard()
    const result = await guard.run("python3 -c \"open('src/index.ts', 'w').write('body')\"", packageRoot)

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('would change the existing file src/index.ts in place')
    expect(guard.executed).toEqual([])
  })

  it('refuses a redirect into the source file', async () => {
    const guard = await mountGuard()
    const result = await guard.run('printf body > src/index.ts', packageRoot)

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('would change the existing file src/index.ts in place')
  })

  it('refuses an append redirect into the source file', async () => {
    const guard = await mountGuard()
    const result = await guard.run('printf body >> src/index.ts', packageRoot)

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('would change the existing file src/index.ts in place')
  })

  it('refuses a tee into the source file', async () => {
    const guard = await mountGuard()
    const result = await guard.run('printf body | tee -a src/index.ts', packageRoot)

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('would change the existing file src/index.ts in place')
  })

  it('resolves a relative file against a cd target in the command', async () => {
    const guard = await mountGuard()
    const result = await guard.run("cd 'src' && sed -i 's/one/two/' index.ts", packageRoot)

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('would change the existing file src/index.ts in place')
  })

  it('resolves the file against the workdir argument', async () => {
    const guard = await mountGuard()
    const result = await guard.run("sed -i 's/one/two/' index.ts", join(packageRoot, 'src'))

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('would change the existing file index.ts in place')
  })

  it('resolves the file against the session cwd when the command carries no workdir', async () => {
    const guard = await mountGuard({ cwd: packageRoot })
    const result = await guard.run("sed -i 's/one/two/' src/index.ts")

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('would change the existing file src/index.ts in place')
  })

  it('names the file absolutely when the call workdir is the file itself', async () => {
    const target = join(packageRoot, 'src/index.ts')
    const guard = await mountGuard()
    const result = await guard.run(`sed -i 's/one/two/' ${target}`, target)

    expect(relative(target, target)).toBe('')
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain(`would change the existing file ${target} in place`)
  })

  it('names a file outside the workdir by its absolute path', async () => {
    const guard = await mountGuard()
    const target = join(packageRoot, 'README.md')
    const result = await guard.run(`sed -i 's/one/two/' ${target}`, join(packageRoot, 'src'))

    expect(relative(join(packageRoot, 'src'), target).startsWith('..')).toBe(true)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain(`would change the existing file ${target} in place`)
    expect(textOf(result)).not.toContain('..')
  })
})

describe('configured tool names and extensions', () => {
  it('guards the configured shell tool and names it in the refusal', async () => {
    const guard = await mountGuard({ config: guardConfig({ tools: ['sh'] }) })
    const result = await guard.dispatch({
      tool: 'sh',
      arguments: { command: "sed -i 's/one/two/' src/index.ts", workdir: packageRoot },
    })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('sh refused: this command would change the existing file src/index.ts in place')
    expect(textOf(result)).toContain('Keep sh for builds, git, installs, and running programs')
  })

  it('leaves a tool outside the configured names unguarded', async () => {
    const guard = await mountGuard({ config: guardConfig({ tools: ['sh'] }) })
    const result = await guard.run("sed -i 's/one/two/' src/index.ts", packageRoot)

    expect(result.isError).toBe(false)
    expect(guard.executed).toEqual(['bash'])
  })

  it('counts only the configured extensions as source files', async () => {
    const guard = await mountGuard({ config: guardConfig({ sourceExtensions: ['ts'] }) })
    const result = await guard.run("sed -i 's/one/two/' README.md", packageRoot)

    expect(result.isError).toBe(false)
    expect(guard.executed).toEqual(['bash'])
  })

  it('refuses a file whose configured extension matches without the leading dot', async () => {
    const guard = await mountGuard({ config: guardConfig({ sourceExtensions: ['.ts'] }) })
    const result = await guard.run("sed -i 's/one/two/' src/index.ts", packageRoot)

    expect(result.isError).toBe(true)
  })
})
