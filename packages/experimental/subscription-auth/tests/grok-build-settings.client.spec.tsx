/**
 * @vitest-environment happy-dom
 *
 * The Settings section finishes a pending Claude sign-in with a pasted
 * redirect URL: the card's field reaches the Host's code route, and the
 * section follows the Host's answer.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LOGIN_CANCEL_PATH,
  LOGIN_CODE_PATH,
  LOGIN_PATH,
  LOGOUT_PATH,
  POLL_INTERVAL_MS,
  STATUS_PATH,
  SUBSCRIPTION_USAGE_PATH_PREFIX,
} from '../src/client/constants.ts'
import { GrokBuildSettings } from '../src/client/GrokBuildSettings.tsx'
import { en, type GrokBuildSettingsKey } from '../src/client/locales.ts'
import type { AccountSummary, CodingOAuthStatus, SubscriptionStatus } from '../src/client/types.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
})

/** The real English dictionary, so a missing key fails the test rather than passing silently. */
function t(key: GrokBuildSettingsKey, params?: Record<string, unknown>): string {
  const template = en[key]
  if (params === undefined) return template
  return Object.entries(params).reduce<string>(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  )
}

/** The sign-in states these tests put a subscription card in. */
type SubscriptionState =
  | { status: 'signed-out' }
  | { status: 'signing-in'; method: 'browser' }
  | { status: 'signed-in'; accounts: AccountSummary[]; activeAccountId: string }

function subscription(provider: 'codex' | 'claude', state: SubscriptionState): SubscriptionStatus {
  return {
    provider,
    route: provider === 'codex' ? 'codex-oauth' : 'claude-code-oauth',
    displayName: provider,
    loginMethods: provider === 'codex' ? ['device', 'browser'] : ['browser'],
    recommendedLoginMethod: 'browser',
    models: [],
    available: [],
    selected: [],
    ...state,
  }
}

function status(claude: SubscriptionState): CodingOAuthStatus {
  return {
    accessMode: 'ssh-tunnel',
    uiOwner: 'standalone',
    compatibility: { coreAbi: 'test', dshVersion: null, status: 'healthy', diagnostics: [] },
    providers: {
      grok: { status: 'signed-out', grokImportAvailable: false },
      codex: subscription('codex', { status: 'signed-out' }),
      claude: subscription('claude', claude),
    },
  }
}

const SIGNING_IN = status({ status: 'signing-in', method: 'browser' })
const SIGNED_IN = status({ status: 'signed-in', accounts: [], activeAccountId: 'a1' })
const REDIRECT = 'http://localhost:53692/callback?code=abc&state=xyz'

const CODEX_SIGNED_IN = subscription('codex', { status: 'signed-in', accounts: [], activeAccountId: 'a1' })
const CLAUDE_SIGNED_OUT = subscription('claude', { status: 'signed-out' })

/** A whole site status, so a test states only the provider it changes. */
function site(
  providers: Partial<CodingOAuthStatus['providers']> = {},
  overrides: Partial<CodingOAuthStatus> = {},
): CodingOAuthStatus {
  return {
    accessMode: 'loopback',
    uiOwner: 'standalone',
    compatibility: { coreAbi: 'test', dshVersion: null, status: 'healthy', diagnostics: [] },
    providers: {
      grok: { status: 'signed-out', grokImportAvailable: false },
      codex: subscription('codex', { status: 'signed-out' }),
      claude: CLAUDE_SIGNED_OUT,
      ...providers,
    },
    ...overrides,
  }
}

interface Answer {
  status?: number
  body?: unknown
  /** Reject with an Error, the way a failed request normally does. */
  reject?: Error
  /** Reject with something that is deliberately not an Error. */
  rejectUnknown?: unknown
  /** Never answer at all, so whatever is on screen stays there. */
  hang?: true
}

interface RouteTable {
  status: () => Answer
  login?: () => Answer
  code?: () => Answer
  cancel?: () => Answer
  logout?: () => Answer
  usage?: (path: string) => Answer
}

interface RequestRecord {
  path: string
  method: string
  body: unknown
}

