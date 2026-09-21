// @vitest-environment jsdom
/**
 * Local DOM snapshots of the sidebar shell through the real assembly path:
 * SlotTestRuntime mounts the package apply on its own fiber, the auto frame
 * supplies the layout's owner share at the render site, and the snapshot
 * captures exactly the 'sidebar' slot's output (CSS-module class names
 * folded to their semantic locals by the runtime's serializer). The child
 * holes (sidebar.workspaces / sidebar.settings) have no registrant here, so
 * the snapshots pin the shell chrome itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import { SlotTestRuntime, usePinnedBrowserLanguages } from '@aeven/client-test-runtime'
import { LocaleRuntime } from '@aeven/client-locale/client'
import { en as commonEn } from '@aeven/client-locale/src/locales/en.ts'
import { zh as commonZh } from '@aeven/client-locale/src/locales/zh.ts'
import { apply, inject } from '@aeven/client-ui-sidebar/client'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

beforeEach(() => {
  vi.stubEnv('AVN_CLIENT_COMMIT_HASH', 'abc1234')
  vi.stubEnv('AVN_CLIENT_GIT_DIRTY', 'true')
  vi.stubEnv('AVN_CLIENT_VERSION', '1.2.3-rc.4')
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

/**
 * Boot the package over the slot test runtime. The default bench stays on
 * the service's default locale (zh — the fallback chain's base), pinning
 * what an untouched client shows; `locale: 'en'` pins the en copy instead.
 * The installed face backs the entry's standard `t` seat either way.
 */
async function bench(options: { locale?: 'en' } = {}) {
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('layout', { toggleSidebar: vi.fn() })
  // Pinned: an href carrying a random uuid would make every snapshot differ.
  runtime.ctx.provide('uiWorkspace', {
    startSession: vi.fn(),
    newSessionHref: () => ({ href: '/c/snapshot-1', sessionId: 'session-snapshot-1' }),
  } as never)
  const locale = new LocaleRuntime(runtime.ctx)
  locale.register('common', { zh: commonZh, en: commonEn })
  if (options.locale === 'en') locale.setLocale('en')
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.declare({ 'sidebar': { kind: 'single', scope: 'root' } })
  await runtime.mount({ inject: [...inject], apply })
  return { runtime, locale }
}

describe('sidebar shell snapshots', () => {
  it('renders the expanded column in the default locale (zh, no setLocale)', async () => {
    const { runtime } = await bench()
    const slot = runtime.renderSlot('sidebar', { collapsed: false, width: 300 })
    // Wordmark + capsule both start a session in the expanded state.
    expect(slot.view.getAllByRole('button', { name: '对话' })).toHaveLength(1)
    expect(slot.view.getAllByRole('link', { name: '对话' })).toHaveLength(1)
    expect(slot.container).toMatchSnapshot()
    await runtime.dispose()
  })

  it('renders the expanded column (wordmark, capsule, empty holes)', async () => {
    const { runtime } = await bench({ locale: 'en' })
    const slot = runtime.renderSlot('sidebar', { collapsed: false, width: 300 })
    // Wordmark + capsule both start a session in the expanded state: the
    // wordmark is still a button, the capsule is now a link to /c/<uuid>.
    expect(slot.view.getAllByRole('button', { name: 'Chat' })).toHaveLength(1)
    expect(slot.view.getAllByRole('link', { name: 'Chat' })).toHaveLength(1)
    expect(slot.container).toMatchSnapshot()
    await runtime.dispose()
  })

  it('keeps the expanded contents mounted behind the closed sidebar, in place', async () => {
    const { runtime } = await bench({ locale: 'en' })
    const slot = runtime.renderSlot('sidebar', { collapsed: false, width: 300 })
    const shell = slot.container.firstElementChild
    slot.update({ collapsed: true, width: 0 })
    expect(slot.view.getAllByRole('button', { name: 'Chat' })).toHaveLength(1)
    expect(slot.view.getAllByRole('link', { name: 'Chat' })).toHaveLength(1)
    expect(slot.container).toMatchSnapshot()
    // Same tree position: the owner flip re-rendered the shell in place.
    expect(slot.container.firstElementChild).toBe(shell)
    await runtime.dispose()
  })

  it('a locale switch refreshes mounted copy without re-registration', async () => {
    const { runtime, locale } = await bench()
    const slot = runtime.renderSlot('sidebar', { collapsed: false, width: 300 })
    expect(slot.view.getAllByRole('button', { name: '对话' })).toHaveLength(1)
    expect(slot.view.getAllByRole('link', { name: '对话' })).toHaveLength(1)
    // Same fiber, same registration: setLocale alone re-renders the outlet.
    act(() => { locale.setLocale('en') })
    expect(slot.view.getAllByRole('button', { name: 'Chat' })).toHaveLength(1)
    expect(slot.view.getAllByRole('link', { name: 'Chat' })).toHaveLength(1)
    expect(slot.view.queryByRole('button', { name: '对话' })).toBeNull()
    await runtime.dispose()
  })
})
