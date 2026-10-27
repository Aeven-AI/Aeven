/**
 * The sync Remote: the signed-in user's account sync on this Host. Turning sync on, joining from a new device,
 * and approving another device all act for the caller of the running request and never reach another account.
 * @module @aeven/api-sync-controller
 */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@aeven/typert-protocol'
import type {} from '@aeven/identity-user'
import type { SyncJoin } from '@aeven/sync'
import type { SyncJoinRequestView, SyncView } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Sync Remote controller. */
    syncController: SyncController
  }
}

/** Service configuration. */
export interface Config {
  /** How long an add-device screen keeps answering join requests without being reopened, in milliseconds. */
  acceptJoinsMs: number
}

/** The signed-in user's account sync. */
export default class SyncController extends TypertRemoteService {
  static inject = ['typert', 'sync', 'identityUsers']

  static Config: z<Config> = z.object({
    acceptJoinsMs: z.natural().min(1_000).default(600_000),
  })

  private readonly joins = new Map<string, SyncJoin>()
  private readonly accepting = new Map<string, () => void>()

  /**
   * @param ctx - Host context carrying sync and identity.
   * @param config - add-device answering window.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'syncController', { namespace: 'sync' })
    ctx.effect(() => () => {
      for (const join of this.joins.values()) join.cancel()
      for (const stop of this.accepting.values()) stop()
      this.joins.clear()
      this.accepting.clear()
    }, 'api-sync-controller: joins')
  }

  private owner(): string {
    const owner = this.ctx.identityUsers.actingUser()?.id
    if (owner === undefined) throw new Error('sync needs a signed-in user')
    return owner
  }

  private view(owner: string): SyncView {
    const status = this.ctx.sync.status(owner)
    return {
      state: status.state,
      devices: status.devices,
      pending: status.pending,
      ...status.joinCode === undefined ? {} : { joinCode: status.joinCode },
      acceptingJoins: this.accepting.has(owner),
    }
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
   * Whether the caller's account already syncs on another device, so this one should join rather than start.
   * @returns whether the account has a vault.
   */
  @Remote
  async vaultExists(): Promise<boolean> {
    return await this.ctx.sync.vaultExists(this.owner())
  }

  /**
   * Turn sync on with this device as the account's first.
   * @returns the status afterwards.
   */
  @Remote
  async createVault(): Promise<SyncView> {
    const owner = this.owner()
    await this.ctx.sync.createVault(owner)
    return this.view(owner)
  }

  /**
   * Ask the account's other devices to admit this one. The code appears in {@link status} once a device with
   * its add-device screen open answers.
   * @returns the status afterwards.
   */
  @Remote
  async startJoin(): Promise<SyncView> {
    const owner = this.owner()
    if (!this.joins.has(owner)) {
      const join = await this.ctx.sync.join(owner)
      this.joins.set(owner, join)
      const forget = (): void => {
        if (this.joins.get(owner) === join) this.joins.delete(owner)
      }
      void join.admitted.then(forget, forget)
    }
    return this.view(owner)
  }

  /**
   * Stop asking to join.
   * @returns the status afterwards.
   */
  @Remote
  async cancelJoin(): Promise<SyncView> {
    const owner = this.owner()
    this.joins.get(owner)?.cancel()
    this.joins.delete(owner)
    return await Promise.resolve(this.view(owner))
  }

  /**
   * Answer join requests from new devices while the add-device screen is open, for at most the configured window.
   * @returns the status afterwards.
   */
  @Remote
  async acceptJoins(): Promise<SyncView> {
    const owner = this.owner()
    this.accepting.get(owner)?.()
    const release = this.ctx.sync.acceptJoins(owner)
    const timer = setTimeout(() => { stop() }, this.config.acceptJoinsMs)
    const stop = (): void => {
      clearTimeout(timer)
      release()
      if (this.accepting.get(owner) === stop) this.accepting.delete(owner)
    }
    this.accepting.set(owner, stop)
    return await Promise.resolve(this.view(owner))
  }

  /**
   * Stop answering join requests.
   * @returns the status afterwards.
   */
  @Remote
  async stopAcceptingJoins(): Promise<SyncView> {
    const owner = this.owner()
    this.accepting.get(owner)?.()
    return await Promise.resolve(this.view(owner))
  }

  /**
   * List join requests waiting for the caller on this device.
   * @returns the requests.
   */
  @Remote
  async joinRequests(): Promise<SyncJoinRequestView[]> {
    return await Promise.resolve(this.ctx.sync.joinRequests(this.owner()).map(({ id, code }) => ({ id, code })))
  }

  /**
   * Admit the device behind a request after the user saw the same code on both devices.
   * @param id - the request id.
   * @returns the status afterwards.
   */
  @Remote
  async approveJoin(id: string): Promise<SyncView> {
    const owner = this.owner()
    await this.ctx.sync.approveJoin(owner, id)
    return this.view(owner)
  }

  /**
   * Discard a join request.
   * @param id - the request id.
   * @returns the status afterwards.
   */
  @Remote
  async rejectJoin(id: string): Promise<SyncView> {
    const owner = this.owner()
    this.ctx.sync.rejectJoin(owner, id)
    return await Promise.resolve(this.view(owner))
  }
}
