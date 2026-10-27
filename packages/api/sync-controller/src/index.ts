/**
 * The sync Remote: the signed-in user's account sync on this Host. Turning sync on, joining from a new device,
 * and approving another device all act for the caller of the running request and never reach another account.
 * @module @aeven/api-sync-controller
 */
import { createHash, randomBytes } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@aeven/typert-protocol'
import type { User } from '@aeven/identity-user'
import type { SyncJoin } from '@aeven/sync'
import {
  fromBase64Url, generateAgreementKeys, RECOVERY_PRF_SALT, toBase64Url, unwrapForDevice, type DeviceId,
} from '@aeven/sync-vault'
import type {
  SyncDeviceView, SyncJoinRequestView, SyncPasskeyMode, SyncPasskeyStart, SyncPasskeyView, SyncView,
} from './types.ts'

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
  /** Origin of the Aeven site that serves the recovery passkey page, such as `https://aeven.io`. */
  siteUrl: string
  /** How long a recovery passkey step waits for the page's result, in milliseconds. */
  passkeyMs: number
  /** Pause between two collection attempts of a recovery passkey result, in milliseconds. */
  passkeyPollMs: number
}

/** A recovery passkey step in progress or failed. */
interface Passkey extends SyncPasskeyView {
  state: 'waiting' | 'failed'
  readonly stop: AbortController
}

/** Length of a passkey PRF result. */
const PRF_BYTES = 32

/** The signed-in user's account sync. */
export default class SyncController extends TypertRemoteService {
  static inject = ['typert', 'sync', 'identityUsers']

  static Config: z<Config> = z.object({
    acceptJoinsMs: z.natural().min(1_000).default(600_000),
    siteUrl: z.string().required(),
    passkeyMs: z.natural().min(1_000).default(600_000),
    passkeyPollMs: z.natural().min(100).default(1_000),
  })

  private readonly joins = new Map<string, SyncJoin>()
  private readonly accepting = new Map<string, () => void>()
  private readonly passkeys = new Map<string, Passkey>()

  /**
   * @param ctx - Host context carrying sync and identity.
   * @param config - add-device answering window.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'syncController', { namespace: 'sync' })
    ctx.effect(() => () => {
      for (const join of this.joins.values()) join.cancel()
      for (const stop of this.accepting.values()) stop()
      for (const passkey of this.passkeys.values()) passkey.stop.abort()
      this.joins.clear()
      this.accepting.clear()
      this.passkeys.clear()
    }, 'api-sync-controller: joins')
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
    const status = this.ctx.sync.status(owner)
    return {
      state: status.state,
      devices: status.devices,
      pending: status.pending,
      ...status.joinCode === undefined ? {} : { joinCode: status.joinCode },
      acceptingJoins: this.accepting.has(owner),
      recovery: status.recovery,
      ...this.passkeyView(owner),
    }
  }

  private passkeyView(owner: string): { passkey?: SyncPasskeyView } {
    const passkey = this.passkeys.get(owner)
    return passkey === undefined ? {} : { passkey: { mode: passkey.mode, state: passkey.state } }
  }

  /**
   * Start a recovery passkey step: the returned page creates (`setup`) or asks for (`unlock`) the passkey in the
   * system browser, and this Host collects the result and applies it in the background. The step shows in
   * {@link status} until it succeeds; a new step replaces one in progress.
   * @param mode - what the passkey is for.
   * @returns the page to open.
   */
  @Remote
  async startPasskey(mode: SyncPasskeyMode): Promise<SyncPasskeyStart> {
    const user = this.caller()
    const owner = user.id
    this.passkeys.get(owner)?.stop.abort()
    const verifier = randomBytes(32).toString('base64url')
    const keys = generateAgreementKeys()
    const params = new URLSearchParams({
      mode,
      nonce: createHash('sha256').update(verifier).digest('base64url'),
      key: toBase64Url(keys.publicKey),
      salt: toBase64Url(RECOVERY_PRF_SALT),
    })
    if (mode === 'setup') {
      params.set('user', toBase64Url(createHash('sha256').update(owner).digest()))
      const name = user.email ?? user.displayName
      if (name !== undefined) params.set('name', name)
    }
    const passkey: Passkey = { mode, state: 'waiting', stop: new AbortController() }
    this.passkeys.set(owner, passkey)
    void this.collect(owner, passkey, verifier, keys).then(
      () => { if (this.passkeys.get(owner) === passkey) this.passkeys.delete(owner) },
      (error: unknown) => {
        if (passkey.stop.signal.aborted) return
        passkey.state = 'failed'
        this.ctx.logger.warn('sync: the recovery passkey step failed: %s', error)
      },
    )
    return await Promise.resolve({ url: `${this.config.siteUrl}/passkey/recovery#${params.toString()}` })
  }

  /**
   * Stop a recovery passkey step, or dismiss a failed one.
   * @returns the status afterwards.
   */
  @Remote
  async cancelPasskey(): Promise<SyncView> {
    const owner = this.owner()
    this.passkeys.get(owner)?.stop.abort()
    this.passkeys.delete(owner)
    return await Promise.resolve(this.view(owner))
  }

  private async collect(
    owner: string,
    passkey: Passkey,
    verifier: string,
    keys: { publicKey: Uint8Array; secretKey: Uint8Array },
  ): Promise<void> {
    const { signal } = passkey.stop
    const deadline = Date.now() + this.config.passkeyMs
    for (;;) {
      const response = await fetch(`${this.config.siteUrl}/passkey/recovery/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ verifier }),
        signal,
      })
      if (response.status === 200) {
        const { sealed } = await response.json() as { sealed?: unknown }
        if (typeof sealed !== 'string') throw new Error('the passkey page returned no result')
        const secret = unwrapForDevice(fromBase64Url(sealed), keys.secretKey, keys.publicKey)
        if (secret.length !== PRF_BYTES) throw new Error('the passkey page returned a malformed result')
        if (passkey.mode === 'setup') await this.ctx.sync.setRecovery(owner, secret)
        else await this.ctx.sync.recover(owner, secret)
        return
      }
      if (response.status !== 202) throw new Error(`the passkey result could not be collected (HTTP ${String(response.status)})`)
      if (Date.now() >= deadline) throw new Error('the recovery passkey step timed out')
      await new Promise((resolve) => { setTimeout(resolve, this.config.passkeyPollMs) })
      signal.throwIfAborted()
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
      this.accepting.delete(owner)
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
   * List the caller's devices.
   * @returns the devices, this one first.
   */
  @Remote
  async devices(): Promise<SyncDeviceView[]> {
    return (await this.ctx.sync.devices(this.owner())).map(({ id, name, current }) => ({ id, name, current }))
  }

  /**
   * Remove one of the caller's devices: it cannot read anything synced from now on.
   * @param id - the device id.
   * @returns the status afterwards.
   */
  @Remote
  async removeDevice(id: string): Promise<SyncView> {
    const owner = this.owner()
    await this.ctx.sync.removeDevice(owner, id as DeviceId)
    return this.view(owner)
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