/** Serve every route the section calls, so a test states only what it cares about. */
function stubRoutes(routes: RouteTable): RequestRecord[] {
  const requests: RequestRecord[] = []
  const respond = (answer: Answer): Response | Promise<Response> => {
    if (answer.reject !== undefined) throw answer.reject
    if (answer.rejectUnknown !== undefined) throw answer.rejectUnknown
    if (answer.hang === true) return new Promise<Response>(() => undefined)
    return Response.json(answer.body ?? {}, { status: answer.status ?? 200 })
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const base = path.split('?')[0] ?? path
      requests.push({
        path,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      })
      if (base === STATUS_PATH) return respond(routes.status())
      if (base === LOGIN_PATH) {
        return respond(routes.login?.() ?? { body: { method: 'browser', url: 'https://example.com/auth' } })
      }
      if (base === LOGIN_CODE_PATH) return respond(routes.code?.() ?? { body: { ok: true } })
      if (base === LOGIN_CANCEL_PATH) return respond(routes.cancel?.() ?? { body: site() })
      if (base === LOGOUT_PATH) return respond(routes.logout?.() ?? { body: site() })
      if (base.startsWith(SUBSCRIPTION_USAGE_PATH_PREFIX)) {
        return respond(routes.usage?.(base) ?? { body: { entitlement: 'unknown' } })
      }
      return Response.json({ error: `unexpected ${path}` }, { status: 404 })
    }),
  )
  return requests
}

/** The provider page a browser sign-in opens, which this page later closes. */
interface FakeTab {
  opener: unknown
  location: { replace: (url: string) => void }
  close: () => void
}

function fakeTab() {
  const replace = vi.fn()
  const close = vi.fn()
  const tab: FakeTab = { opener: {}, location: { replace }, close }
  // `window.open` lives on the happy-dom window, not on the stubbed global.
  const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
  return { tab, open, replace, close }
}

/** The card's connection target, so a test names the provider it means. */
function loginButton(provider: 'codex' | 'claude' | 'grok'): HTMLElement {
  const button = document.getElementById(`coding-oauth-login-${provider}`)
  if (button === null) throw new Error(`no sign-in button for ${provider}`)
  return button
}

/**
 * The cards exist only once the status read has answered, and the heading
 * renders before it does. Every test that needs a card waits for the card
 * rather than querying the moment the heading appears.
 */
async function findLoginButton(provider: 'codex' | 'claude' | 'grok'): Promise<HTMLElement> {
  await waitFor(() => {
    expect(document.getElementById(`coding-oauth-login-${provider}`)).not.toBeNull()
  })
  return loginButton(provider)
}

/** Let pending work drain while the fake clock stands still, until `ready` holds. */
async function settleUntil(ready: () => boolean): Promise<void> {
  for (let step = 0; step < 20 && !ready(); step += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }
  if (!ready()) throw new Error('the page never reached the state this test needs')
}

function usageRequests(requests: RequestRecord[], slug: string): RequestRecord[] {
  return requests.filter(request => request.path.startsWith(`${SUBSCRIPTION_USAGE_PATH_PREFIX}${slug}`))
}

/**
 * Serve the plugin routes this section calls: the status route answers from
 * `current`, and the code route answers with `codeResponse`.
 */
function stubHost(codeResponse: { status: number; body: unknown }, afterCode: CodingOAuthStatus) {
  let current = SIGNING_IN
  const codeRequests: unknown[] = []
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === STATUS_PATH) return Response.json(current)
    if (path === LOGIN_CODE_PATH && init?.method === 'POST' && typeof init.body === 'string') {
      codeRequests.push(JSON.parse(init.body) as unknown)
      if (codeResponse.status === 200) current = afterCode
      return Response.json(codeResponse.body, { status: codeResponse.status })
    }
    return Response.json({ error: `unexpected ${path}` }, { status: 404 })
  })
  vi.stubGlobal('fetch', fetch)
  return { codeRequests }
}

async function pasteAndSubmit(value: string): Promise<HTMLInputElement> {
  const field = (await screen.findByRole('textbox', { name: en.pasteRedirectLabel })) as HTMLInputElement
  fireEvent.change(field, { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: en.submitRedirect }))
  return field
}

