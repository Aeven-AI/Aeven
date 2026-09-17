import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@aeven/client-ui-renderer/client'
import { stubSettingsScope } from '@aeven/client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@aeven/client-locale/client'
import type { AevenReader } from '@aeven/client-ui-auth-aeven'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'
import type { AccountMenuInjected } from '../src/client/AccountMenu.tsx'

const Empty = () => null

interface Scope {
  __AVN_AEVEN_READER__?: AevenReader
}

const scope = globalThis as Scope

function utilityIds(ctx: Context): (string | undefined)[] {
  return ctx.slots.entries('conversation.session.header.utilities').map(entry => entry.options.id)
}

function injectedFace(ctx: Context): AccountMenuInjected {
  const entry = ctx.slots.entries('conversation.session.header.utilities')
    .find(e => e.options.id === 'aeven-account')
  return entry?.inject?.() as unknown as AccountMenuInjected
}

async function baseContext(theme: {
  scheme: 'light' | 'dark'
  setTheme: (id: string) => void
}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  ctx.provide('theme', {
    getTheme: () => ({ active: { colorScheme: theme.scheme } }),
    setTheme: theme.setTheme,
  } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  return ctx
}

function declareHeaderUtilities(ctx: Context): () => void {
  return ctx.slots.register({
    name: 'root',
    children: { 'conversation.session.header.utilities': { kind: 'list', scope: 'session' } },
  } as never, Empty)
}

afterEach(() => {
  delete scope.__AVN_AEVEN_READER__
})

describe('ui-account-aeven browser half', () => {
  it('declares only the services used by registration', () => {
    expect(inject).toEqual(['slots', 'locale', 'theme'])
  })

  it('keeps the node half empty, so the Loader can address the browser feature', () => {
    expect(() => { applyNode() }).not.toThrow()
  })

  it('ships key-identical dictionaries', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    expect(NS).toBe('account.aeven')
  })

  it('waits for the header utility declaration and tears its entry down', async () => {
    const ctx = await baseContext({ scheme: 'light', setTheme: () => {} })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(utilityIds(ctx)).toEqual([])

    const utilities = declareHeaderUtilities(ctx)
    expect(utilityIds(ctx)).toEqual(['aeven-account'])

    await fiber.dispose()
    expect(utilityIds(ctx)).toEqual([])
    utilities()
  })

  it('reports no reader until the gate states one', async () => {
    const ctx = await baseContext({ scheme: 'light', setTheme: () => {} })
    await ctx.plugin({ inject: [...inject], apply }).await()
    declareHeaderUtilities(ctx)
    const face = injectedFace(ctx)
    expect(face.reader()).toBeUndefined()
    expect(face.accountUrl()).toBeUndefined()

    scope.__AVN_AEVEN_READER__ = {
      userId: 'u-1',
      displayName: 'Ollie',
      imageUrl: 'https://media.test/u-1.png',
      accountUrl: 'https://aeven.test/account/',
      signOut: () => Promise.resolve(),
    }
    expect(face.reader()).toEqual({
      userId: 'u-1',
      displayName: 'Ollie',
      imageUrl: 'https://media.test/u-1.png',
    })
    expect(face.accountUrl()).toBe('https://aeven.test/account/')
  })

  it('carries only the facts the deployment stated', async () => {
    const ctx = await baseContext({ scheme: 'light', setTheme: () => {} })
    await ctx.plugin({ inject: [...inject], apply }).await()
    declareHeaderUtilities(ctx)
    scope.__AVN_AEVEN_READER__ = { userId: 'u-2', signOut: () => Promise.resolve() }
    expect(injectedFace(ctx).reader()).toEqual({ userId: 'u-2' })
  })

  it('reads and writes the app theme', async () => {
    const setTheme = vi.fn()
    const ctx = await baseContext({ scheme: 'dark', setTheme })
    await ctx.plugin({ inject: [...inject], apply }).await()
    declareHeaderUtilities(ctx)
    const face = injectedFace(ctx)
    expect(face.nightMode()).toBe(true)
    face.setNightMode(false)
    expect(setTheme).toHaveBeenCalledWith('light')
    face.setNightMode(true)
    expect(setTheme).toHaveBeenLastCalledWith('dark')
  })

  it('signs out and reloads the page onto the gate', async () => {
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { assign } })
    const signOut = vi.fn(() => Promise.resolve())
    const ctx = await baseContext({ scheme: 'light', setTheme: () => {} })
    await ctx.plugin({ inject: [...inject], apply }).await()
    declareHeaderUtilities(ctx)

    injectedFace(ctx).signOut()
    expect(signOut).not.toHaveBeenCalled()

    scope.__AVN_AEVEN_READER__ = { userId: 'u-3', signOut }
    injectedFace(ctx).signOut()
    await Promise.resolve()
    await Promise.resolve()
    expect(signOut).toHaveBeenCalledOnce()
    expect(assign).toHaveBeenCalledWith('/')
    vi.unstubAllGlobals()
  })
})
