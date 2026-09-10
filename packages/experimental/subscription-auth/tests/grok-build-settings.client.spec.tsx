/**
 * @vitest-environment happy-dom
 *
 * The Settings section finishes a pending Claude sign-in with a pasted
 * redirect URL: the card's field reaches the Host's code route, and the
 * section follows the Host's answer.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOGIN_CODE_PATH, STATUS_PATH } from '../src/client/constants.ts'
import { GrokBuildSettings } from '../src/client/GrokBuildSettings.tsx'
import { en, type GrokBuildSettingsKey } from '../src/client/locales.ts'
import type { CodingOAuthStatus, SubscriptionStatus } from '../src/client/types.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
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

function subscription(provider: 'codex' | 'claude', state: Record<string, unknown>): SubscriptionStatus {
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
  } as SubscriptionStatus
}

function status(claude: Record<string, unknown>): CodingOAuthStatus {
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

/**
 * Serve the plugin routes this section calls: the status route answers from
 * `current`, and the code route answers with `codeResponse`.
 */
function stubHost(codeResponse: { status: number; body: unknown }, afterCode: CodingOAuthStatus) {
  let current = SIGNING_IN
  const codeRequests: unknown[] = []
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === STATUS_PATH) return Response.json(current)
    if (path === LOGIN_CODE_PATH && init?.method === 'POST') {
      codeRequests.push(JSON.parse(String(init.body)))
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
})
