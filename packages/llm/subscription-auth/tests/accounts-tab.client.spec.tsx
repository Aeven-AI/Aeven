/**
 * @vitest-environment happy-dom
 *
 * The Accounts tab wires every card to the provider that card belongs to: each
 * interaction must name its own slug, not whichever card happened to be first.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountsTab } from '../src/client/components/AccountsTab.tsx'
import { en, type GrokBuildSettingsKey } from '../src/client/locales.ts'
import type {
  CodingOAuthStatus,
  ProviderSlug,
  SubscriptionStatus,
  UsageSlotView,
} from '../src/client/types.ts'

afterEach(cleanup)

/** The real English dictionary, so a missing key fails the test rather than passing silently. */
function t(key: GrokBuildSettingsKey, params?: Record<string, unknown>): string {
  const template = en[key]
  if (params === undefined) return template
  return Object.entries(params).reduce<string>(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  )
}

function subscription(
  provider: 'codex' | 'claude',
  state: { status: 'signed-out' } | { status: 'signing-in'; method: 'browser' | 'device' } | { status: 'signed-in' },
): SubscriptionStatus {
  return {
    provider,
    route: provider === 'codex' ? 'codex-oauth' : 'claude-code-oauth',
    displayName: provider,
    loginMethods: provider === 'codex' ? ['device', 'browser'] : ['browser'],
    recommendedLoginMethod: 'browser',
    models: [],
    available: [],
    selected: [],
    ...(state.status === 'signed-in' ? { status: 'signed-in' as const, accounts: [], activeAccountId: 'a1' } : state),
  }
}

function status(
  codex: SubscriptionStatus = subscription('codex', { status: 'signed-out' }),
  claude: SubscriptionStatus = subscription('claude', { status: 'signed-out' }),
): CodingOAuthStatus {
  return {
    accessMode: 'loopback',
    uiOwner: 'standalone',
    compatibility: { coreAbi: 'test', avnVersion: null, status: 'healthy', diagnostics: [] },
    providers: {
      grok: { status: 'signed-out', grokImportAvailable: false },
      codex,
      claude,
    },
  }
}

interface TabOptions {
  status?: CodingOAuthStatus | undefined
  remote?: boolean
  remoteTipDismissed?: boolean
  expandedProviders?: Partial<Record<ProviderSlug, boolean>>
  usageBySlug?: Partial<Record<ProviderSlug, UsageSlotView>>
  handlers?: Partial<{
    onRefreshUsage: (slug: ProviderSlug) => void
    onSignIn: (slug: ProviderSlug, method: 'pkce' | 'device' | 'browser') => void
    onSignOut: (slug: ProviderSlug) => void
    onCancelLogin: (slug: ProviderSlug) => void
    onToggleExpanded: (slug: ProviderSlug) => void
    onSubmitRedirect: (slug: ProviderSlug, value: string) => void
    onDismissRemoteTip: () => void
  }>
}

/** Every handler is asserted through a spy, so a missing one fails loudly. */
function renderTab(options: TabOptions = {}) {
  const handlers = {
    onRefreshUsage: vi.fn(),
    onSignIn: vi.fn(),
    onSignOut: vi.fn(),
    onCancelLogin: vi.fn(),
    onToggleExpanded: vi.fn(),
    onSubmitRedirect: vi.fn(),
    onDismissRemoteTip: vi.fn(),
    ...options.handlers,
  }
  const view = render(
    <AccountsTab
      t={t}
      status={'status' in options ? options.status : status()}
      remote={options.remote === true}
      remoteTipDismissed={options.remoteTipDismissed === true}
      busyProvider={undefined}
      popupBlocked={{}}
      expandedProviders={options.expandedProviders ?? {}}
      usageBySlug={options.usageBySlug ?? {}}
      {...handlers}
    />,
  )
  return { handlers, ...view }
}

/** The card's own connection target, which is what separates one slug from another. */
function loginButton(slug: ProviderSlug): HTMLElement {
  const button = document.getElementById(`coding-oauth-login-${slug}`)
  if (button === null) throw new Error(`no sign-in button for ${slug}`)
  return button
}

