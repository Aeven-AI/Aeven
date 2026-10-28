/**
 * The sync Remote acts for the signed-in caller: it reports and changes that account's sync, keeps an
 * add-device window and a join per account, and runs the recovery passkey step by collecting the page's
 * sealed result and handing the opened PRF result to sync.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { User } from '@aeven/identity-user'
import type { Sync, SyncJoin, SyncStatus } from '@aeven/sync'
import { fromBase64Url, RECOVERY_PRF_SALT, toBase64Url, wrapForDevice, type DeviceId } from '@aeven/sync-vault'
import SyncController from '../src/index.ts'

const SITE = 'https://site.test'
const OWNER = 'owner-1'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** A sync service stand-in that records what the Remote asked of it. */
function fakeSync(status: Partial<SyncStatus> = {}) {
  const releases: Array<(value: undefined) => void> = []
  const cancel = vi.fn()
  const nextJoin = (): SyncJoin => ({
    code: Promise.resolve('123456'),
    admitted: new Promise((resolve) => { releases.push(resolve) }),
    cancel,
  })
  const stopAccepting = vi.fn()
  const sync = {
    status: vi.fn((): SyncStatus => ({ state: 'online', devices: 2, pending: 0, recovery: false, ...status })),
    vaultExists: vi.fn(() => Promise.resolve(true)),
    createVault: vi.fn(() => Promise.resolve()),
    join: vi.fn(() => Promise.resolve(nextJoin())),
    acceptJoins: vi.fn(() => stopAccepting),
    devices: vi.fn(() => Promise.resolve([{ id: 'd1' as DeviceId, name: 'laptop', current: true }])),
    removeDevice: vi.fn(() => Promise.resolve()),
    joinRequests: vi.fn(() => [{ id: 'r1', code: '654321' }]),
    approveJoin: vi.fn(() => Promise.resolve()),
    rejectJoin: vi.fn(),
    setRecovery: vi.fn(() => Promise.resolve()),
    recover: vi.fn(() => Promise.resolve()),
  }
  return { sync, cancel, admit: (index = releases.length - 1) => { releases[index]?.(undefined) }, stopAccepting }
}

async function boot(fake = fakeSync(), user: User | null = { id: OWNER, email: 'sam@example.test' }) {
  const ctx = new Context()
  ctx.provide('typert', {} as never)
  ctx.provide('sync', fake.sync as unknown as Sync)
  ctx.provide('identityUsers', { actingUser: () => user ?? undefined } as never)
  const fiber = ctx.plugin(SyncController, { siteUrl: SITE, acceptJoinsMs: 1_000, passkeyMs: 60_000, passkeyPollMs: 100 })
  await fiber
  return { controller: ctx.syncController, fake, fiber, ctx }
}

/** The fragment parameters of a passkey page URL. */
function pageParams(url: string): URLSearchParams {
  expect(url.startsWith(`${SITE}/passkey/recovery#`)).toBe(true)
  return new URLSearchParams(url.slice(url.indexOf('#') + 1))
}

/** Answer claims the way the site does: pending a given number of times, then the result. */
function stubSite(answers: Array<{ status: number; body?: unknown }>) {
  const claims: Array<{ url: string; body: unknown }> = []
  vi.stubGlobal('fetch', vi.fn((url: string, init: { body: string; signal: AbortSignal }) => {
    claims.push({ url, body: JSON.parse(init.body) })
    const answer = answers.shift()
    if (answer === undefined) {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => { reject(new Error('aborted')) })
      })
    }
    return Promise.resolve({ status: answer.status, json: () => Promise.resolve(answer.body) })
  }))
  return claims
}

const sealedFor = (url: string, secret: Uint8Array): string => toBase64Url(wrapForDevice(secret, fromBase64Url(pageParams(url).get('key') ?? '')))

/** Answer every claim with `secret` sealed to the key of the page URL `page()` reads once the step started. */
function stubResult(page: () => string, secret: Uint8Array): void {
  vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => {
    setTimeout(() => { resolve({ status: 200, json: () => Promise.resolve({ sealed: sealedFor(page(), secret) }) }) }, 0)
  })))
}

