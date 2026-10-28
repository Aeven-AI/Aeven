/**
 * The sync Remote: the signed-in user's account sync on this Host. Every signed-in account syncs; the caller can
 * turn it off and on for this device. Each operation acts for the caller of the running request and never reaches
 * another account.
 * @module @aeven/api-sync-controller
 */
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@aeven/typert-protocol'
import type { User } from '@aeven/identity-user'
import type {} from '@aeven/sync'
import type { SyncDeviceView, SyncView } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Sync Remote controller. */
    syncController: SyncController
  }
}

/** The signed-in user's account sync. */
export default class SyncController extends TypertRemoteService {
  static inject = ['typert', 'sync', 'identityUsers']

  /** @param ctx - Host context carrying sync and identity. */
  constructor(ctx: Context) {
    super(ctx, 'syncController', { namespace: 'sync' })
  }

  private caller(): User {
    const user = this.ctx.identityUsers.actingUser()
    if (user === undefined) throw new Error('sync needs a signed-in user')
    return user
  }

  private owner(): string {
    return this.caller().id
  }

  private view(owner: string): SyncView {
    const { state, pending, queued } = this.ctx.sync.status(owner)
    return { state, pending, queued }
  }

  /**
   * Read the caller's sync status.
   * @returns the status.
   */
  @Remote
  async status(): Promise<SyncView> {
    return await Promise.resolve(this.view(this.owner()))
  }

  /**
   * Turn sync on or off for the caller's account on this device.
   * @param enabled - whether this device syncs the account.
   * @returns the status afterwards.
   */
  @Remote
  async setEnabled(enabled: boolean): Promise<SyncView> {
    const owner = this.owner()
    this.ctx.sync.setEnabled(owner, enabled)
    return await Promise.resolve(this.view(owner))
  }

  /**
   * List the caller's devices.
   * @returns the devices, this one first.
   */
  @Remote
  async devices(): Promise<SyncDeviceView[]> {
    return (await this.ctx.sync.devices(this.owner())).map(({ id, name, current }) => ({ id, name, current }))
  }
}
