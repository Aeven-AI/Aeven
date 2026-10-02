/**
 * @vitest-environment happy-dom
 *
 * The Subscriptions group on the Providers page: one foldout card per
 * subscription, Grok first, whose sign-in actions live in the open card's
 * footer and whose model list writes the selection through the Host route.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOGIN_PATH, MODELS_PATH, STATUS_PATH, SUBSCRIPTION_USAGE_PATH_PREFIX } from '../src/client/constants.ts'
import { GrokBuildSettings } from '../src/client/GrokBuildSettings.tsx'
import { en, type GrokBuildSettingsKey } from '../src/client/locales.ts'
import type { CodingOAuthStatus, ModelView } from '../src/client/types.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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

const CODEX_MODELS: ModelView[] = [
  { id: 'gpt-5.5', name: 'GPT-5.5', imageInput: true, imageOutput: false, selected: true },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 mini', imageInput: false, imageOutput: false, selected: false },
  { id: 'gpt-image-2', name: 'GPT Image 2', imageInput: false, imageOutput: true, selected: true },
]

function site(codexSignedIn: boolean, accessMode: CodingOAuthStatus['accessMode'] = 'loopback'): CodingOAuthStatus {
  const base = {
    provider: 'codex' as const,
    route: 'codex-oauth',
    displayName: 'Codex',
    loginMethods: ['device', 'browser'] as const,
    recommendedLoginMethod: 'browser' as const,
  }
  return {
    accessMode,
    uiOwner: 'standalone',
    compatibility: { coreAbi: 'test', avnVersion: null, status: 'healthy', diagnostics: [] },
    providers: {
      grok: { status: 'signed-out', grokImportAvailable: false },
      codex: codexSignedIn
        ? { ...base, models: CODEX_MODELS, status: 'signed-in', accounts: [], activeAccountId: 'a1' }
        : { ...base, models: [], status: 'signed-out' },
    },
  }
}

interface Call {
  path: string
  method: string
  body: unknown
}

function stubHost(status: CodingOAuthStatus): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined
    calls.push({ path, method: init?.method ?? 'GET', body })
    if (path === STATUS_PATH || path === MODELS_PATH) return Response.json(status)
    if (path.startsWith(SUBSCRIPTION_USAGE_PATH_PREFIX)) return Response.json({ entitlement: 'unknown', windows: [] })
    if (path === LOGIN_PATH) return Response.json({ method: 'device', url: 'https://auth.example/device', userCode: 'ABCD-1234' })
    return Response.json({ error: `unexpected ${path}` }, { status: 404 })
  }))
  return calls
}

function card(title: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`: ${title}$`, 'u') }).closest('li') as HTMLElement
}

describe('Subscriptions provider cards', () => {
  it('lists Grok then Codex as closed cards with no sign-in controls', async () => {
    stubHost(site(false))
    render(<GrokBuildSettings t={t} />)
    await screen.findByRole('button', { name: `${en.expand}: ${en.grokTitle}` })
    const headers = screen.getAllByRole('button', { expanded: false })
    expect(headers.map(header => header.getAttribute('aria-label'))).toEqual([
      `${en.expand}: ${en.grokTitle}`,
      `${en.expand}: ${en.codexTitle}`,
    ])
    expect(screen.queryByRole('button', { name: en.signIn })).toBeNull()
  })

  it('puts Sign in in the open card and uses the device code from another machine', async () => {
    const calls = stubHost(site(false, 'ssh-tunnel'))
    render(<GrokBuildSettings t={t} />)
    fireEvent.click(await screen.findByRole('button', { name: `${en.expand}: ${en.grokTitle}` }))
    const signIn = within(card(en.grokTitle)).getByRole('button', { name: en.signIn })
    expect(screen.queryByText('Sign in with code')).toBeNull()
    await act(async () => { fireEvent.click(signIn) })
    expect(calls.find(call => call.path === LOGIN_PATH)?.body).toEqual({ provider: 'grok', method: 'device' })
  })

  it('lists a signed-in subscription’s models with capability marks and writes the selection', async () => {
    const calls = stubHost(site(true))
    render(<GrokBuildSettings t={t} />)
    fireEvent.click(await screen.findByRole('button', { name: `${en.expand}: ${en.codexTitle}` }))
    const codex = card(en.codexTitle)
    const boxes = within(codex).getAllByRole('checkbox')
    expect(boxes.map(box => (box as HTMLInputElement).checked)).toEqual([true, false, true])
    expect(within(codex).getAllByRole('img', { name: en.capabilityImageInput })).toHaveLength(1)
    expect(within(codex).getAllByRole('img', { name: en.capabilityImageOutput })).toHaveLength(1)
    expect(within(codex).getByRole('button', { name: en.logout })).toBeTruthy()

    await act(async () => { fireEvent.click(within(codex).getByRole('button', { name: en.selectAll })) })
    await waitFor(() => {
      expect(calls.find(call => call.path === MODELS_PATH)?.body).toEqual({
        provider: 'codex',
        selected: ['gpt-5.5', 'gpt-5.4-mini', 'gpt-image-2'],
      })
    })

    await waitFor(() => { expect((boxes[0] as HTMLInputElement).disabled).toBe(false) })
    await act(async () => { fireEvent.click(boxes[0]!) })
    await waitFor(() => {
      expect(calls.filter(call => call.path === MODELS_PATH).at(-1)?.body).toEqual({
        provider: 'codex',
        selected: ['gpt-image-2'],
      })
    })
  })
})