describe('the sync Remote', () => {
  it('reports and changes the caller\'s sync', async () => {
    const { controller, fake } = await boot()
    expect(await controller.status()).toEqual({ state: 'online', devices: 2, pending: 0, acceptingJoins: false, recovery: false })
    expect(await controller.vaultExists()).toBe(true)
    await controller.createVault()
    expect(fake.sync.createVault).toHaveBeenCalledWith(OWNER)
    expect(await controller.devices()).toEqual([{ id: 'd1', name: 'laptop', current: true }])
    await controller.removeDevice('d2')
    expect(fake.sync.removeDevice).toHaveBeenCalledWith(OWNER, 'd2')
    expect(await controller.joinRequests()).toEqual([{ id: 'r1', code: '654321' }])
    await controller.approveJoin('r1')
    await controller.rejectJoin('r2')
    expect(fake.sync.approveJoin).toHaveBeenCalledWith(OWNER, 'r1')
    expect(fake.sync.rejectJoin).toHaveBeenCalledWith(OWNER, 'r2')
  })

  it('keeps one join per account until it is admitted or cancelled', async () => {
    const fake = fakeSync({ state: 'joining', joinCode: '123456' })
    const { controller } = await boot(fake)
    expect(await controller.startJoin()).toMatchObject({ state: 'joining', joinCode: '123456' })
    await controller.startJoin()
    expect(fake.sync.join).toHaveBeenCalledTimes(1)
    fake.admit()
    await vi.waitFor(async () => {
      await controller.startJoin()
      expect(fake.sync.join).toHaveBeenCalledTimes(2)
    })
    await controller.cancelJoin()
    expect(fake.cancel).toHaveBeenCalled()
    await controller.cancelJoin()
    await controller.startJoin()
    await controller.cancelJoin()
    await controller.startJoin()
    fake.admit(2)
    await new Promise(resolve => setTimeout(resolve, 0))
    await controller.startJoin()
    expect(fake.sync.join).toHaveBeenCalledTimes(4)
  })

  it('answers join requests for a bounded window and stops on request or disposal', async () => {
    vi.useFakeTimers()
    try {
      const { controller, fake, fiber } = await boot()
      expect(await controller.acceptJoins()).toMatchObject({ acceptingJoins: true })
      await controller.acceptJoins()
      expect(fake.stopAccepting).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(1_000)
      expect(fake.stopAccepting).toHaveBeenCalledTimes(2)
      expect(await controller.status()).toMatchObject({ acceptingJoins: false })
      await controller.acceptJoins()
      expect(await controller.stopAcceptingJoins()).toMatchObject({ acceptingJoins: false })
      await controller.acceptJoins()
      await controller.startJoin()
      await fiber.dispose()
      expect(fake.stopAccepting).toHaveBeenCalledTimes(4)
      expect(fake.cancel).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses a caller who is not signed in', async () => {
    const { controller } = await boot(fakeSync(), null)
    await expect(controller.status()).rejects.toThrow(/signed-in user/)
  })

  it('makes a new passkey the recovery passkey once the page returns its sealed result', async () => {
    const { controller, fake } = await boot()
    const claims = stubSite([{ status: 202 }])
    const { url } = await controller.startPasskey('setup')
    const params = pageParams(url)
    expect(params.get('mode')).toBe('setup')
    expect(params.get('salt')).toBe(toBase64Url(RECOVERY_PRF_SALT))
    expect(params.get('name')).toBe('sam@example.test')
    expect(fromBase64Url(params.get('user') ?? '')).toHaveLength(32)
    expect(await controller.status()).toMatchObject({ passkey: { mode: 'setup', state: 'waiting' } })
    const prf = new Uint8Array(32).fill(5)
    stubSite([{ status: 200, body: { sealed: sealedFor(url, prf) } }])
    await vi.waitFor(() => { expect(fake.sync.setRecovery).toHaveBeenCalledWith(OWNER, prf) })
    expect(claims[0]).toMatchObject({ url: `${SITE}/passkey/recovery/claim` })
    await vi.waitFor(async () => { expect((await controller.status()).passkey).toBeUndefined() })
  })

  it('adds this device with the recovery passkey, naming no passkey to create', async () => {
    const { controller, fake } = await boot(fakeSync({ state: 'unenrolled' }), { id: OWNER })
    const prf = new Uint8Array(32).fill(6)
    let url = ''
    stubResult(() => url, prf)
    ;({ url } = await controller.startPasskey('unlock'))
    expect(pageParams(url).has('user')).toBe(false)
    expect(pageParams(url).has('name')).toBe(false)
    await vi.waitFor(() => { expect(fake.sync.recover).toHaveBeenCalledWith(OWNER, prf) })
    const named = await boot(fakeSync(), { id: OWNER, displayName: 'Sam' })
    stubSite([])
    expect(pageParams((await named.controller.startPasskey('setup')).url).get('name')).toBe('Sam')
    await named.controller.cancelPasskey()
    const anonymous = await boot(fakeSync(), { id: OWNER })
    expect(pageParams((await anonymous.controller.startPasskey('setup')).url).has('name')).toBe(false)
    await anonymous.controller.cancelPasskey()
  })

  it('reports a passkey step that could not finish until it is dismissed', async () => {
    const warn = vi.fn()
    const cases: Array<{ answer: { status: number; body?: unknown }; reason: RegExp }> = [
      { answer: { status: 500 }, reason: /HTTP 500/ },
      { answer: { status: 200, body: {} }, reason: /no result/ },
      { answer: { status: 200, body: { sealed: 'short' } }, reason: /./ },
    ]
    for (const { answer, reason } of cases) {
      const { controller, ctx } = await boot()
      ctx.logger.warn = warn
      stubSite([answer])
      await controller.startPasskey('unlock')
      await vi.waitFor(async () => { expect((await controller.status()).passkey).toEqual({ mode: 'unlock', state: 'failed' }) })
      expect(String(warn.mock.lastCall?.[1])).toMatch(reason)
      expect((await controller.cancelPasskey()).passkey).toBeUndefined()
    }

    const { controller, ctx, fake } = await boot()
    ctx.logger.warn = warn
    fake.sync.setRecovery.mockRejectedValueOnce(new Error('relay down'))
    let url = ''
    stubResult(() => url, new Uint8Array(16))
    ;({ url } = await controller.startPasskey('setup'))
    await vi.waitFor(() => { expect(String(warn.mock.lastCall?.[1])).toMatch(/malformed/) })
    stubResult(() => url, new Uint8Array(32))
    ;({ url } = await controller.startPasskey('setup'))
    await vi.waitFor(() => { expect(String(warn.mock.lastCall?.[1])).toMatch(/relay down/) })
  })

  it('keeps a newer passkey step when an older one finishes after it started', async () => {
    const { controller, fake } = await boot()
    let finish!: () => void
    fake.sync.setRecovery.mockReturnValueOnce(new Promise((resolve) => { finish = () => { resolve() } }))
    let url = ''
    stubResult(() => url, new Uint8Array(32))
    ;({ url } = await controller.startPasskey('setup'))
    await vi.waitFor(() => { expect(fake.sync.setRecovery).toHaveBeenCalled() })
    stubSite([])
    await controller.startPasskey('unlock')
    finish()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await controller.status()).toMatchObject({ passkey: { mode: 'unlock', state: 'waiting' } })
    await controller.cancelPasskey()
  })

  it('gives up when the page never returns, and stops collecting when replaced, cancelled, or disposed', async () => {
    const warn = vi.fn()
    const { controller, ctx, fiber } = await boot()
    ctx.logger.warn = warn
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 61_000))
    stubSite([{ status: 202 }])
    await controller.startPasskey('unlock')
    await vi.waitFor(() => { expect(String(warn.mock.lastCall?.[1])).toMatch(/timed out/) })
    vi.restoreAllMocks()

    const claims = stubSite([])
    await controller.startPasskey('unlock')
    await controller.startPasskey('setup')
    expect(await controller.status()).toMatchObject({ passkey: { mode: 'setup', state: 'waiting' } })
    await controller.cancelPasskey()
    stubSite([{ status: 202 }])
    await controller.startPasskey('unlock')
    await fiber.dispose()
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(claims).toHaveLength(2)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