describe('GrokBuildSettings pasted redirect', () => {
  it('sends the pasted redirect to the Host code route and follows the sign-in it completes', async () => {
    const host = stubHost({ status: 200, body: { ok: true } }, SIGNED_IN)
    render(<GrokBuildSettings t={t} />)

    await pasteAndSubmit(REDIRECT)

    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: en.pasteRedirectLabel })).toBeNull()
    })
    expect(host.codeRequests).toEqual([{ provider: 'claude', code: REDIRECT }])
    expect(screen.getByRole('button', { name: `${en.expandUsage}: ${en.claudeTitle}` })).toBeTruthy()
  })

  it('reports a refused code and keeps the pasted value for correction', async () => {
    const refusal = 'claude-code-oauth: no authorization-code login is waiting for a code'
    const host = stubHost({ status: 409, body: { error: refusal } }, SIGNED_IN)
    render(<GrokBuildSettings t={t} />)

    const field = await pasteAndSubmit(REDIRECT)

    expect(await screen.findByText(refusal)).toBeTruthy()
    expect(host.codeRequests).toEqual([{ provider: 'claude', code: REDIRECT }])
    expect(field.value).toBe(REDIRECT)
    expect(field.hasAttribute('disabled')).toBe(false)
  })

  it('falls back to its own wording when the code route failed for an unknown reason', async () => {
    stubRoutes({
      status: () => ({ body: SIGNING_IN }),
      code: () => ({ rejectUnknown: 'offline' }),
    })
    render(<GrokBuildSettings t={t} />)

    await pasteAndSubmit(REDIRECT)

    expect((await screen.findByRole('alert')).textContent).toContain(en.requestFailed)
  })
})

describe('GrokBuildSettings wiring', () => {
  it('refuses to render without the translator its shell injects', () => {
    // A missing `t` is a wiring error, not a state the page can display.
    expect(() => render(<GrokBuildSettings />)).toThrow(
      'Coding OAuth settings requires its translation function',
    )
  })

  it('reads the status route on mount and offers every account card it answers with', async () => {
    const requests = stubRoutes({ status: () => ({ body: site() }) })
    render(<GrokBuildSettings t={t} />)

    expect(await screen.findByRole('heading', { name: en.title })).toBeTruthy()
    // Every card appears once the status read answers, not before.
    expect(await findLoginButton('codex')).toBeTruthy()
    expect(await findLoginButton('claude')).toBeTruthy()
    expect(await findLoginButton('grok')).toBeTruthy()
    expect(requests.filter(request => request.path === STATUS_PATH)).toHaveLength(1)
  })

  it('reports a status route it could not reach and lets the reader try again', async () => {
    let reads = 0
    const requests = stubRoutes({
      status: () => {
        reads += 1
        return reads === 1 ? { reject: new Error('the status route is unreachable') } : { body: site() }
      },
    })
    render(<GrokBuildSettings t={t} />)

    expect(await screen.findByText('the status route is unreachable')).toBeTruthy()
    // With no status there are no accounts to show, only the way to ask again.
    expect(screen.queryByText(en.loadingAccount)).toBeNull()
    expect(document.getElementById('coding-oauth-login-codex')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.retry }))

    await waitFor(() => {
      expect(loginButton('codex')).toBeTruthy()
    })
    expect(requests.filter(request => request.path === STATUS_PATH)).toHaveLength(2)
  })

  it('falls back to its own wording when the status route failed for an unknown reason', async () => {
    stubRoutes({ status: () => ({ rejectUnknown: 'offline' }) })
    render(<GrokBuildSettings t={t} />)

    expect(await screen.findByText(en.requestFailed)).toBeTruthy()
  })

  it('hands the reader to the usage centre when another plugin owns the page', async () => {
    const opened: Event[] = []
    const listener = (event: Event): void => {
      opened.push(event)
    }
    window.addEventListener('usage-stats:open-dashboard', listener)
    try {
      stubRoutes({ status: () => ({ body: site({ codex: CODEX_SIGNED_IN }, { uiOwner: 'hub' }) }) })
      render(<GrokBuildSettings t={t} />)

      const open = await screen.findByRole('button', { name: en.coinstallOpenHub })
      expect(screen.getByRole('heading', { name: en.coinstallTitle })).toBeTruthy()
      expect(screen.getByText(t('coinstallSummary', { count: 1 }))).toBeTruthy()
      // The hub owner means no account cards of our own.
      expect(document.getElementById('coding-oauth-login-codex')).toBeNull()

      fireEvent.click(open)
      expect(opened).toHaveLength(1)
    } finally {
      window.removeEventListener('usage-stats:open-dashboard', listener)
    }
  })

  it('remembers a dismissed remote tip for the rest of the session', async () => {
    stubRoutes({ status: () => ({ body: SIGNING_IN }) })
    render(<GrokBuildSettings t={t} />)

    fireEvent.click(await screen.findByRole('button', { name: en.remoteTipDismiss }))

    expect(window.sessionStorage.getItem('dsh-coding-oauth-remote-tip-dismissed')).toBe('1')
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: en.remoteTipDismiss })).toBeNull()
    })
  })

  it('treats an unreadable session store as an undismissed tip', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem() {
        throw new Error('storage is disabled')
      },
      setItem() {},
    })
    stubRoutes({ status: () => ({ body: SIGNING_IN }) })
    render(<GrokBuildSettings t={t} />)

    expect(await screen.findByRole('button', { name: en.remoteTipDismiss })).toBeTruthy()
  })

  it('keeps a tip the session already dismissed out of the page', async () => {
    window.sessionStorage.setItem('dsh-coding-oauth-remote-tip-dismissed', '1')
    stubRoutes({ status: () => ({ body: SIGNING_IN }) })
    render(<GrokBuildSettings t={t} />)

    // Wait until the status has actually arrived, or the tip would be absent
    // merely because nothing has rendered yet.
    await findLoginButton('codex')
    expect(screen.queryByText(en.remoteAccountsTip)).toBeNull()
  })
})

