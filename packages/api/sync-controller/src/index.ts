/**
 * The sync Remote: the signed-in user's account sync on this Host. Every signed-in account syncs; the caller can
 * turn it off and on for this device, move the account key onto a passkey, unlock this device with one, and hand the
 * key back to the relay. Each operation acts for the caller of the running request and never reaches another
 * account.
 * @module @aeven/api-sync-controller
 */
import { createHash, randomBytes } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@aeven/typert-protocol'
import { assertNever } from '@aeven/util-values'
import type { User } from '@aeven/identity-user'
import type { SyncPasskey, SyncPasskeySignIn, SyncProgress } from '@aeven/sync'
import { generateHostKeys, openSealedForHost, PASSKEY_PRF_SALT, PRF_BYTES, toBase64Url, type HostKeyPair } from '@aeven/sync-vault'
import type { SyncDeviceView, SyncPasskeyPurpose, SyncPasskeyStart, SyncPasskeyView, SyncSignInUnlock, SyncView } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Sync Remote controller. */
    syncController: SyncController
  }
}

/** Service configuration. */
export interface Config {
  /** Origin of the Aeven site that serves the passkey page, such as `https://aeven.io`. */
  siteUrl: string
  /** How long a passkey step waits for the page's result, in milliseconds. */
  passkeyMs: number
  /** Pause between two collection attempts of a passkey result, in milliseconds. */
  passkeyPollMs: number
}

/** A passkey step in progress or one that did not finish. */
interface PasskeyStep {
  readonly purpose: SyncPasskeyPurpose
  state: SyncPasskeyView['state']
  readonly stop: AbortController
}

/** The passkey page's result was collected and showed the browser or passkey cannot derive a key. */
class PasskeyUnsupported extends Error {
  override name = 'PasskeyUnsupported'
}

/** A base64url field. */
const BASE64URL = /^[A-Za-z0-9_-]+$/

/**
 * Read the part of a passkey page's result that follows the PRF output. A page asked for a new passkey's public key
 * answers the JSON `{ id, publicKey?, alg? }`; any other answer is the raw credential id.
 * @param rest - the bytes after the PRF output.
 * @param asked - whether the step asked for the public key.
 * @returns the credential id, base64url, and the sign-in key when the page stated one.
 */
function passkeyIdentity(rest: Uint8Array, asked: boolean): { credentialId: string; signIn?: SyncPasskeySignIn } {
  if (asked) {
    let parsed: unknown
    try {
      parsed = JSON.parse(new TextDecoder().decode(rest))
    } catch {
      // A page deployed before it read `signin` answers the raw credential id, read below.
      parsed = undefined
    }
    const fields = typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
    if (typeof fields?.id === 'string' && BASE64URL.test(fields.id)) {
      const signIn = typeof fields.publicKey === 'string' && BASE64URL.test(fields.publicKey) && typeof fields.alg === 'number'
        ? { publicKey: fields.publicKey, alg: fields.alg }
        : undefined
      return { credentialId: fields.id, ...signIn === undefined ? {} : { signIn } }
    }
  }
  return { credentialId: toBase64Url(rest) }
}

/** The signed-in user's account sync. */
export default class SyncController extends TypertRemoteService {
  static inject = ['typert', 'sync', 'identityUsers']

  static Config: z<Config> = z.object({
    siteUrl: z.string().required(),
    passkeyMs: z.natural().min(1_000).default(600_000),
    passkeyPollMs: z.natural().min(100).default(1_000),
  })

  private readonly passkeys = new Map<string, PasskeyStep>()

