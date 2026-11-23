/**
 * Git inside the jail trusts every repository it can see: owners outside the jail's user namespace show as `nobody`,
 * so a repository workspace the Host created would otherwise fail Git's ownership check for every command.
 */
import { describe, expect, it } from 'vitest'
import { relayEnv } from '../src/egress.ts'
import { jailArgs, trustedGitEnv } from '../src/profile.ts'

/** The value of one `--setenv` pair in a jail argv. */
function setenv(args: readonly string[], name: string): string | undefined {
  for (let index = 0; index < args.length - 2; index++) {
    if (args[index] === '--setenv' && args[index + 1] === name) return args[index + 2]
  }
  return undefined
}

const PROFILE = {
  bwrap: '/usr/bin/bwrap', launcher: '/opt/landlock-run', readOnlyPaths: [], symlinks: {},
  env: { PATH: '/usr/bin:/bin' }, tmpSizeBytes: 1024, hostname: 'jail', seccomp: false,
}
const POLICY = { mode: 'workspace-write', workspaceRoot: '/accounts/a1/.aeven-projects/808f70b3-2' } as const

describe('trustedGitEnv', () => {
  it('adds safe.directory=* as the only Git entry without egress', () => {
    expect(trustedGitEnv({})).toEqual({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: '*' })
  })

  it('appends after the egress URL rewrites, keeping them', () => {
    const egress = relayEnv(3128, ['github.com', 'gitlab.com'])
    expect(trustedGitEnv(egress)).toEqual({ GIT_CONFIG_COUNT: '3', GIT_CONFIG_KEY_2: 'safe.directory', GIT_CONFIG_VALUE_2: '*' })
  })
})

describe('jailArgs', () => {
  it('sets safe.directory=* in every confined command, beside the egress rewrites', () => {
    const { args } = jailArgs({ ...PROFILE, egress: { relay: '/opt/relay', port: 3128, gitHosts: ['github.com'] } }, POLICY)

    expect(setenv(args, 'GIT_CONFIG_COUNT')).toBe('2')
    expect(setenv(args, 'GIT_CONFIG_KEY_0')).toBe('url.http://127.0.0.1:3128/git/github.com/.insteadOf')
    expect(setenv(args, 'GIT_CONFIG_KEY_1')).toBe('safe.directory')
    expect(setenv(args, 'GIT_CONFIG_VALUE_1')).toBe('*')
    expect(setenv(args, 'HOME')).toBe(POLICY.workspaceRoot)
  })

  it('sets it without an egress proxy too', () => {
    const { args } = jailArgs(PROFILE, POLICY)

    expect(setenv(args, 'GIT_CONFIG_COUNT')).toBe('1')
    expect(setenv(args, 'GIT_CONFIG_KEY_0')).toBe('safe.directory')
  })
})
