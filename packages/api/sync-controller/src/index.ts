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
import { SyncKeyHolderMismatch, type SyncPasskey, type SyncPasskeyDevice, type SyncProgress } from '@aeven/sync'
import { generateHostKeys, openSealedForHost, PASSKEY_PRF_SALT, PRF_BYTES, toBase64Url, type HostKeyPair } from '@aeven/sync-vault'
import type { SyncDeviceView, SyncPasskeyPurpose, SyncPasskeyStart, SyncPasskeyView, SyncRecoveryKey, SyncView } from './types.ts'

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

/** The passkey page reported that the passkey provider already holds one of the account's passkeys. */
class PasskeyDuplicate extends Error {
  override name = 'PasskeyDuplicate'
}

/** A recovery key's text could not be read as one: wrong length or characters outside its alphabet. */
export class RecoveryKeyUnreadable extends Error {
  override name = 'RecoveryKeyUnreadable'
}

const DEVICES: ReadonlySet<string> = new Set<SyncPasskeyDevice>(['mac', 'windows', 'linux', 'iphone', 'ipad', 'android', 'chromeos', 'external', 'other'])

/** Crockford's base32 alphabet: no I, L, O or U, so a written-down key reads back unambiguously. */
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Characters of a recovery key: 28, or 140 bits, the length of an Apple account recovery key. */
const RECOVERY_LENGTH = 28

/**
 * Draw a new recovery key: 28 characters of Crockford base32, each from 5 random bits.
 * @returns the key without separators.
 */
function drawRecoveryKey(): string {
  return Array.from(randomBytes(RECOVERY_LENGTH), byte => RECOVERY_ALPHABET[byte & 31]).join('')
}

/**
 * Write a recovery key for the user in groups of four.
 * @param key - the key without separators.
 * @returns the text, such as `7D2K-9QWE-…`.
 */
function formatRecoveryKey(key: string): string {
  return key.match(/.{1,4}/g)?.join('-') ?? key
}

/**
 * Read a recovery key the user typed. Case, spaces, and dashes are ignored, and the letters I, L and O read as 1, 1
 * and 0, as Crockford's base32 defines.
 * @param text - the key as typed.
 * @returns the key without separators.
 * @throws {RecoveryKeyUnreadable} when the text is no recovery key.
 */
function parseRecoveryKey(text: string): string {
  const key = text.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0')
  if ([...key].some(char => !RECOVERY_ALPHABET.includes(char))) throw new RecoveryKeyUnreadable('a recovery key uses only digits and letters')
  if (key.length !== RECOVERY_LENGTH) throw new RecoveryKeyUnreadable(`a recovery key has ${String(RECOVERY_LENGTH)} characters`)
  return key
}

/**
 * The 32-byte secret a recovery key stands for, in place of a passkey's PRF output.
 * @param key - the key without separators.
 * @returns the secret.
 */
function recoverySecret(key: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update('aeven-sync/recovery-key/v1:').update(key).digest())
}

/**
 * The id a recovery key's copy of the account key is stored under, derived from the key so that typing it finds its
 * copy without listing the account's holders.
 * @param key - the key without separators.
 * @returns the id, base64url.
 */
function recoveryId(key: string): string {
  return `recovery-${createHash('sha256').update('aeven-sync/recovery-id/v1:').update(key).digest('base64url').slice(0, 22)}`
}

/**
 * Read what the passkey page sealed after the PRF output. A `create` step asked with `meta=1`, and a page that
 * honours it answers the JSON `{ id, aaguid?, device? }`; any other answer is the raw credential id.
 * @param rest - the bytes after the PRF output.
 * @param described - whether the step asked for the JSON.
 * @returns the credential id and what the page knew about the passkey.
 */
