// @vitest-environment jsdom
/**
 * Host facts reach the browsing region through the assembled renderer, which
 * memoizes a root entry's inject result for the whole registration — so facts
 * read once at first render would freeze there. This spec drives the real slot
 * renderer (not a direct `entry.inject()` call, which bypasses that memo) and
 * pins that the injected hook answers with the Home the Host reports now, once
 * a Home arrives after the region has already rendered.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import type { WorkspaceId } from '@aeven/api-workspace-controller/client'
import type { PropsRenderSlots } from '@aeven/client-ui-slots'
import { SlotTestRuntime, TestRemote, usePinnedBrowserLanguages } from '@aeven/client-test-runtime'
import { LocaleRuntime } from '@aeven/client-locale/client'
import type { WorkspaceBrowserInjected } from '@aeven/client-ui-workspace/client'
import { apply, inject } from '@aeven/client-ui-workspace/client'

usePinnedBrowserLanguages('zh-CN')

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

/** Test-owned sidebar shell role: declares and renders the browsing region. */
type FrameProps = PropsRenderSlots<'sidebar.workspaces'>
function SidebarFrame({ renderSlot }: FrameProps) {
  return <>{renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => {} })}</>
}

/** The assembled sidebar over one Workspace inside the POSIX home the Host reports. */
async function bench() {
  const runtime = await SlotTestRuntime.create()
  runtime.releaseWorkspaceSource()
  const directoryPicker = {}
  const remote = new TestRemote(runtime.ctx)
  Object.assign(remote, { directoryPicker })
  runtime.ctx.provide('remote.directoryPicker', directoryPicker as never)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.workspaces.update((draft) => {
    draft.items = [{
      workspaceId: 'w1' as WorkspaceId, title: 'Project', path: '/home/u/Documents/project',
      sessionIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }] as never
  })
  await runtime.root.declare(
    { 'sidebar.workspaces': { kind: 'single', scope: 'root' } } as never,
    SidebarFrame as never,
  )
  await runtime.mount({ inject: [...inject], apply })
  return { runtime, remote }
}

describe('Host home in the assembled browsing region', () => {
  // Divergence: the row's hover card — the only surface that abbreviated a
  // Workspace path against the Host's home — was removed from the product, so
  // the injected hostInfo source is now the whole observable contract. No
  // HoverCard consumer remains under packages/client/*/src; ui-workspace's
  // README ("Hover cards") and its injected hooks.hostInfo (now without a
  // reader) still describe the removed surface.
  it('answers with a home learned after first render, through the injected hook', async () => {
    // First render precedes the ready frame: the shell mounts while the carrier
    // is still handshaking, so the Host reports no home yet.
    const { runtime, remote } = await bench()
    remote.$host = { home: undefined, isLoopback: true }
    runtime.renderRoot()
    const entry = runtime.slots.entries('sidebar.workspaces')[0]!
    const browser = (entry.inject as () => WorkspaceBrowserInjected)()
    const homes: Array<string | undefined> = []
    const unsubscribe = browser.hooks.hostInfo.subscribe(() => {
      homes.push(browser.hooks.hostInfo.getSnapshot().home)
    })
    expect(browser.hooks.hostInfo.getSnapshot().home).toBeUndefined()

    // The ready frame lands: `$host.home` now answers, and the generation is
    // announced through the reset every consumer already listens to. The face
    // the renderer already holds reports the new value — nothing froze it at
    // the first render.
    remote.$host = { home: '/home/u', isLoopback: true }
    act(() => { runtime.ctx.emit('connection/reset') })
    expect(browser.hooks.hostInfo.getSnapshot().home).toBe('/home/u')
    expect(homes).toEqual(['/home/u'])
    unsubscribe()
  })
})