  /**
   * @param ctx - Host context carrying sync and identity.
   * @param config - the passkey site and how long a passkey step waits.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'syncController', { namespace: 'sync' })
    ctx.effect(() => () => {
      for (const step of this.passkeys.values()) step.stop.abort()
      this.passkeys.clear()
    }, 'api-sync-controller: passkey steps')
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
    const { state, pending, queued, protection, catchingUp, error } = this.ctx.sync.status(owner)
    const progress: SyncProgress = { sessionsPending: 0, sessionsTotal: 0 }
    this.ctx.emit('sync/progress', owner, progress)
    const step = this.passkeys.get(owner)
    return {
      state, pending, queued, ...progress,
      ...catchingUp === undefined ? {} : { catchingUp },
      ...error === undefined ? {} : { error },
      ...protection === undefined ? {} : {
        protection: {
          mode: protection.mode, locked: protection.locked, downgraded: protection.downgraded, passkeys: protection.passkeys.length,
        },
      },
      ...step === undefined ? {} : { passkey: { purpose: step.purpose, state: step.state } },
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
   * Start a passkey step: the returned page creates a passkey (`protect`, `add`) or asks for one of the account's
   * passkeys (`unlock`) in the system browser, and this Host collects the result and applies it in the background.
   * The step shows in {@link status} until it succeeds; a new step replaces one in progress.
   * @param purpose - what the passkey is for.
   * @returns the page to open.
   */
  @Remote
  async startPasskey(purpose: SyncPasskeyPurpose): Promise<SyncPasskeyStart> {
    const user = this.caller()
    const owner = user.id
    this.passkeys.get(owner)?.stop.abort()
    const verifier = randomBytes(32).toString('base64url')
    const keys = generateHostKeys()
    const params = new URLSearchParams({
      mode: purpose === 'unlock' ? 'unlock' : 'create',
      nonce: createHash('sha256').update(verifier).digest('base64url'),
      key: toBase64Url(keys.publicKey),
      salt: toBase64Url(PASSKEY_PRF_SALT),
    })
    if (purpose === 'unlock') {
      const ids = this.ctx.sync.status(owner).protection?.passkeys ?? []
      if (ids.length > 0) params.set('ids', ids.join(','))
    } else {
      params.set('user', toBase64Url(createHash('sha256').update(owner).digest()))
      params.set('signin', '1')
      const name = user.email ?? user.displayName
      if (name !== undefined) params.set('name', name)
    }
    const step: PasskeyStep = { purpose, state: 'waiting', stop: new AbortController() }
    this.passkeys.set(owner, step)
    void this.collect(owner, step, verifier, keys).then(
      () => {
        if (this.passkeys.get(owner) === step) this.passkeys.delete(owner)
        this.ctx.emit('sync/status', owner)
      },
      (error: unknown) => {
        if (step.stop.signal.aborted) return
        step.state = error instanceof PasskeyUnsupported ? 'unsupported' : 'failed'
        if (step.state === 'failed') this.ctx.logger.warn('sync: the passkey step failed: %s', error)
        this.ctx.emit('sync/status', owner)
      },
    )
    return await Promise.resolve({ url: `${this.config.siteUrl}/passkey/vault#${params.toString()}` })
  }

  /**
   * Stop a passkey step, or dismiss one that did not finish.
   * @returns the status afterwards.
   */
  @Remote
  async cancelPasskey(): Promise<SyncView> {
    const owner = this.owner()
    this.passkeys.get(owner)?.stop.abort()
    this.passkeys.delete(owner)
    return await Promise.resolve(this.view(owner))
  }

  private async collect(owner: string, step: PasskeyStep, verifier: string, keys: HostKeyPair): Promise<void> {
    const { signal } = step.stop
    const deadline = Date.now() + this.config.passkeyMs
    for (;;) {
      const passkey = await this.claim(verifier, keys, step.purpose !== 'unlock', signal)
      if (passkey !== undefined) {
        signal.throwIfAborted()
        await this.apply(owner, step.purpose, passkey)
        return
      }
      if (Date.now() >= deadline) throw new Error('the passkey step timed out')
      await new Promise((resolve) => { setTimeout(resolve, this.config.passkeyPollMs) })
      signal.throwIfAborted()
    }
  }

