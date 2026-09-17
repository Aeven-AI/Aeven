import type { Stats } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CREDENTIAL_FILE_MAX_BYTES, readCredentialFile } from '../src/credential-file.ts'

const posix = process.platform !== 'win32'
/** An unreadable directory is unreadable only for a non-root uid. */
const canHideFromOwner = posix && process.getuid?.() !== 0
const homes: string[] = []

/**
 * Simulates the two filesystem states a real temp directory cannot produce on
 * demand: a platform without `O_NOFOLLOW`, and a file whose handle disagrees
 * with the path between the lstat, the open, and the read.
 */
const fsState = vi.hoisted(() => ({
  dropNoFollow: false,
  handle: undefined as
    | undefined
    | { stats: unknown[]; readFile?: () => Promise<Buffer>; close?: () => Promise<void> },
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const constants = { ...actual.constants }
  Object.defineProperty(constants, 'O_NOFOLLOW', {
    configurable: true,
    get: () => (fsState.dropNoFollow ? undefined : actual.constants.O_NOFOLLOW),
  })
  return { ...actual, constants }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    open: (async (...args: Parameters<typeof actual.open>) => {
      const fixture = fsState.handle
      if (fixture === undefined) return actual.open(...args)
      let reads = 0
      return {
        stat: async () => {
          const stats = fixture.stats[Math.min(reads, fixture.stats.length - 1)]
          reads += 1
          return stats
        },
        readFile: async () => {
          if (fixture.readFile === undefined) throw new Error('fixture handle has no readFile')
          return fixture.readFile()
        },
        close: async () => {
          await fixture.close?.()
        },
      }
    }) as typeof actual.open,
  }
})

afterEach(async () => {
  vi.restoreAllMocks()
  fsState.handle = undefined
  fsState.dropNoFollow = false
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'avn-credential-file-'))
  homes.push(home)
  return home
}

async function writeOwnerOnly(path: string, body: string | NodeJS.ArrayBufferView): Promise<void> {
  await writeFile(path, body, { mode: 0o600 })
}

/** The safe-stat shape the hardened reader depends on, derived from a real file. */
function openedStats(source: Stats, overrides: Partial<Pick<Stats, 'dev' | 'ino' | 'mode' | 'size' | 'uid'>> = {}) {
  return {
    dev: source.dev,
    ino: source.ino,
    mode: source.mode,
    size: source.size,
    uid: source.uid,
    isFile: () => true,
    isSymbolicLink: () => false,
    ...overrides,
  } as unknown as Stats
}

/** Run `fn` with one process global replaced, always restoring it. */
async function withProcessProperty<T>(name: 'platform' | 'getuid', value: unknown, fn: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, name)
  Object.defineProperty(process, name, { value, configurable: true, writable: true })
  try {
    return await fn()
  } finally {
    Object.defineProperty(process, name, original!)
  }
}

