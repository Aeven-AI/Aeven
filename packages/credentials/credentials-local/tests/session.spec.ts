import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialRef } from '@aeven/credentials'
import { LocalCredentialProvider } from '../src/index.ts'

const KEY = credentialRef('AVN_CRED_SESSION')
const OTHER = credentialRef('AVN_CRED_SESSION_OTHER')
const USER = 'user-a'
const OTHER_USER = 'user-b'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.unstubAllEnvs()
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'avn-credentials-session-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** Boot one provider over a document the caller wrote, watching off. */
async function boot(path: string, text?: string): Promise<Context> {
  if (text !== undefined) await writeFile(path, text, { mode: 0o600 })
  const ctx = new Context()
  const fiber = ctx.plugin(LocalCredentialProvider, { path, watch: false })
  cleanups.push(async () => {
    await fiber.dispose()
  })
  await fiber
  return ctx
}

describe('session-published credentials', () => {
  it('serves a session value above the stored one, and never writes it to the document', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const ctx = await boot(path, 'version: 1\nrefs:\n  AVN_CRED_SESSION: stored\n')

    ctx.credentials.setSession?.(KEY, USER, 'live-session')

    expect(await ctx.credentials.resolve(KEY, USER)).toEqual({ value: 'live-session', source: 'session' })
    // Unwritable: `unset` cannot remove something no write created.
    expect(await ctx.credentials.describe(KEY, USER)).toEqual({ configured: true, source: 'session', writable: false })
    // A token that rotates every two hours must not outlive its session on disk.
    expect(await readFile(path, 'utf8')).toBe('version: 1\nrefs:\n  AVN_CRED_SESSION: stored\n')
  })

  it('keeps the inherited environment above the session, and the session above every read-only fallback', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const ctx = await boot(path, 'version: 1\nrefs:\n  AVN_CRED_SESSION_OTHER: stored-other\n')
    vi.stubEnv('AVN_CRED_SESSION', 'from-shell')

    ctx.credentials.setSession?.(KEY, USER, 'live-session')
    ctx.credentials.setSession?.(OTHER, USER, 'live-other')

    // An operator's explicit shell value is this run's intent.
    expect(await ctx.credentials.resolve(KEY, USER)).toEqual({ value: 'from-shell', source: 'env' })
    expect(await ctx.credentials.describe(KEY, USER)).toEqual({ configured: true, source: 'env', writable: false })
    // A live session outranks a stale entry an earlier design left in the document.
    expect(await ctx.credentials.resolve(OTHER, USER)).toEqual({ value: 'live-other', source: 'session' })
    expect(await readFile(path, 'utf8')).toBe('version: 1\nrefs:\n  AVN_CRED_SESSION_OTHER: stored-other\n')
  })

  it('withdraws a session value when the publisher passes undefined or an empty string', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const ctx = await boot(path, 'version: 1\nrefs:\n  AVN_CRED_SESSION: stored\n')
    ctx.credentials.setSession?.(KEY, USER, 'live-session')
    ctx.credentials.setSession?.(OTHER, USER, 'live-other')

    ctx.credentials.setSession?.(KEY, USER, undefined)
    ctx.credentials.setSession?.(OTHER, USER, '')

    // Withdrawal falls back to what the machine holds, and an empty value is
    // absent rather than an empty credential.
    expect(await ctx.credentials.resolve(KEY, USER)).toEqual({ value: 'stored', source: 'file' })
    expect(await ctx.credentials.describe(KEY, USER)).toEqual({ configured: true, source: 'file', writable: true })
    expect(await ctx.credentials.resolve(OTHER, USER)).toBeUndefined()
    expect(await ctx.credentials.describe(OTHER, USER)).toEqual({ configured: false, writable: true })
  })

  it('drops a publication made after disposal instead of serving it forever', async () => {
    const dir = await tempDir()
    const ctx = new Context()
    const fiber = ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
    await fiber
    // Capture the handle first: disposal also removes the ctx.credentials service.
    const service = ctx.credentials
    await fiber.dispose()

    service.setSession?.(KEY, USER, 'late-session')

    // Nothing is stored and nothing is inherited, so an unguarded publish would
    // be the only thing left to resolve.
    expect(await service.resolve(KEY, USER)).toBeUndefined()
    expect(await service.describe(KEY, USER)).toEqual({ configured: false, writable: true })
  })

  it('serves a session value only to the user it was published for', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const ctx = await boot(path, 'version: 1\nrefs:\n  AVN_CRED_SESSION: stored\n')

    ctx.credentials.setSession?.(KEY, USER, 'session-a')
    ctx.credentials.setSession?.(KEY, OTHER_USER, 'session-b')

    // Two clients signed in to different accounts on one Host each present their own session.
    expect(await ctx.credentials.resolve(KEY, USER)).toEqual({ value: 'session-a', source: 'session' })
    expect(await ctx.credentials.resolve(KEY, OTHER_USER)).toEqual({ value: 'session-b', source: 'session' })
    // A read that names no user never sees anyone's session.
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'stored', source: 'file' })
    expect(await ctx.credentials.describe(KEY)).toEqual({ configured: true, source: 'file', writable: true })

    ctx.credentials.setSession?.(KEY, USER, undefined)
    expect(await ctx.credentials.resolve(KEY, USER)).toEqual({ value: 'stored', source: 'file' })
    expect(await ctx.credentials.resolve(KEY, OTHER_USER)).toEqual({ value: 'session-b', source: 'session' })
  })
})
