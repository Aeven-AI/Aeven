// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@aeven/client-ui-renderer/client'
import { stubSettingsScope } from '@aeven/client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@aeven/client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import type { UpdatePopupInjected } from '../src/client/UpdatePopup.tsx'
import type { DesktopUpdateStatus } from '../src/client/update-carrier.ts'
import { apply as applyNode } from '../src/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'

afterEach(() => {
  delete (window as { avnDesktop?: unknown }).avnDesktop
})

/** Slot ledger reader: entry ids currently registered in the shell overlay list. */
function overlayEntryIds(ctx: Context): (string | undefined)[] {
  return ctx.slots.entries('shell.overlay').map(entry => entry.options.id)
}

/** The release stream the Electron preload exposes, stubbed to record its calls. */
function updateCarrier() {
  let listener: ((status: DesktopUpdateStatus) => void) | undefined
  return {
    get: vi.fn(async (): Promise<DesktopUpdateStatus> => ({ phase: 'idle' })),
    check: vi.fn(async (): Promise<DesktopUpdateStatus> => ({ phase: 'ready', version: '1.2.0' })),
    install: vi.fn(async (): Promise<void> => {}),
    onChange: vi.fn((next: (status: DesktopUpdateStatus) => void) => {
      listener = next
      return () => { listener = undefined }
    }),
    /** Report one state the way the shell publishes it. */
    publish: (status: DesktopUpdateStatus): void => { listener?.(status) },
    /** Whether the page still subscribes to the shell's states. */
    listening: (): boolean => listener !== undefined,
  }
}

/**
 * Boot the browser half over a real slot tree that declares the shell overlay,
 * with the Electron carrier the page would see.
 * @param options.carrier - the release stream, when the page has a shell.
 * @param options.commands - the application-menu subscriptions the preload exposes.
 */
async function bench(options: {
  carrier?: ReturnType<typeof updateCarrier>
  commands?: ((command: string) => void)[]
} = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'shell.overlay': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  // This lane has a `window`, so browser-language detection would pick the host
  // locale; state the asserted locale explicitly.
  ctx.locale.setLocale('zh')
  if (options.carrier !== undefined) {
    const commands = options.commands ?? []
    ;(window as { avnDesktop?: unknown }).avnDesktop = {
      update: options.carrier,
      onCommand: (listener: (command: string) => void) => {
        commands.push(listener)
        return () => { commands.splice(commands.indexOf(listener), 1) }
      },
    }
  }
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

/** The business face the popup's registration binds. */
function injectedFace(ctx: Context): UpdatePopupInjected {
  const entry = ctx.slots.entries('shell.overlay')[0]
  const face = entry?.inject?.() as UpdatePopupInjected | undefined
  if (face === undefined) throw new Error('the update popup registered no inject face')
  return face
}

describe('ui-update browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers the popup, and fiber teardown removes it (HMR safety)', async () => {
    const { ctx, fiber } = await bench({ carrier: updateCarrier() })
    expect(overlayEntryIds(ctx)).toContain('update')
    await fiber.dispose()
    expect(overlayEntryIds(ctx)).not.toContain('update')
  })

  it('registers nothing where no Desktop shell renders the page', async () => {
    const { ctx } = await bench()
    expect(overlayEntryIds(ctx)).toEqual([])
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench({ carrier: updateCarrier() })
    const translate = ctx.locale.bind(NS)
    expect(translate('title')).toBe(zh['title'])
    ctx.locale.setLocale('en')
    expect(translate('title')).toBe(en['title'])

    await fiber.dispose()
    expect(translate('title')).not.toBe(en['title'])
  })

  it('opens the popup from the application menu on the shell`s latest state', async () => {
    const carrier = updateCarrier()
    const commands: ((command: string) => void)[] = []
    const { ctx } = await bench({ carrier, commands })
    const face = injectedFace(ctx)
    expect(face.hooks.update.getSnapshot().open).toBe(false)

    commands[0]?.('open-settings')
    expect(face.hooks.update.getSnapshot().open).toBe(false)

    commands[0]?.('show-update')
    expect(face.hooks.update.getSnapshot().open).toBe(true)
    expect(carrier.get).toHaveBeenCalledOnce()
    await vi.waitFor(() => { expect(face.hooks.update.getSnapshot().status.phase).toBe('idle') })
  })

  it('follows every state the shell publishes, and stops when the fiber leaves', async () => {
    const carrier = updateCarrier()
    const { ctx, fiber } = await bench({ carrier })
    const face = injectedFace(ctx)

    carrier.publish({ phase: 'downloading', version: '1.2.0', percent: 30 })
    expect(face.hooks.update.getSnapshot().status).toEqual({ phase: 'downloading', version: '1.2.0', percent: 30 })
    expect(carrier.listening()).toBe(true)

    await fiber.dispose()
    expect(carrier.listening()).toBe(false)
  })

  it('runs the check the retry asks for and shows what it found', async () => {
    const carrier = updateCarrier()
    const { ctx } = await bench({ carrier })
    const face = injectedFace(ctx)

    face.check()
    expect(carrier.check).toHaveBeenCalledOnce()
    await vi.waitFor(() => {
      expect(face.hooks.update.getSnapshot().status).toEqual({ phase: 'ready', version: '1.2.0' })
    })
  })

  it('installs on the reader`s restart answer and dismisses on Later', async () => {
    const carrier = updateCarrier()
    const commands: ((command: string) => void)[] = []
    const { ctx } = await bench({ carrier, commands })
    const face = injectedFace(ctx)

    commands[0]?.('show-update')
    expect(face.hooks.update.getSnapshot().open).toBe(true)
    face.close()
    expect(face.hooks.update.getSnapshot().open).toBe(false)
    face.install()
    expect(carrier.install).toHaveBeenCalledOnce()
  })

  it('keeps the popup usable when the shell fails to answer', async () => {
    const carrier = updateCarrier()
    carrier.get.mockRejectedValueOnce(new Error('no preload answer'))
    carrier.check.mockRejectedValueOnce(new Error('no preload answer'))
    const commands: ((command: string) => void)[] = []
    const { ctx } = await bench({ carrier, commands })
    const face = injectedFace(ctx)

    commands[0]?.('show-update')
    expect(face.hooks.update.getSnapshot().open).toBe(true)
    await vi.waitFor(() => { expect(carrier.get).toHaveBeenCalledOnce() })
    face.check()
    await vi.waitFor(() => { expect(carrier.check).toHaveBeenCalledOnce() })
    // A failed read leaves the popup on the state it already showed.
    expect(face.hooks.update.getSnapshot().status.phase).toBe('idle')
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

describe('ui-update node half', () => {
  it('contributes no host behavior', () => {
    // The node half exists only so the plugin appears in the Loader tree.
    expect(applyNode).not.toThrow()
  })
})