function passkeyIdentity(rest: Uint8Array, described: boolean): Pick<SyncPasskey, 'credentialId' | 'aaguid' | 'device'> {
  if (described) {
    let parsed: unknown
    try {
      parsed = JSON.parse(new TextDecoder().decode(rest))
    } catch {
      // A page deployed before it read `meta` answers the raw credential id, read below.
      parsed = undefined
    }
    const fields = typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
    if (typeof fields?.id === 'string' && /^[A-Za-z0-9_-]+$/.test(fields.id)) {
      return {
        credentialId: fields.id,
        ...typeof fields.aaguid === 'string' && /^[0-9a-f]{32}$/.test(fields.aaguid) ? { aaguid: fields.aaguid } : {},
        ...typeof fields.device === 'string' && DEVICES.has(fields.device) ? { device: fields.device as SyncPasskeyDevice } : {},
      }
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
          holders: protection.holders.map(holder => ({ ...holder })),
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
    if (purpose !== 'unlock') {
      params.set('user', toBase64Url(createHash('sha256').update(owner).digest()))
      const name = user.email ?? user.displayName
      if (name !== undefined) params.set('name', name)
      // The provider refuses to create a passkey where one of these already lives, instead of replacing it.
      const ids = this.ctx.sync.status(owner).protection?.passkeys ?? []
      if (ids.length > 0) params.set('ids', ids.join(','))
      params.set('meta', '1')
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
        step.state = error instanceof PasskeyUnsupported ? 'unsupported'
          : error instanceof PasskeyDuplicate ? 'duplicate'
            : error instanceof SyncKeyHolderMismatch ? 'wrong-passkey'
              : 'failed'
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
      const response = await fetch(`${this.config.siteUrl}/passkey/vault/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ verifier }),
        signal,
      })
      if (response.status === 200) {
        const result = await response.json() as { sealed?: unknown; error?: unknown }
        if (result.error === 'unsupported') throw new PasskeyUnsupported('the passkey cannot derive a key')
        if (result.error === 'duplicate') throw new PasskeyDuplicate('the passkey provider already holds one of the account passkeys')
        if (typeof result.sealed !== 'string') throw new Error('the passkey page returned no result')
        const opened = openSealedForHost(new Uint8Array(Buffer.from(result.sealed, 'base64url')), keys)
        if (opened.length <= PRF_BYTES) throw new Error('the passkey page returned a malformed result')
        signal.throwIfAborted()
        await this.apply(owner, step.purpose, {
          prf: opened.subarray(0, PRF_BYTES),
          ...passkeyIdentity(opened.subarray(PRF_BYTES), step.purpose !== 'unlock'),
        })
        return
      }
      if (response.status !== 202) throw new Error(`the passkey result could not be collected (HTTP ${String(response.status)})`)
      if (Date.now() >= deadline) throw new Error('the passkey step timed out')
      await new Promise((resolve) => { setTimeout(resolve, this.config.passkeyPollMs) })
      signal.throwIfAborted()
    }
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
   * Name one of the caller's passkeys.
   * @param id - a passkey id the status lists.
   * @param name - the name, 1 to 40 characters.
   * @returns the status afterwards.
   */
  @Remote
  async renamePasskey(id: string, name: string): Promise<SyncView> {
    const owner = this.owner()
    await this.ctx.sync.renamePasskey(owner, id, name)
    return this.view(owner)
  }

  /**
   * Remove one of the caller's passkeys or their recovery key; the last passkey stays until protection is turned off.
   * @param id - an id the status lists.
   * @returns the status afterwards.
   */
  @Remote
  async removePasskey(id: string): Promise<SyncView> {
    const owner = this.owner()
    await this.ctx.sync.removePasskey(owner, id)
    return this.view(owner)
  }

  /**
   * Create a recovery key that also holds the account key, replacing an earlier one. Its secret is shown to the
   * caller once and kept nowhere: the relay stores only the account key wrapped under it. Requires an unlocked
   * account whose key passkeys hold.
   * @returns the key to save.
   */
  @Remote
  async createRecoveryKey(): Promise<SyncRecoveryKey> {
    const owner = this.owner()
    const earlier = (this.ctx.sync.status(owner).protection?.holders ?? []).filter(holder => holder.kind === 'recovery')
    const key = drawRecoveryKey()
    await this.ctx.sync.addPasskey(owner, { credentialId: recoveryId(key), prf: recoverySecret(key), kind: 'recovery' })
    for (const holder of earlier) await this.ctx.sync.removePasskey(owner, holder.id)
    return { key: formatRecoveryKey(key) }
  }

  /**
   * Unlock this device with a recovery key the caller saved.
   * @param key - the key as the caller typed it; case, spaces, and dashes do not matter.
   * @returns the status afterwards.
   * @throws {RecoveryKeyUnreadable} when the text is no recovery key.
   * @throws {SyncKeyHolderMismatch} when it is not this account's current recovery key.
   */
  @Remote
  async unlockWithRecoveryKey(key: string): Promise<SyncView> {
    const owner = this.owner()
    const typed = parseRecoveryKey(key)
    await this.ctx.sync.unlock(owner, { credentialId: recoveryId(typed), prf: recoverySecret(typed), kind: 'recovery' })
    return this.view(owner)
  }

  /**
   * Hand the caller's account key back to the Aeven relay; every device starts over under the relay's new key. On a
   * locked device this starts over from the device's own data.
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