describe('GrokBuildSettings usage', () => {
  it('reads usage for each signed-in provider and re-reads it on demand', async () => {
    const requests = stubRoutes({
      status: () => ({ body: site({ codex: CODEX_SIGNED_IN }) }),
      usage: () => ({ body: { entitlement: 'entitled', windows: [{ id: 'w', label: 'weekly', remainingPercent: 42 }] } }),
    })
    render(<GrokBuildSettings t={t} />)

    // Usage follows sign-in alone, without anything being opened first.
    expect(await screen.findByRole('button', { name: `${en.expandUsage}: ${en.codexTitle}` })).toBeTruthy()
    await waitFor(() => {
      expect(usageRequests(requests, 'codex')).toHaveLength(1)
    })
    fireEvent.click(screen.getByRole('button', { name: `${en.expandUsage}: ${en.codexTitle}` }))
    expect(await screen.findByText('42%')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.usageRefresh }))

    await waitFor(() => {
      expect(requests.some(request => request.path.endsWith('?refresh=1'))).toBe(true)
    })
    expect(usageRequests(requests, 'codex')).toHaveLength(2)
  })

  it("shows a provider's failed usage read beside that provider's own card", async () => {
    stubRoutes({
      status: () => ({ body: site({ codex: CODEX_SIGNED_IN, claude: subscription('claude', { status: 'signed-in', accounts: [], activeAccountId: 'a1' }) }) }),
      usage: path =>
        path.includes('claude')
          ? { reject: new Error('claude usage is unreachable') }
          : { body: { entitlement: 'entitled', windows: [] } },
    })
    render(<GrokBuildSettings t={t} />)

    fireEvent.click(await screen.findByRole('button', { name: `${en.expandUsage}: ${en.claudeTitle}` }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('claude usage is unreachable')
  })

  it('falls back to its own wording when a usage read failed for an unknown reason', async () => {
    stubRoutes({
      status: () => ({ body: site({ codex: CODEX_SIGNED_IN }) }),
      usage: () => ({ rejectUnknown: 'offline' }),
    })
    render(<GrokBuildSettings t={t} />)

    fireEvent.click(await screen.findByRole('button', { name: `${en.expandUsage}: ${en.codexTitle}` }))

    expect((await screen.findByRole('alert')).textContent).toBe(en.usageUnavailable)
  })

  it('forgets the usage of a provider that is no longer signed in', async () => {
    let current = site({ codex: CODEX_SIGNED_IN })
    stubRoutes({
      status: () => ({ body: current }),
      usage: () => ({ body: { entitlement: 'entitled', windows: [{ id: 'w', label: 'weekly', remainingPercent: 42 }] } }),
      logout: () => ({ body: site() }),
    })
    render(<GrokBuildSettings t={t} />)

    fireEvent.click(await screen.findByRole('button', { name: `${en.expandUsage}: ${en.codexTitle}` }))
    expect(await screen.findByText('42%')).toBeTruthy()

    // The Host now reports this provider as signed out.
    current = site()
    fireEvent.click(screen.getByRole('button', { name: en.logout }))
    fireEvent.click(screen.getByRole('button', { name: en.logoutConfirmAction }))

    await waitFor(() => {
      expect(document.getElementById('coding-oauth-login-codex')).toBeTruthy()
    })
    expect(screen.queryByText('42%')).toBeNull()
  })
})

