// @vitest-environment jsdom
/**
 * ui-imagine browser half on a real cordis Context: the plugin claims `/i` on
 * the real surface router (over a fake window), keeps every Imagine address
 * naming an id, and registers the page under the `surface` slot's `imagine`
 * key. Disposing the plugin releases both (HMR safety); the node half stays
 * inert.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@aeven/client-ui-renderer/client'
import { LocaleRuntime } from '@aeven/client-locale/client'
import { Surfaces, type SurfaceWindow } from '@aeven/client-ui-layout/src/client/surfaces.ts'
import { apply, imagineIdOf, inject } from '../src/client/index.ts'
import type { ImaginePageInjected } from '../src/client/slots.ts'
import { apply as nodeApply } from '../src/index.ts'

const ID = '4cc55fb3-2630-4249-b52b-87518203ad17'

class FakeWindow implements SurfaceWindow {
  readonly replaced: string[] = []
  readonly listeners = new Set<() => void>()
  readonly location = { href: 'http://127.0.0.1:3080/' }
  readonly history = {
    pushState: (_data: unknown, _unused: string, url?: string | URL | null) => { this.go(String(url)) },
    replaceState: (_data: unknown, _unused: string, url?: string | URL | null) => {
      this.replaced.push(String(url))
      this.go(String(url))
    },
  }

  addEventListener(_type: 'popstate', listener: () => void): void { this.listeners.add(listener) }
  removeEventListener(_type: 'popstate', listener: () => void): void { this.listeners.delete(listener) }

  go(path: string): void {
    this.location.href = new URL(path, this.location.href).href
  }

  /** Browser Back/Forward: the address moves, then popstate fires. */
  pop(path: string): void {
    this.go(path)
    for (const listener of [...this.listeners]) listener()
  }
}

async function bench(path: string) {
  const browser = new FakeWindow()
  browser.go(path)
  const surfaces = new Surfaces(() => browser)
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root', children: { 'surface': { kind: 'keyed', scope: 'root' } },
  } as never, (() => null) as never)
  ctx.provide('layout', { surfaces } as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { browser, surfaces, ctx, fiber, entry: () => ctx.slots.entries('surface')[0] }
}

describe('ui-imagine browser plugin', () => {
  it('claims /i and registers the page under the imagine key', async () => {
    const b = await bench(`/i/${ID}`)
    expect(b.surfaces.current.getSnapshot()).toBe('imagine')
    expect(b.browser.replaced).toEqual([])
    const entry = b.entry()!
    expect(entry.options).toMatchObject({ key: 'imagine' })
    expect(entry.locale).toBe('imagine')
    const injected = (entry.inject as unknown as () => ImaginePageInjected)()
    expect(injected.heroT('brand.localBuild')).toBeTypeOf('string')
  })

  it('rewrites a bare or malformed Imagine address to a fresh id, and leaves the chat alone', async () => {
    const b = await bench('/i')
    expect(b.browser.replaced).toHaveLength(1)
    expect(imagineIdOf(b.surfaces.pathname())).toBeDefined()

    b.browser.pop('/i/not-a-uuid')
    expect(b.browser.replaced).toHaveLength(2)
    expect(imagineIdOf(b.surfaces.pathname())).toBeDefined()

    b.browser.pop(`/c/${ID}`)
    expect(b.browser.replaced).toHaveLength(2)
    expect(b.surfaces.pathname()).toBe(`/c/${ID}`)
  })

  it('releases the claim and the page when the plugin is disposed', async () => {
    const b = await bench(`/i/${ID}`)
    await b.fiber.dispose()
    expect(b.surfaces.current.getSnapshot()).toBeUndefined()
    expect(b.entry()).toBeUndefined()
    expect(b.browser.listeners.size).toBe(0)
    b.browser.pop('/i')
    expect(b.browser.replaced).toEqual([])
    expect(nodeApply).not.toThrow()
  })
})
