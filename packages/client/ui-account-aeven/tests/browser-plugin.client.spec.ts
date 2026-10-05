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
import type { AccountSectionInjected } from '../src/client/AccountSection.tsx'

const Empty = () => null

interface Scope {
  __AVN_AEVEN_READER__?: AevenReader
}

const scope = globalThis as Scope

function utilityIds(ctx: Context): (string | undefined)[] {
  return ctx.slots.entries('shell.corner').map(entry => entry.options.id)
}

function injectedFace(ctx: Context): AccountMenuInjected {
  const entry = ctx.slots.entries('shell.corner')
    .find(e => e.options.id === 'aeven-account')
  return entry?.inject?.() as unknown as AccountMenuInjected
}

function sectionFace(ctx: Context): AccountSectionInjected {
  const entry = ctx.slots.entries('settings.section')
    .find(e => e.options.id === 'account')
  return entry?.inject?.() as unknown as AccountSectionInjected
}

async function baseContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  return ctx
}

function declareSeats(ctx: Context): () => void {
  return ctx.slots.register({
    name: 'root',
    children: {
      'shell.corner': { kind: 'list', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
    },
  } as never, Empty)
}

afterEach(() => {
  delete scope.__AVN_AEVEN_READER__
})

describe('ui-account-aeven browser half', () => {
  it('declares only the services used by registration', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('keeps the node half empty, so the Loader can address the browser feature', () => {
    expect(() => { applyNode() }).not.toThrow()
  })

  it('ships key-identical dictionaries', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    expect(NS).toBe('account.aeven')
  })

  it('waits for the navigation-band declaration and tears its entry down', async () => {
    const ctx = await baseContext()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(utilityIds(ctx)).toEqual([])

    const utilities = declareSeats(ctx)
    expect(utilityIds(ctx)).toEqual(['aeven-account'])

    await fiber.dispose()
    expect(utilityIds(ctx)).toEqual([])
    utilities()
  })

  it('reports no reader until the gate states one', async () => {
    const ctx = await baseContext()
    await ctx.plugin({ inject: [...inject], apply }).await()
    declareSeats(ctx)
    const face = injectedFace(ctx)
    expect(face.reader()).toBeUndefined()

    scope.__AVN_AEVEN_READER__ = {
      userId: 'u-1',
      displayName: 'Ollie',
      imageUrl: 'https://media.test/u-1.png',
      accountUrl: 'https://aeven.test/account/',
      signOut: () => Promise.resolve(),
      cloud: () => Promise.reject(new Error('unused')),
    }
    expect(face.reader()).toEqual({
      userId: 'u-1',
      displayName: 'Ollie',
      imageUrl: 'https://media.test/u-1.png',
    })
  })

  it('gives the Account page the Aeven web client the deployment names', async () => {
    const ctx = await baseContext()
    scope.__AVN_AEVEN_READER__ = {
      userId: 'u-4',
      accountUrl: 'https://aeven.test/account/',
      signOut: () => Promise.resolve(),
      cloud: () => Promise.reject(new Error('unused')),
    }
    await ctx.plugin({ inject: [...inject], apply }).await()
    declareSeats(ctx)
    expect(sectionFace(ctx).accountUrl()).toBe('https://aeven.test/account/')
  })

  it('leaves the Account page unlinked when the deployment names no web client', async () => {
    const ctx = await baseContext()
    scope.__AVN_AEVEN_READER__ = { userId: 'u-5', signOut: () => Promise.resolve(), cloud: () => Promise.reject(new Error('unused')) }
    await ctx.plugin({ inject: [...inject], apply }).await()
    declareSeats(ctx)
    expect(sectionFace(ctx).accountUrl()).toBeUndefined()
  })

  it('carries only the facts the deployment stated', async () => {
    const ctx = await baseContext()
    await ctx.plugin({ inject: [...inject], apply }).await()
    declareSeats(ctx)
    scope.__AVN_AEVEN_READER__ = { userId: 'u-2', signOut: () => Promise.resolve(), cloud: () => Promise.reject(new Error('unused')) }
    expect(injectedFace(ctx).reader()).toEqual({ userId: 'u-2' })
  })

  it('asks the settings shell to open', async () => {
    const ctx = await baseContext()
    await ctx.plugin({ inject: [...inject], apply }).await()
    declareSeats(ctx)
    const listener = vi.fn()
    ctx.on('settings/open', listener)
    injectedFace(ctx).openSettings()
    expect(listener).toHaveBeenCalledOnce()
  })

  it('signs out and reloads the page onto the gate', async () => {
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { assign } })
    const signOut = vi.fn(() => Promise.resolve())
    const ctx = await baseContext()
    await ctx.plugin({ inject: [...inject], apply }).await()
    declareSeats(ctx)

    injectedFace(ctx).signOut()
    expect(signOut).not.toHaveBeenCalled()

    scope.__AVN_AEVEN_READER__ = { userId: 'u-3', signOut, cloud: () => Promise.reject(new Error('unused')) }
    injectedFace(ctx).signOut()
    await Promise.resolve()
    await Promise.resolve()
    expect(signOut).toHaveBeenCalledOnce()
    expect(assign).toHaveBeenCalledWith('/')
    vi.unstubAllGlobals()
  })
})