describe('hardened credential file reads', () => {
  it('reads an owner-only regular file and never writes it', async () => {
    const path = join(await tempHome(), 'auth.json')
    await writeOwnerOnly(path, '{"token":"secret-value"}\n')
    const before = await lstat(path)
    expect(await readCredentialFile(path)).toContain('secret-value')
    expect((await lstat(path)).mtimeMs).toBe(before.mtimeMs)
  })

  it.skipIf(!posix)('rejects a symlink even when the target is a valid owner-only file', async () => {
    const home = await tempHome()
    const real = join(home, 'real.json')
    await writeOwnerOnly(real, '{"token":"secret-value"}\n')
    const link = join(home, 'link.json')
    await symlink(real, link)
    await expect(readCredentialFile(link)).rejects.toMatchObject({ name: 'CredentialFileError', code: 'unsafe_file' })
    expect(await readFile(real, 'utf8')).toContain('secret-value')
  })

  it.skipIf(!posix)('rejects group-or-other readable files', async () => {
    const path = join(await tempHome(), 'auth.json')
    await writeOwnerOnly(path, '{}')
    await chmod(path, 0o644)
    await expect(readCredentialFile(path)).rejects.toMatchObject({ code: 'unsafe_file' })
  })

  it('rejects a directory and a missing path without leaking contents', async () => {
    const home = await tempHome()
    const dir = join(home, 'not-a-file')
    await mkdir(dir)
    await expect(readCredentialFile(dir)).rejects.toMatchObject({ code: 'unsafe_file' })
    await expect(readCredentialFile(join(home, 'missing.json'))).rejects.toMatchObject({ code: 'not_found' })
  })

  it('rejects a file over the 64KiB cap and accepts a file at the cap', async () => {
    const home = await tempHome()
    const oversized = join(home, 'big.json')
    await writeOwnerOnly(oversized, Buffer.alloc(CREDENTIAL_FILE_MAX_BYTES + 1, 0x78))
    await expect(readCredentialFile(oversized)).rejects.toMatchObject({ code: 'too_large' })

    const exact = join(home, 'exact.json')
    await writeOwnerOnly(exact, Buffer.alloc(CREDENTIAL_FILE_MAX_BYTES, 0x78))
    expect(Buffer.byteLength(await readCredentialFile(exact), 'utf8')).toBe(CREDENTIAL_FILE_MAX_BYTES)
  })

  it('refuses a document that grew past the cap while it was being read, even when close() fails', async () => {
    const path = join(await tempHome(), 'auth.json')
    await writeOwnerOnly(path, 'x'.repeat(16))
    const listed = await lstat(path)
    fsState.handle = {
      stats: [openedStats(listed)],
      readFile: async () => Buffer.alloc(CREDENTIAL_FILE_MAX_BYTES + 1, 0x78),
      close: async () => {
        throw new Error('close failed')
      },
    }
    await expect(readCredentialFile(path)).rejects.toMatchObject({
      name: 'CredentialFileError',
      code: 'too_large',
    })
  })

  it('refuses a document whose byte length changed while it was being read', async () => {
    const path = join(await tempHome(), 'auth.json')
    await writeOwnerOnly(path, 'x'.repeat(16))
    const listed = await lstat(path)
    fsState.handle = { stats: [openedStats(listed)], readFile: async () => Buffer.from('short') }
    await expect(readCredentialFile(path)).rejects.toMatchObject({
      name: 'CredentialFileError',
      code: 'unsafe_file',
      message: expect.stringContaining('changed while it was being read') as string,
    })
  })

  it('refuses a document whose identity changed between the lstat and the open', async () => {
    const path = join(await tempHome(), 'auth.json')
    await writeOwnerOnly(path, 'x'.repeat(16))
    const listed = await lstat(path)
    fsState.handle = { stats: [openedStats(listed, { ino: listed.ino + 1 })] }
    await expect(readCredentialFile(path)).rejects.toMatchObject({
      name: 'CredentialFileError',
      code: 'unsafe_file',
      message: expect.stringContaining('identity changed during open') as string,
    })
  })

  it('maps a handle that cannot be read to a safe refusal', async () => {
    const path = join(await tempHome(), 'auth.json')
    await writeOwnerOnly(path, '{}')
    const listed = await lstat(path)
    fsState.handle = {
      stats: [openedStats(listed)],
      readFile: async () => {
        throw Object.assign(new Error('EISDIR: illegal operation on a directory'), { code: 'EISDIR' })
      },
    }
    await expect(readCredentialFile(path)).rejects.toMatchObject({
      name: 'CredentialFileError',
      code: 'unsafe_file',
      message: expect.stringContaining('path is not a regular file') as string,
    })
  })

  it.skipIf(!posix)('maps a symlink loop above the leaf to a refusal', async () => {
    const home = await tempHome()
    const first = join(home, 'loop-a')
    const second = join(home, 'loop-b')
    await symlink(second, first)
    await symlink(first, second)
    await expect(readCredentialFile(join(first, 'auth.json'))).rejects.toMatchObject({
      name: 'CredentialFileError',
      code: 'unsafe_file',
      message: expect.stringContaining('symlink') as string,
    })
  })

  it('maps a path whose parent is a regular file to a refusal', async () => {
    const home = await tempHome()
    const plain = join(home, 'plain.json')
    await writeOwnerOnly(plain, '{}')
    await expect(readCredentialFile(join(plain, 'auth.json'))).rejects.toMatchObject({
      name: 'CredentialFileError',
      code: 'unsafe_file',
      message: expect.stringContaining('not a regular file') as string,
    })
  })

  it.skipIf(!canHideFromOwner)('maps an unreadable directory to a refusal', async () => {
    const home = await tempHome()
    const locked = join(home, 'locked')
    await mkdir(locked)
    await writeOwnerOnly(join(locked, 'auth.json'), '{}')
    await chmod(locked, 0o000)
    try {
      await expect(readCredentialFile(join(locked, 'auth.json'))).rejects.toMatchObject({
        name: 'CredentialFileError',
        code: 'unsafe_file',
        message: expect.stringContaining('not readable by the current user') as string,
      })
    } finally {
      await chmod(locked, 0o700)
    }
  })

  it('maps an unrecognised failure to a generic safe refusal', async () => {
    await expect(readCredentialFile('unsafe\u0000name')).rejects.toMatchObject({
      name: 'CredentialFileError',
      code: 'unsafe_file',
      message: expect.stringContaining('could not be opened safely') as string,
    })
  })

  it.skipIf(!posix)('refuses a file owned by another user', async () => {
    const path = join(await tempHome(), 'auth.json')
    await writeOwnerOnly(path, '{}')
    const uid = process.getuid!()
    await withProcessProperty('getuid', () => uid + 1, async () => {
      await expect(readCredentialFile(path)).rejects.toMatchObject({
        name: 'CredentialFileError',
        code: 'unsafe_file',
        message: expect.stringContaining('not owned by the current user') as string,
      })
    })
  })

  it.skipIf(!posix)('fails closed when the process cannot report its own uid', async () => {
    const path = join(await tempHome(), 'auth.json')
    await writeOwnerOnly(path, '{}')
    await withProcessProperty('getuid', undefined, async () => {
      await expect(readCredentialFile(path)).rejects.toMatchObject({
        name: 'CredentialFileError',
        code: 'unsafe_file',
        message: expect.stringContaining('process uid is required') as string,
      })
    })
  })

  it('skips the POSIX owner and mode checks on Windows', async () => {
    const path = join(await tempHome(), 'auth.json')
    await writeOwnerOnly(path, '{"token":"secret-value"}')
    await chmod(path, 0o644)
    await withProcessProperty('platform', 'win32', async () => {
      expect(await readCredentialFile(path)).toContain('secret-value')
    })
  })

  it.skipIf(!posix)('fails closed when the platform cannot open without following symlinks', async () => {
    const path = join(await tempHome(), 'auth.json')
    await writeOwnerOnly(path, '{}')
    fsState.dropNoFollow = true
    await expect(readCredentialFile(path)).rejects.toMatchObject({
      name: 'CredentialFileError',
      code: 'unsafe_file',
      message: expect.stringContaining('O_NOFOLLOW is required') as string,
    })
  })
})