  /**
   * Ask the passkey site once for a deposited result.
   * @param verifier - the secret whose hash the result is stored under.
   * @param keys - the one-use key pair the result is sealed to.
   * @param askedSignIn - whether the page was asked for the new passkey's public key.
   * @param signal - abandons the request.
   * @returns the passkey, or undefined while nothing is deposited.
   * @throws {PasskeyUnsupported} when the page reported that the passkey cannot derive a key.
   */
  private async claim(verifier: string, keys: HostKeyPair, askedSignIn: boolean, signal?: AbortSignal): Promise<SyncPasskey | undefined> {
    const response = await fetch(`${this.config.siteUrl}/passkey/vault/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ verifier }),
      ...signal === undefined ? {} : { signal },
    })
    if (response.status === 202) return undefined
    if (response.status !== 200) throw new Error(`the passkey result could not be collected (HTTP ${String(response.status)})`)
    const result = await response.json() as { sealed?: unknown; error?: unknown }
    if (result.error === 'unsupported') throw new PasskeyUnsupported('the passkey cannot derive a key')
    if (typeof result.sealed !== 'string') throw new Error('the passkey page returned no result')
    const opened = openSealedForHost(new Uint8Array(Buffer.from(result.sealed, 'base64url')), keys)
    if (opened.length <= PRF_BYTES) throw new Error('the passkey page returned a malformed result')
    return { prf: opened.subarray(0, PRF_BYTES), ...passkeyIdentity(opened.subarray(PRF_BYTES), askedSignIn) }
  }

  /**
   * Unlock this device with the passkey the caller just signed in with. The sign-in page evaluated the passkey's
   * PRF in the same prompt and deposited it sealed to the caller's one-use key; this collects it once. An account
   * that is not locked, or a sign-in that deposited nothing, leaves everything as it was.
   * @param unlock - the verifier and key pair the sign-in page was opened with.
   * @returns the status afterwards.
   */
  @Remote
  async unlockFromSignIn(unlock: SyncSignInUnlock): Promise<SyncView> {
    const owner = this.owner()
    if (this.ctx.sync.status(owner).protection?.locked !== true) return this.view(owner)
    const keys: HostKeyPair = {
      publicKey: new Uint8Array(Buffer.from(unlock.publicKey, 'base64url')),
      secretKey: new Uint8Array(Buffer.from(unlock.secretKey, 'base64url')),
    }
    if (keys.publicKey.length !== 32 || keys.secretKey.length !== 32) throw new Error('a sign-in unlock needs raw X25519 keys')
    let passkey: SyncPasskey | undefined
    try {
      passkey = await this.claim(unlock.verifier, keys, false)
    } catch (error) {
      // The device stays locked and the passkey popup asks for the passkey, as after any other sign-in.
      this.ctx.logger.warn('sync: the sign-in unlock could not be collected: %s', error)
      return this.view(owner)
    }
    if (passkey !== undefined) {
      await this.ctx.sync.unlock(owner, passkey).catch((error: unknown) => {
        // A passkey that holds no copy of this account's key signed in without unlocking; the popup asks for one that does.
        this.ctx.logger.warn('sync: the sign-in passkey did not unlock the account: %s', error)
      })
    }
    return this.view(owner)
  }

  private async apply(owner: string, purpose: SyncPasskeyPurpose, passkey: SyncPasskey): Promise<void> {
    switch (purpose) {
      case 'protect':
        await this.ctx.sync.protect(owner, passkey)
        return
      case 'add':
        await this.ctx.sync.addPasskey(owner, passkey)
        return
      case 'unlock':
        await this.ctx.sync.unlock(owner, passkey)
        return
      /* v8 ignore next 2 -- the purpose union is closed; a new purpose must extend apply() */
      default:
        return assertNever(purpose, 'passkey purpose')
    }
  }

  /**
   * Hand the caller's account key back to the Aeven relay; every device starts over under the relay's new key.
   * @returns the status afterwards.
   */
  @Remote
  async unprotect(): Promise<SyncView> {
    const owner = this.owner()
    await this.ctx.sync.unprotect(owner)
    return this.view(owner)
  }

  /**
   * Keep syncing under the key the relay took back from the account's passkeys.
   * @returns the status afterwards.
   */
  @Remote
  async acceptServerKey(): Promise<SyncView> {
    const owner = this.owner()
    await this.ctx.sync.acceptServerKey(owner)
    return this.view(owner)
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
   * Take another of the caller's devices off the device list.
   * @param id - a listed device other than this one.
   * @returns the devices afterwards, this one first.
   */
  @Remote
  async removeDevice(id: string): Promise<SyncDeviceView[]> {
    const owner = this.owner()
    const device = (await this.ctx.sync.devices(owner)).find(listed => listed.id === id)
    if (device === undefined) throw new Error(`no device '${id}' on this account`)
    await this.ctx.sync.removeDevice(owner, device.id)
    return await this.devices()
  }
}
