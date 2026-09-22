/** Right sidebar plugin body: dictionaries, the panel seat and the header toggle seat. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@aeven/client-ui-renderer/client'
import { LocaleRuntime } from '@aeven/client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import type { ToggleButtonInjected } from '../src/client/contract/slots.ts'
import { apply as hostApply } from '../src/index.ts'

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const layout = { toggleRightbar: vi.fn() }
  ctx.provide('layout', layout)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const slots = ctx.get('slots') as SlotRegistry
  if (declare) {
    // The frame declares both the panel's column and the corner the toggle
    // seats in.
    slots.register({
      name: 'root',
      children: {
        'rightbar': { kind: 'single', scope: 'session' },
        'shell.corner': { kind: 'list', scope: 'root' },
      },
    } as never, () => null)
  }
  return { ctx, slots, layout }
}

describe('ui-sidebar-right apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'layout', 'locale'])
  })

  it('registers the shell, its body seat and both dictionaries', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('rightbar')).toHaveLength(1)
    expect(b.slots.spec('sidebar.right.body')).toEqual({ kind: 'single', scope: 'session' })
    // Copy rides the standard locale seat, not the inject face.
    expect(b.slots.entries('rightbar')[0]!.locale).toBe('sidebarRight')
    expect(b.ctx.locale.bind('sidebarRight')('toggle.open')).toBe('Open right sidebar')
    expect(b.ctx.locale.bind('sidebarRight')('toggle.collapse')).toBe('Collapse right sidebar')
  })

  it("seats the toggle in the frame's corner ahead of the account avatar", async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entries = b.slots.entries('shell.corner')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.options.id).toBe('rightbar-toggle')
    expect(entries[0]!.options.order).toBe(90)
    expect(entries[0]!.locale).toBe('sidebarRight')
    // The seat is root-scoped, so its inject face takes no session argument.
    const injected = (entries[0]!.inject as unknown as () => ToggleButtonInjected)()
    injected.toggleRightbar('session-9')
    expect(b.layout.toggleRightbar).toHaveBeenCalledWith('session-9')
  })

  it('fails when no live owner declared the column it occupies', async () => {
    const b = await bench(false)
    await expect(b.ctx.plugin({ inject: [...inject], apply })).rejects.toThrow(/not declared/)
  })

  it('removes both seats, the body declaration and the dictionaries on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('rightbar')).toHaveLength(0)
    expect(b.slots.entries('shell.corner')).toHaveLength(0)
    expect(b.slots.spec('sidebar.right.body')).toBeUndefined()
    expect(b.ctx.locale.bind('sidebarRight')('toggle.open')).toBe('toggle.open')
  })
})
