import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const guard = fileURLToPath(new URL('verify-not-default-branch.sh', import.meta.url))
const fixtureRoots: string[] = []

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(cwd: string, args: string[]): void {
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

/** A repository whose checked-out branch is `branch`, with one commit so a detached HEAD is possible. */
function fixture(branch: string): string {
  const root = mkdtempSync(join(tmpdir(), 'avn-default-branch-'))
  fixtureRoots.push(root)
  git(root, ['init', '-q', '-b', branch])
  git(root, [
    '-c',
    'user.name=Guard Spec',
    '-c',
    'user.email=guard@example.test',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'root',
  ])
  return root
}

interface Run {
  status: number
  stderr: string
}

function run(cwd: string, args: string[], input = ''): Run {
  const result = spawnSync('bash', [guard, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
    input,
  })
  return { status: result.status ?? -1, stderr: result.stderr }
}

describe('verify-not-default-branch commit mode', () => {
  it('refuses to commit while main is checked out', () => {
    const run_ = run(fixture('main'), ['commit'])

    expect(run_.status).toBe(1)
    expect(run_.stderr).toContain('refusing to commit on main')
  })

  it('refuses to commit while master is checked out', () => {
    const run_ = run(fixture('master'), ['commit'])

    expect(run_.status).toBe(1)
    expect(run_.stderr).toContain('refusing to commit on master')
  })

  it('allows a commit on a named branch', () => {
    expect(run(fixture('fix/something'), ['commit']).status).toBe(0)
  })

  it('allows a commit on a detached HEAD', () => {
    const root = fixture('main')
    git(root, ['checkout', '-q', '--detach'])

    expect(run(root, ['commit']).status).toBe(0)
  })
})

describe('verify-not-default-branch push mode', () => {
  const refs = (remoteRef: string) => `refs/heads/local 1111111111111111111111111111111111111111 ${remoteRef} 2222222222222222222222222222222222222222\n`

  it('refuses a push to refs/heads/main', () => {
    const run_ = run(fixture('main'), ['push'], refs('refs/heads/main'))

    expect(run_.status).toBe(1)
    expect(run_.stderr).toContain('refusing to push to refs/heads/main')
  })

  it('refuses a push to refs/heads/master', () => {
    expect(run(fixture('main'), ['push'], refs('refs/heads/master')).status).toBe(1)
  })

  it('refuses when the default branch is one of several pushed refs', () => {
    const input = `${refs('refs/heads/feat/x')}${refs('refs/heads/main')}${refs('refs/heads/tags/v1')}`

    expect(run(fixture('main'), ['push'], input).status).toBe(1)
  })

  it('allows a push to another branch', () => {
    expect(run(fixture('main'), ['push'], refs('refs/heads/feat/x')).status).toBe(0)
  })

  it('allows an empty stdin', () => {
    expect(run(fixture('main'), ['push'], '').status).toBe(0)
  })
})

describe('verify-not-default-branch usage', () => {
  it('exits 2 without a mode', () => {
    const run_ = run(fixture('main'), [])

    expect(run_.status).toBe(2)
    expect(run_.stderr).toContain('usage')
  })

  it('exits 2 for an unknown mode', () => {
    expect(run(fixture('main'), ['bogus']).status).toBe(2)
  })
})
