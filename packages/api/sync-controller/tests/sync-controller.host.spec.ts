/**
 * The sync Remote acts for the signed-in caller: it reports that account's sync on this Host, turns it on or off
 * for this device, and lists the account's devices, and refuses a caller nobody signed in as.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { User } from '@aeven/identity-user'
import type { Sync, SyncStatus } from '@aeven/sync'
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
  await ctx.plugin(SyncController)
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

  it('refuses a caller nobody signed in as', async () => {
    const { controller } = await boot(undefined)
    await expect(controller.status()).rejects.toThrow(/signed-in user/)
  })
})