describe('GrokBuildSettings sign-in', () => {
  it('opens the provider page inside the click and closes it once the sign-in lands', async () => {
    vi.useFakeTimers()
    const { tab, open, replace, close } = fakeTab()
    let reads = 0
    stubRoutes({
      status: () => {
        reads += 1
        // Mount: nothing pending. The read right after the click: still pending.
        return { body: reads === 1 ? site() : reads === 2 ? SIGNING_IN : SIGNED_IN }
      },
      login: () => ({ body: { method: 'browser', url: 'https://claude.ai/oauth' } }),
    })
    render(<GrokBuildSettings t={t} />)
    await settleUntil(() => document.getElementById('coding-oauth-login-claude') !== null)

    fireEvent.click(loginButton('claude'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(open).toHaveBeenCalledWith('about:blank', '_blank')
    expect(tab.opener).toBeNull()
    expect(replace).toHaveBeenCalledWith('https://claude.ai/oauth')
    // Still pending: the page it opened stays where the sign-in needs it.
    expect(close).not.toHaveBeenCalled()

    // The poll finds the sign-in landed, so the page is no longer needed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    })

    expect(reads).toBeGreaterThan(2)
    expect(close).toHaveBeenCalledOnce()
  })

  it('starts a device sign-in without opening any page', async () => {
    const { open } = fakeTab()
    const requests = stubRoutes({
      status: () => ({ body: site() }),
      login: () => ({ body: { method: 'device', url: 'https://example.com/device', userCode: 'ABCD-1234' } }),
    })
    render(<GrokBuildSettings t={t} />)

    // Wait for the cards themselves: the heading renders before the status read.
    await findLoginButton('codex')
    fireEvent.click(screen.getAllByRole('button', { name: en.codeLogin })[0]!)

    await waitFor(() => {
      expect(requests.some(request => request.path === LOGIN_PATH)).toBe(true)
    })
    expect(open).not.toHaveBeenCalled()
    expect(requests.find(request => request.path === LOGIN_PATH)).toMatchObject({
      method: 'POST',
      body: { provider: 'codex', method: 'device' },
    })
  })

  it('closes the page it opened when the sign-in could not start', async () => {
    const { close } = fakeTab()
    let reads = 0
    stubRoutes({
      // The read that follows the failure never answers, so the refusal it would
      // otherwise clear stays on screen and can be asserted.
      status: () => {
        reads += 1
        return reads === 1 ? { body: site() } : { hang: true }
      },
      login: () => ({ status: 500, body: { error: 'claude-code-oauth: the provider refused' } }),
    })
    render(<GrokBuildSettings t={t} />)

    fireEvent.click(await findLoginButton('claude'))

    expect((await screen.findByRole('alert')).textContent).toContain('claude-code-oauth: the provider refused')
    expect(close).toHaveBeenCalledOnce()
  })

  it('closes the page it opened when the sign-in failed for an unknown reason', async () => {
    const { close } = fakeTab()
    let reads = 0
    stubRoutes({
      status: () => {
        reads += 1
        return reads === 1 ? { body: site() } : { hang: true }
      },
      login: () => ({ rejectUnknown: 'offline' }),
    })
    render(<GrokBuildSettings t={t} />)

    fireEvent.click(await findLoginButton('claude'))

    expect((await screen.findByRole('alert')).textContent).toContain(en.requestFailed)
    expect(close).toHaveBeenCalledOnce()
  })

  it('cancels the pending sign-in of the provider whose card asked', async () => {
    const requests = stubRoutes({
      status: () => ({ body: SIGNING_IN }),
      cancel: () => ({ body: site() }),
    })
    render(<GrokBuildSettings t={t} />)

    fireEvent.click(await screen.findByRole('button', { name: en.cancelLogin }))

    await waitFor(() => {
      expect(loginButton('claude')).toBeTruthy()
    })
    expect(requests.find(request => request.path === LOGIN_CANCEL_PATH)).toMatchObject({
      method: 'POST',
      body: { provider: 'claude' },
    })
  })

  it('falls back to its own wording when cancelling failed for an unknown reason', async () => {
    stubRoutes({
      status: () => ({ body: SIGNING_IN }),
      cancel: () => ({ rejectUnknown: 'offline' }),
    })
    render(<GrokBuildSettings t={t} />)

    fireEvent.click(await screen.findByRole('button', { name: en.cancelLogin }))

    expect((await screen.findByRole('alert')).textContent).toContain(en.requestFailed)
  })

  it('reports a cancel the Host refused in the Host’s own words', async () => {
    stubRoutes({
      status: () => ({ body: SIGNING_IN }),
      cancel: () => ({ reject: new Error('claude: no sign-in is waiting to be cancelled') }),
    })
    render(<GrokBuildSettings t={t} />)

    fireEvent.click(await screen.findByRole('button', { name: en.cancelLogin }))

    expect((await screen.findByRole('alert')).textContent).toBe('claude: no sign-in is waiting to be cancelled')
  })

  it('leaves the page it opened alone when the sign-in ended without a session', async () => {
    const { close } = fakeTab()
    stubRoutes({
      // Nothing is pending and nothing was signed in, so no session landed.
      status: () => ({ body: site() }),
      login: () => ({ body: { method: 'browser', url: 'https://claude.ai/oauth' } }),
    })
    render(<GrokBuildSettings t={t} />)

    fireEvent.click(await findLoginButton('claude'))

    await waitFor(() => {
      expect(document.getElementById('coding-oauth-login-claude')).toBeTruthy()
    })
    expect(close).not.toHaveBeenCalled()
  })

  it('reports a sign-out the Host refused in the Host’s own words', async () => {
    stubRoutes({
      status: () => ({ body: site({ codex: CODEX_SIGNED_IN }) }),
      logout: () => ({ reject: new Error('codex: the session could not be ended') }),
    })
    render(<GrokBuildSettings t={t} />)

    fireEvent.click(await screen.findByRole('button', { name: en.logout }))
    fireEvent.click(screen.getByRole('button', { name: en.logoutConfirmAction }))

    expect((await screen.findByRole('alert')).textContent).toBe('codex: the session could not be ended')
  })

  it('signs out the provider whose card asked, once confirmed there', async () => {
    const requests = stubRoutes({
      status: () => ({ body: site({ codex: CODEX_SIGNED_IN }) }),
      logout: () => ({ body: site() }),
    })
    render(<GrokBuildSettings t={t} />)

    fireEvent.click(await screen.findByRole('button', { name: en.logout }))
    fireEvent.click(screen.getByRole('button', { name: en.logoutConfirmAction }))

    await waitFor(() => {
      expect(document.getElementById('coding-oauth-login-codex')).toBeTruthy()
    })
    expect(requests.find(request => request.path === LOGOUT_PATH)).toMatchObject({
      method: 'POST',
      body: { provider: 'codex' },
    })
  })

  it('falls back to its own wording when signing out failed for an unknown reason', async () => {
    stubRoutes({
      status: () => ({ body: site({ codex: CODEX_SIGNED_IN }) }),
      logout: () => ({ rejectUnknown: 'offline' }),
    })
    render(<GrokBuildSettings t={t} />)

    fireEvent.click(await screen.findByRole('button', { name: en.logout }))
    fireEvent.click(screen.getByRole('button', { name: en.logoutConfirmAction }))

    expect((await screen.findByRole('alert')).textContent).toContain(en.requestFailed)
  })
})
