import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialRef } from '@aeven/credentials'
import { LocalCredentialProvider } from '../src/index.ts'

const KEY = credentialRef('AVN_CRED_SESSION')
const OTHER = credentialRef('AVN_CRED_SESSION_OTHER')

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

    ctx.credentials.setSession?.(KEY, 'live-session')

    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'live-session', source: 'session' })
    // Unwritable: `unset` cannot remove something no write created.
    expect(await ctx.credentials.describe(KEY)).toEqual({ configured: true, source: 'session', writable: false })
    // A token that rotates every two hours must not outlive its session on disk.
    expect(await readFile(path, 'utf8')).toBe('version: 1\nrefs:\n  AVN_CRED_SESSION: stored\n')
  })

  it('keeps the inherited environment above the session, and the session above every read-only fallback', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const ctx = await boot(path, 'version: 1\nrefs:\n  AVN_CRED_SESSION_OTHER: stored-other\n')
    vi.stubEnv('AVN_CRED_SESSION', 'from-shell')

    ctx.credentials.setSession?.(KEY, 'live-session')
    ctx.credentials.setSession?.(OTHER, 'live-other')

    // An operator's explicit shell value is this run's intent.
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'from-shell', source: 'env' })
    expect(await ctx.credentials.describe(KEY)).toEqual({ configured: true, source: 'env', writable: false })
    // A live session outranks a stale entry an earlier design left in the document.
    expect(await ctx.credentials.resolve(OTHER)).toEqual({ value: 'live-other', source: 'session' })
    expect(await readFile(path, 'utf8')).toBe('version: 1\nrefs:\n  AVN_CRED_SESSION_OTHER: stored-other\n')
  })

  it('withdraws a session value when the publisher passes undefined or an empty string', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const ctx = await boot(path, 'version: 1\nrefs:\n  AVN_CRED_SESSION: stored\n')
    ctx.credentials.setSession?.(KEY, 'live-session')
    ctx.credentials.setSession?.(OTHER, 'live-other')

    ctx.credentials.setSession?.(KEY, undefined)
    ctx.credentials.setSession?.(OTHER, '')

    // Withdrawal falls back to what the machine holds, and an empty value is
    // absent rather than an empty credential.
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'stored', source: 'file' })
    expect(await ctx.credentials.describe(KEY)).toEqual({ configured: true, source: 'file', writable: true })
    expect(await ctx.credentials.resolve(OTHER)).toBeUndefined()
    expect(await ctx.credentials.describe(OTHER)).toEqual({ configured: false, writable: true })
  })

  it('drops a publication made after disposal instead of serving it forever', async () => {
    const dir = await tempDir()
    const ctx = new Context()
    const fiber = ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
    await fiber
    // Capture the handle first: disposal also removes the ctx.credentials service.
    const service = ctx.credentials
    await fiber.dispose()

    service.setSession?.(KEY, 'late-session')

    // Nothing is stored and nothing is inherited, so an unguarded publish would
    // be the only thing left to resolve.
    expect(await service.resolve(KEY)).toBeUndefined()
    expect(await service.describe(KEY)).toEqual({ configured: false, writable: true })
  })
})
