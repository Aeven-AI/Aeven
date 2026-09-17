import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AVN_HOME_DISPLAY,
  AVN_HOME_DIR_NAME,
  canonicalizeWatchPath,
  defaultAvnHome,
  avnHomeDisplay,
  avnHomePath,
  expandHomePath,
  resolveAvnHome,
} from '@aeven/home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('avn path helpers', () => {
  it('owns the shared default AVN home directory name', () => {
    expect(AVN_HOME_DIR_NAME).toBe('.aeven')
    expect(DEFAULT_AVN_HOME_DISPLAY).toBe('~/.aeven')
    expect(defaultAvnHome()).toBe(join(homedir(), '.aeven'))
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.aeven')).toBe(join(homedir(), '.aeven'))
    expect(expandHomePath('~\\.aeven')).toBe(join(homedir(), '.aeven'))
    expect(expandHomePath('/tmp/.aeven')).toBe('/tmp/.aeven')
    expect(expandHomePath('~other/.aeven')).toBe('~other/.aeven')
  })

  it('resolves explicit path before AVN_HOME and the default', () => {
    const envHome = join(homedir(), 'env-avn')

    expect(resolveAvnHome('/tmp/explicit-avn', { AVN_HOME: '~/env-avn' })).toBe(resolve('/tmp/explicit-avn'))
    expect(resolveAvnHome(undefined, { AVN_HOME: '~/env-avn' })).toBe(envHome)
    expect(resolveAvnHome(undefined, {})).toBe(defaultAvnHome())
  })

  it('treats an empty or whitespace-only AVN_HOME as unset', () => {
    expect(resolveAvnHome(undefined, { AVN_HOME: '' })).toBe(defaultAvnHome())
    expect(resolveAvnHome(undefined, { AVN_HOME: '   ' })).toBe(defaultAvnHome())
  })

  it('joins child segments onto the resolved AVN_HOME', () => {
    vi.stubEnv('AVN_HOME', '~/env-avn')
    expect(avnHomePath()).toBe(join(homedir(), 'env-avn'))
    expect(avnHomePath('storages', 'cache')).toBe(join(homedir(), 'env-avn', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(avnHomeDisplay(resolve(defaultAvnHome()))).toBe('~/.aeven')
    expect(avnHomeDisplay('/some/other/root')).toBe('$AVN_HOME')
  })

  it('canonicalizes a watcher ancestor while preserving a missing suffix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'avn-watch-path-'))
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    try {
      await mkdir(target)
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(canonicalizeWatchPath(join(alias, 'later', 'config.yml'))).resolves.toBe(
        join(await realpath(target), 'later', 'config.yml'),
      )
      const file = join(root, 'file')
      await writeFile(file, 'not a directory')
      await expect(canonicalizeWatchPath(join(file, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