describe('accounts tab loading', () => {
  it('says it is still loading until the status route answers', () => {
    renderTab({ status: undefined })

    expect(screen.getByRole('status').textContent).toBe(en.loadingAccount)
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true')
    expect(document.getElementById('coding-oauth-login-codex')).toBeNull()
  })
})

describe('accounts tab remote tip', () => {
  it('warns about a remote page until the reader dismisses it', () => {
    const { handlers } = renderTab({ remote: true })

    expect(screen.getByRole('status').textContent).toContain(en.remoteAccountsTip)
    fireEvent.click(screen.getByRole('button', { name: en.remoteTipDismiss }))
    expect(handlers.onDismissRemoteTip).toHaveBeenCalledOnce()
  })

  it('stays silent on a local page and once the tip was dismissed', () => {
    renderTab({ remote: false })
    expect(screen.queryByText(en.remoteAccountsTip)).toBeNull()
    cleanup()

    renderTab({ remote: true, remoteTipDismissed: true })
    expect(screen.queryByText(en.remoteAccountsTip)).toBeNull()
  })
})

describe('accounts tab card wiring', () => {
  it('starts the sign-in of the card that was clicked, by that card’s method', () => {
    const { handlers } = renderTab()

    fireEvent.click(loginButton('codex'))
    expect(handlers.onSignIn).toHaveBeenLastCalledWith('codex', 'browser')

    // The alternative method belongs to the same card, not to the first one.
    fireEvent.click(screen.getAllByRole('button', { name: en.codeLogin })[0]!)
    expect(handlers.onSignIn).toHaveBeenLastCalledWith('codex', 'device')

    fireEvent.click(loginButton('claude'))
    expect(handlers.onSignIn).toHaveBeenLastCalledWith('claude', 'browser')
  })

  it('cancels the pending sign-in of the provider whose card asked', () => {
    const { handlers } = renderTab({
      status: status(subscription('codex', { status: 'signing-in', method: 'device' })),
    })

    fireEvent.click(screen.getByRole('button', { name: en.cancelLogin }))
    expect(handlers.onCancelLogin).toHaveBeenCalledWith('codex')
  })

  it('signs out the provider whose card asked, once confirmed there', () => {
    const { handlers } = renderTab({ status: status(subscription('codex', { status: 'signed-in' })) })

    fireEvent.click(screen.getByRole('button', { name: en.logout }))
    expect(handlers.onSignOut).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.logoutConfirmAction }))
    expect(handlers.onSignOut).toHaveBeenCalledWith('codex')
  })

  it('finishes a pasted redirect for the provider that showed the field', () => {
    const { handlers } = renderTab({
      status: status(undefined, subscription('claude', { status: 'signing-in', method: 'browser' })),
    })

    const field = screen.getByRole('textbox', { name: en.pasteRedirectLabel })
    fireEvent.change(field, { target: { value: '  http://localhost:1/cb?code=abc  ' } })
    fireEvent.click(screen.getByRole('button', { name: en.submitRedirect }))

    expect(handlers.onSubmitRedirect).toHaveBeenCalledWith('claude', 'http://localhost:1/cb?code=abc')
  })

  it('expands the usage of the card that was clicked and refreshes that same card', () => {
    const { handlers } = renderTab({
      status: status(subscription('codex', { status: 'signed-in' })),
      expandedProviders: { codex: true },
      usageBySlug: { codex: { loading: false, usage: { entitlement: 'entitled', windows: [] } } },
    })

    fireEvent.click(screen.getByRole('button', { name: en.usageRefresh }))
    expect(handlers.onRefreshUsage).toHaveBeenCalledWith('codex')

    fireEvent.click(
      screen.getByRole('button', { name: `${en.collapseUsage}: ${en.codexTitle}` }),
    )
    expect(handlers.onToggleExpanded).toHaveBeenCalledWith('codex')
  })
})
