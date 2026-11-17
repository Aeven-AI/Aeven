/**
 * The sync Remote acts for the signed-in caller: it reports that account's sync on this Host, turns it on or off
 * for this device, and lists the account's devices, and refuses a caller nobody signed in as.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { User } from '@aeven/identity-user'
import { SyncKeyHolderMismatch, type Sync, type SyncStatus } from '@aeven/sync'
import type { DeviceId } from '@aeven/sync-vault'
import SyncController from '../src/index.ts'

const OWNER = 'owner-1'

function fakeSync() {
  let state: SyncStatus['state'] = 'online'
  return {
    status: vi.fn((): SyncStatus => ({ state, device: 'd1' as DeviceId, pending: 3, queued: 10 })),
    setEnabled: vi.fn((_owner: string, enabled: boolean) => { state = enabled ? 'connecting' : 'disabled' }),
    devices: vi.fn(() => Promise.resolve([{ id: 'd1' as DeviceId, name: 'laptop', current: true }])),
  }
}

async function boot(user: User | undefined) {
  const sync = fakeSync()
  const ctx = new Context()
  ctx.provide('typert', {} as never)
  ctx.provide('sync', sync as unknown as Sync)
  ctx.provide('identityUsers', { actingUser: () => user } as never)
  await ctx.plugin(SyncController, { siteUrl: 'https://aeven.test', passkeyMs: 600_000, passkeyPollMs: 1_000 })
  return { controller: ctx.syncController, sync, ctx }
}

describe('the sync Remote', () => {
  it('reports, switches, and lists the caller\'s sync', async () => {
    const { controller, sync } = await boot({ id: OWNER, email: 'sam@example.test' })
    expect(await controller.status()).toEqual({ state: 'online', pending: 3, queued: 10, sessionsPending: 0, sessionsTotal: 0 })
    expect(await controller.setEnabled(false)).toMatchObject({ state: 'disabled' })
    expect(sync.setEnabled).toHaveBeenCalledWith(OWNER, false)
    expect(await controller.setEnabled(true)).toMatchObject({ state: 'connecting' })
    expect(await controller.devices()).toEqual([{ id: 'd1', name: 'laptop', current: true }])
    expect(sync.devices).toHaveBeenCalledWith(OWNER)
  })

  it('includes discovered conversations that have not reached the upload queue', async () => {
    const { controller, ctx } = await boot({ id: OWNER })
    ctx.on('sync/progress', (owner, progress) => {
      expect(owner).toBe(OWNER)
      Object.assign(progress, { sessionsPending: 919, sessionsTotal: 948 })
    })
    expect(await controller.status()).toMatchObject({ sessionsPending: 919, sessionsTotal: 948 })
  })

  it('preserves download progress and transfer failures in the caller view', async () => {
    const { controller, sync } = await boot({ id: OWNER })
    sync.status.mockReturnValue({ state: 'online', pending: 0, queued: 0, catchingUp: true, error: 'download' })
    expect(await controller.status()).toMatchObject({ catchingUp: true, error: 'download' })
  })

  it('refuses a caller nobody signed in as', async () => {
    const { controller } = await boot(undefined)
    await expect(controller.status()).rejects.toThrow(/signed-in user/)
  })
})

/**
 * Seal a passkey page's result to the Host's one-use key, as the page's `sealToHost` does: version 1, the ephemeral
 * X25519 key, then AES-256-GCM under HKDF-SHA-256 of the shared secret, with the 33-byte header as associated data.
 */
async function sealToHost(secret: Uint8Array, recipient: Uint8Array): Promise<string> {
  const { subtle } = globalThis.crypto
  const ephemeral = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']) as CryptoKeyPair
  const ephemeralPublic = new Uint8Array(await subtle.exportKey('raw', ephemeral.publicKey))
  const shared = await subtle.deriveBits({ name: 'X25519', public: await subtle.importKey('raw', new Uint8Array(recipient), { name: 'X25519' }, false, []) }, ephemeral.privateKey, 256)
  const material = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  const key = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array([...ephemeralPublic, ...recipient]), info: new TextEncoder().encode('aeven-sync/wrap/device') },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
  )
  const header = new Uint8Array([1, ...ephemeralPublic])
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const body = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: header }, key, new Uint8Array(secret)))
  return Buffer.from([...header, ...iv, ...body]).toString('base64url')
}

/** A sync service whose account key passkeys hold, recording what the Remote asks of it. */
function protectedSync(holders: Array<{ id: string; kind: 'passkey' | 'recovery' }> = [{ id: 'cred-1', kind: 'passkey' }]) {
  const protection = { mode: 'passkey' as const, locked: false, downgraded: false, passkeys: holders.filter(h => h.kind === 'passkey').map(h => h.id), holders }
  return {
    status: vi.fn((): SyncStatus => ({ state: 'online', pending: 0, queued: 0, protection })),
    setEnabled: vi.fn(),
    devices: vi.fn(() => Promise.resolve([])),
    addPasskey: vi.fn(() => Promise.resolve()),
    removePasskey: vi.fn(() => Promise.resolve()),
    renamePasskey: vi.fn(() => Promise.resolve()),
    unlock: vi.fn(() => Promise.resolve()),
  }
}

