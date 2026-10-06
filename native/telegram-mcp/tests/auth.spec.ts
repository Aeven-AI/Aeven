/** Sign-in step handling: the flow's states, validation, retries, and terminal outcomes. */

import { describe, expect, it } from 'vitest'
import { classifyLoginError, TelegramLoginFlow } from '../aeven/auth.ts'
import { FakeLogin } from './fake-login.ts'

const me = { id: '42', name: 'Olivier', username: 'olivier', phone: '31612345678' }

describe('TelegramLoginFlow', () => {
  it('rejects a number Telegram would not accept without asking Telegram', async () => {
    const port = new FakeLogin()
    const flow = new TelegramLoginFlow(port)

    expect(await flow.start('not-a-number')).toEqual({ state: 'failed', reason: 'phone-invalid' })
    expect(port.handlers).toBeUndefined()
  })

  it('moves to the code step once Telegram delivered a code, and returns the digits it was given', async () => {
    const port = new FakeLogin()
    const flow = new TelegramLoginFlow(port)

    expect(await flow.start('+31 6 1234 5678')).toEqual({ state: 'failed', reason: 'phone-invalid' })
    expect(await flow.start('+31612345678')).toEqual({ state: 'code', phone: '31612345678' })
    expect(flow.code('12345')).toEqual({ state: 'code', phone: '31612345678' })
    expect(port.codes).toEqual(['12345'])
  })

  it('reports the reason Telegram gave for an attempt that could not start', async () => {
    const port = new FakeLogin()
    port.beginFailure = 'unreachable'
    const flow = new TelegramLoginFlow(port)

    expect(await flow.start('31612345678')).toEqual({ state: 'failed', reason: 'unreachable', phone: '31612345678' })
  })

  it('asks for the 2FA password only when Telegram does, and completes on authorization', async () => {
    const port = new FakeLogin()
    const flow = new TelegramLoginFlow(port)
    await flow.start('31612345678')

    port.handlers!.passwordRequired()
    expect(port.passwords).toEqual([])
    expect(flow.password('secret')).toEqual({ state: 'password', phone: '31612345678' })
    expect(port.passwords).toEqual(['secret'])
    // A password is only meaningful on the step Telegram asked about.
    expect(flow.code('12345')).toEqual({ state: 'password', phone: '31612345678' })
    expect(port.codes).toEqual([])

    port.handlers!.authorized(me)
    expect(await flow.status()).toEqual({ state: 'authorized', phone: '31612345678', identity: me })
  })

  it('keeps the step and reports a rejected code so the user can type another', async () => {
    const port = new FakeLogin()
    const flow = new TelegramLoginFlow(port)
    await flow.start('31612345678')

    port.handlers!.retry('code-invalid')
    expect(await flow.status()).toEqual({ state: 'code', phone: '31612345678', reason: 'code-invalid' })
    expect(flow.code('54321')).toEqual({ state: 'code', phone: '31612345678' })
    expect(port.codes).toEqual(['54321'])
  })

  it('ignores a step report that arrives after the attempt settled', async () => {
    const port = new FakeLogin()
    const flow = new TelegramLoginFlow(port)
    await flow.start('31612345678')

    port.handlers!.failed('too-many-attempts')
    expect(await flow.status()).toEqual({ state: 'failed', phone: '31612345678', reason: 'too-many-attempts' })
    port.handlers!.authorized(me)
    expect(await flow.status()).toEqual({ state: 'failed', phone: '31612345678', reason: 'too-many-attempts' })
  })

  it('reads the stored account, distinguishing a rejected session from no session at all', async () => {
    const port = new FakeLogin()
    const flow = new TelegramLoginFlow(port)

    expect(await flow.status()).toEqual({ state: 'login' })

    port.answered({ kind: 'identity', identity: me })
    expect(await flow.status(true)).toEqual({ state: 'authorized', phone: '31612345678', identity: me })
    expect(port.verified).toEqual([false, true])

    port.answered({ kind: 'rejected' })
    expect(await flow.status(true)).toEqual({ state: 'unlinked', phone: '31612345678' })

    port.answered({ kind: 'none' })
    expect(await flow.status(true)).toEqual({ state: 'login' })
  })

  it('forgets the account on logout', async () => {
    const port = new FakeLogin()
    const flow = new TelegramLoginFlow(port)
    await flow.start('31612345678')
    port.handlers!.authorized(me)

    await flow.logout()
    expect(port.loggedOut).toBe(true)
    expect(await flow.status()).toEqual({ state: 'login' })
  })
})

describe('classifyLoginError', () => {
  it('maps Telegram failures to the fixed reasons the browser shows', () => {
    expect(classifyLoginError(new Error('PHONE_CODE_INVALID'))).toBe('code-invalid')
    expect(classifyLoginError(new Error('SESSION_PASSWORD_NEEDED'))).toBe('password-invalid')
    expect(classifyLoginError(new Error('PHONE_NUMBER_BANNED'))).toBe('phone-invalid')
    expect(classifyLoginError(new Error('FLOOD_WAIT_3600'))).toBe('too-many-attempts')
    expect(classifyLoginError(new Error('connect ETIMEDOUT 149.154.167.51:443'))).toBe('unreachable')
    expect(classifyLoginError(new Error('something else'))).toBe('other')
  })
})