async function bootWith(sync: ReturnType<typeof protectedSync>) {
  const ctx = new Context()
  ctx.provide('typert', {} as never)
  ctx.provide('sync', sync as unknown as Sync)
  ctx.provide('identityUsers', { actingUser: () => ({ id: OWNER, email: 'sam@example.test' }) } as never)
  await ctx.plugin(SyncController, { siteUrl: 'https://aeven.test', passkeyMs: 600_000, passkeyPollMs: 100 })
  return ctx.syncController
}

describe('passkey copies through the sync Remote', () => {
  it('creates a 28-character recovery key that replaces an earlier one and unlocks as typed back', async () => {
    const sync = protectedSync([{ id: 'cred-1', kind: 'passkey' }, { id: 'recovery-old', kind: 'recovery' }])
    const controller = await bootWith(sync)
    const { key } = await controller.createRecoveryKey()
    expect(key).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){6}$/)
    const [, added] = sync.addPasskey.mock.calls[0] as unknown as [string, { credentialId: string; prf: Uint8Array; kind: string }]
    expect(added).toMatchObject({ kind: 'recovery', credentialId: expect.stringMatching(/^recovery-[A-Za-z0-9_-]{22}$/) })
    expect(added.prf).toHaveLength(32)
    expect(sync.removePasskey).toHaveBeenCalledWith(OWNER, 'recovery-old')

    await controller.unlockWithRecoveryKey(key.toLowerCase().replaceAll('-', ' ').replaceAll('1', 'l').replaceAll('0', 'o'))
    expect(sync.unlock).toHaveBeenCalledWith(OWNER, { credentialId: added.credentialId, prf: added.prf, kind: 'recovery' })
    await expect(controller.unlockWithRecoveryKey('ABCD-EFGH')).rejects.toThrow(/28 characters/)
    await expect(controller.unlockWithRecoveryKey(`${key.slice(0, -1)}U`)).rejects.toThrow(/only digits and letters/)
  })

  it('asks a new passkey to describe itself and lists existing passkeys so none is replaced', async () => {
    const controller = await bootWith(protectedSync())
    const create = new URLSearchParams(new URL((await controller.startPasskey('add')).url).hash.slice(1))
    expect(create.get('mode')).toBe('create')
    expect(create.get('meta')).toBe('1')
    expect(create.get('ids')).toBe('cred-1')
    expect(create.get('name')).toBe('sam@example.test')
    const unlock = new URLSearchParams(new URL((await controller.startPasskey('unlock')).url).hash.slice(1))
    expect(unlock.get('mode')).toBe('unlock')
    expect(unlock.has('meta') || unlock.has('ids') || unlock.has('user')).toBe(false)
  })

  it('reports a provider that already holds a passkey and an unlock answered by the wrong passkey', async () => {
    const sync = protectedSync()
    const controller = await bootWith(sync)
    const claims: Array<Record<string, unknown>> = []
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      const next = claims.shift()
      return Promise.resolve(next === undefined ? new Response(null, { status: 202 }) : Response.json(next))
    })
    try {
      claims.push({ error: 'duplicate' })
      await controller.startPasskey('add')
      await vi.waitFor(async () => { expect((await controller.status()).passkey?.state).toBe('duplicate') })

      sync.unlock.mockRejectedValueOnce(new SyncKeyHolderMismatch('this passkey does not hold the account key'))
      const page = new URLSearchParams(new URL((await controller.startPasskey('unlock')).url).hash.slice(1))
      const prf = new Uint8Array(32).fill(7)
      claims.push({ sealed: await sealToHost(new Uint8Array([...prf, ...Buffer.from('other-passkey')]), new Uint8Array(Buffer.from(page.get('key') ?? '', 'base64url'))) })
      await vi.waitFor(async () => { expect((await controller.status()).passkey?.state).toBe('wrong-passkey') })
      expect(sync.unlock).toHaveBeenCalledWith(OWNER, { prf, credentialId: Buffer.from('other-passkey').toString('base64url') })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('names and removes passkeys for the caller', async () => {
    const sync = protectedSync()
    const controller = await bootWith(sync)
    await controller.renamePasskey('cred-1', 'Work laptop')
    expect(sync.renamePasskey).toHaveBeenCalledWith(OWNER, 'cred-1', 'Work laptop')
    await controller.removePasskey('cred-1')
    expect(sync.removePasskey).toHaveBeenCalledWith(OWNER, 'cred-1')
  })
})
