/**
 * @vitest-environment happy-dom
 *
 * A signed-in provider card discloses its usage from the card header, the way
 * a Plugins card discloses its settings, rather than from a footer button.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProviderCard } from '../src/client/components/ProviderCard.tsx'
import { PROVIDERS } from '../src/client/constants.ts'
import { en, type GrokBuildSettingsKey } from '../src/client/locales.ts'
import type { ProviderCardDefinition, ProviderStatus, SubscriptionStatus } from '../src/client/types.ts'

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

const CODEX = PROVIDERS.find(definition => definition.slug === 'codex')!
const CLAUDE = PROVIDERS.find(definition => definition.slug === 'claude')!
const GROK = PROVIDERS.find(definition => definition.slug === 'grok')!

/** Status fields every Codex state carries, whatever its sign-in state. */
const BASE: Pick<
  SubscriptionStatus,
  'provider' | 'route' | 'displayName' | 'loginMethods' | 'recommendedLoginMethod' | 'models' | 'available' | 'selected'
> = {
  provider: 'codex',
  route: 'codex-oauth',
  displayName: 'OpenAI Codex',
  loginMethods: ['device', 'browser'],
  recommendedLoginMethod: 'browser',
  models: [],
  available: [],
  selected: [],
}

const SIGNED_IN: ProviderStatus = { ...BASE, status: 'signed-in', accounts: [], activeAccountId: 'a1' }
const SIGNED_OUT: ProviderStatus = { ...BASE, status: 'signed-out' }

/** Grok's signed-in state, which is the only one that carries a catalogue to fail. */
function grokSignedIn(catalogError?: string): ProviderStatus {
  return {
    status: 'signed-in',
    models: [],
    available: [],
    selected: [],
    catalogSource: 'fallback',
    ...(catalogError === undefined ? {} : { catalogError }),
    grokImportAvailable: true,
    accounts: [],
    activeAccountId: 'a1',
  }
}

function Card({
  providerStatus,
  definition = CODEX,
  busy = false,
  popupBlocked = false,
  onSignIn = vi.fn(),
  onSignOut = vi.fn(),
  onCancelLogin = vi.fn(),
  onSubmitRedirect = vi.fn(),
}: {
  providerStatus: ProviderStatus
  definition?: ProviderCardDefinition
  busy?: boolean
  popupBlocked?: boolean
  onSignIn?: (method: 'pkce' | 'device' | 'browser') => void
  onSignOut?: () => void
  onCancelLogin?: () => void
  onSubmitRedirect?: (value: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <ProviderCard
      t={t}
      definition={definition}
      providerStatus={providerStatus}
      busy={busy}
      remote={false}
      popupBlocked={popupBlocked}
      expanded={expanded}
      usage={undefined}
      usageError={undefined}
      usageLoading={false}
      onRefreshUsage={vi.fn()}
      onSignIn={onSignIn}
      onSignOut={onSignOut}
      onCancelLogin={onCancelLogin}
      onToggleExpanded={() => {
        setExpanded(open => !open)
      }}
      onSubmitRedirect={onSubmitRedirect}
    />
  )
}

describe('ProviderCard usage disclosure', () => {
  it('opens and closes usage from the card header', () => {
    render(<Card providerStatus={SIGNED_IN} />)
    const header = screen.getByRole('button', { name: `${en.expandUsage}: ${en.codexTitle}` })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(header.hasAttribute('aria-controls')).toBe(false)
    expect(screen.queryByText(en.usageTitle)).toBeNull()

    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(header.getAttribute('aria-label')).toBe(`${en.collapseUsage}: ${en.codexTitle}`)
    const panel = document.getElementById(header.getAttribute('aria-controls') ?? '')
    expect(panel?.textContent).toContain(en.usageTitle)

    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(en.usageTitle)).toBeNull()
  })

  it('keeps only Sign out in the footer of a signed-in card', () => {
    render(<Card providerStatus={SIGNED_IN} />)
    const buttons = screen.getAllByRole('button').map(button => button.textContent)
    expect(buttons).toEqual([en.codexTitle, en.logout])
  })

  it('offers no disclosure while signed out', () => {
    render(<Card providerStatus={{ ...BASE, status: 'signed-out' }} />)
    expect(screen.getByRole('heading', { name: en.codexTitle })).toBeTruthy()
    expect(screen.queryByRole('button', { expanded: false })).toBeNull()
  })
})

describe('ProviderCard pasted redirect', () => {
  const CLAUDE_SIGNING_IN: ProviderStatus = {
    ...BASE,
    provider: 'claude',
    route: 'claude-code-oauth',
    displayName: 'Claude Code',
    loginMethods: ['browser'],
    status: 'signing-in',
    method: 'browser',
  }

  it('finishes a pending Claude sign-in with the pasted redirect URL', () => {
    const onSubmitRedirect = vi.fn()
    render(<Card definition={CLAUDE} providerStatus={CLAUDE_SIGNING_IN} onSubmitRedirect={onSubmitRedirect} />)
    const field = screen.getByRole('textbox', { name: en.pasteRedirectLabel })
    const submit = screen.getByRole('button', { name: en.submitRedirect })
    expect(field.getAttribute('aria-describedby')).toBe('coding-oauth-redirect-claude-hint')
    expect(submit.hasAttribute('disabled')).toBe(true)

    fireEvent.change(field, { target: { value: '  ' } })
    expect(submit.hasAttribute('disabled')).toBe(true)

    fireEvent.change(field, { target: { value: '  http://localhost:53692/callback?code=abc&state=xyz \n' } })
    fireEvent.click(submit)
    expect(onSubmitRedirect).toHaveBeenCalledOnce()
    expect(onSubmitRedirect).toHaveBeenCalledWith('http://localhost:53692/callback?code=abc&state=xyz')
  })

  it('does not submit while the card is busy', () => {
    const onSubmitRedirect = vi.fn()
    render(<Card definition={CLAUDE} providerStatus={CLAUDE_SIGNING_IN} busy onSubmitRedirect={onSubmitRedirect} />)
    const field = screen.getByRole('textbox', { name: en.pasteRedirectLabel })
    expect(field.hasAttribute('disabled')).toBe(true)
    fireEvent.submit(field.closest('form')!)
    expect(onSubmitRedirect).not.toHaveBeenCalled()
  })

  it('is absent for providers with a device flow and outside a pending sign-in', () => {
    render(<Card providerStatus={{ ...BASE, status: 'signing-in', method: 'browser' }} />)
    expect(screen.queryByRole('textbox', { name: en.pasteRedirectLabel })).toBeNull()
    cleanup()
    render(<Card definition={CLAUDE} providerStatus={{ ...CLAUDE_SIGNING_IN, status: 'signed-out' }} />)
    expect(screen.queryByRole('textbox', { name: en.pasteRedirectLabel })).toBeNull()
  })
})

describe('ProviderCard device sign-in steps', () => {
  const DEVICE_READY: ProviderStatus = {
    ...BASE,
    status: 'signing-in',
    method: 'device',
    userCode: 'ABCD-1234',
    url: 'https://auth.example.com/device',
  }

  it('opens the provider page and states the code to enter there', () => {
    render(<Card providerStatus={DEVICE_READY} />)

    expect(screen.getByText(en.signInStepOpen)).toBeTruthy()
    expect(screen.getByText(en.signInStepCode)).toBeTruthy()
    const link = screen.getByRole('link', { name: en.openAuthUrl })
    expect(link.getAttribute('href')).toBe('https://auth.example.com/device')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(screen.getByText('ABCD-1234')).toBeTruthy()
    expect(screen.getByRole('button', { name: en.copy })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.copyUserCode })).toBeTruthy()
  })

  it('keeps to the opening step while the provider has given no page or code', () => {
    render(<Card providerStatus={{ ...BASE, status: 'signing-in', method: 'device' }} />)

    expect(screen.getByText(en.signInStepOpen)).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText(en.signInStepCode)).toBeNull()
    expect(screen.queryByRole('button', { name: en.copyUserCode })).toBeNull()
  })

  it('reads an empty page and code as nothing to show', () => {
    render(<Card providerStatus={{ ...BASE, status: 'signing-in', method: 'device', userCode: '', url: '' }} />)

    expect(screen.getByText(en.signInStepOpen)).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText(en.signInStepCode)).toBeNull()
  })

  it('still shows the steps for a browser flow whose tab the browser blocked', () => {
    render(
      <Card
        providerStatus={{
          ...BASE,
          status: 'signing-in',
          method: 'browser',
          url: 'https://auth.example.com/browser',
        }}
        popupBlocked
      />,
    )

    // The link is the only way left to reach the provider page.
    expect(screen.getByRole('link', { name: en.openAuthUrl }).getAttribute('href')).toBe(
      'https://auth.example.com/browser',
    )
  })
})

describe('ProviderCard failure state', () => {
  const FAILED: ProviderStatus = { ...BASE, status: 'error', message: 'codex-oauth: the token endpoint refused' }

  it('states why the sign-in failed and offers it again', () => {
    render(<Card providerStatus={FAILED} />)

    expect(screen.getByRole('status').textContent).toBe(en.requestFailed)
    expect(screen.getByText('codex-oauth: the token endpoint refused')).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.codexTitle })).toBeTruthy()
    expect(document.getElementById('coding-oauth-login-codex')).toBeTruthy()
  })
})

describe('ProviderCard sign-in buttons', () => {
  it('leads with the browser flow locally and offers the device code beside it', () => {
    const onSignIn = vi.fn()
    render(<Card providerStatus={SIGNED_OUT} onSignIn={onSignIn} />)

    const primary = document.getElementById('coding-oauth-login-codex')!
    expect(primary.textContent).toBe(en.signIn)
    fireEvent.click(primary)
    expect(onSignIn).toHaveBeenLastCalledWith('browser')

    fireEvent.click(screen.getByRole('button', { name: en.codeLogin }))
    expect(onSignIn).toHaveBeenLastCalledWith('device')
  })

  it('states the wait instead of the label while a sign-in is in flight', () => {
    render(<Card providerStatus={SIGNED_OUT} busy />)

    const primary = document.getElementById('coding-oauth-login-codex')!
    expect(primary.textContent).toBe(en.working)
    expect(primary.hasAttribute('disabled')).toBe(true)
  })

  it("leads with the card's own recommendation when it lists no methods", () => {
    const onSignIn = vi.fn()
    render(
      <Card
        definition={{ ...CODEX, methods: [], recommended: 'device' }}
        providerStatus={SIGNED_OUT}
        onSignIn={onSignIn}
      />,
    )

    const primary = document.getElementById('coding-oauth-login-codex')!
    expect(primary.textContent).toBe(en.codeLogin)
    fireEvent.click(primary)
    expect(onSignIn).toHaveBeenCalledWith('device')
  })

  it('offers the device code and a way out beside a browser sign-in in flight', () => {
    const onSignIn = vi.fn()
    const onCancelLogin = vi.fn()
    render(
      <Card
        providerStatus={{ ...BASE, status: 'signing-in', method: 'browser' }}
        onSignIn={onSignIn}
        onCancelLogin={onCancelLogin}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: en.codeLogin }))
    expect(onSignIn).toHaveBeenCalledWith('device')

    fireEvent.click(screen.getByRole('button', { name: en.cancelLogin }))
    expect(onCancelLogin).toHaveBeenCalledOnce()
  })
})

describe('ProviderCard sign-out confirmation', () => {
  it('asks before signing out and puts the question in front of the reader', () => {
    render(<Card providerStatus={SIGNED_IN} />)

    fireEvent.click(screen.getByRole('button', { name: en.logout }))

    expect(screen.getByText(en.logoutConfirmHint)).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: en.logoutConfirmAction }))
  })

  it('signs out only after the confirmation is taken', () => {
    const onSignOut = vi.fn()
    render(<Card providerStatus={SIGNED_IN} onSignOut={onSignOut} />)

    fireEvent.click(screen.getByRole('button', { name: en.logout }))
    expect(onSignOut).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: en.logoutConfirmAction }))
    expect(onSignOut).toHaveBeenCalledOnce()
  })

  it('stops asking when the reader backs out, and returns them to the trigger', () => {
    render(<Card providerStatus={SIGNED_IN} />)

    fireEvent.click(screen.getByRole('button', { name: en.logout }))
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))

    expect(screen.queryByText(en.logoutConfirmHint)).toBeNull()
    // The trigger is a fresh element once the question is withdrawn; what matters
    // is that focus landed back on it rather than being dropped.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: en.logout }))
  })

  it('hands focus to the sign-in button when the provider signed out elsewhere', () => {
    const { rerender } = render(<Card providerStatus={SIGNED_IN} />)

    fireEvent.click(screen.getByRole('button', { name: en.logout }))
    fireEvent.click(screen.getByRole('button', { name: en.logoutConfirmAction }))
    // The Host now reports the provider as signed out, so the trigger this focus
    // was headed for no longer exists.
    rerender(<Card providerStatus={SIGNED_OUT} />)

    const login = document.getElementById('coding-oauth-login-codex')
    expect(login).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.logout })).toBeNull()
    expect(document.activeElement).toBe(login)
  })

  it('states the wait instead of the confirmation while a sign-out is in flight', () => {
    const { rerender } = render(<Card providerStatus={SIGNED_IN} />)
    fireEvent.click(screen.getByRole('button', { name: en.logout }))

    rerender(<Card providerStatus={SIGNED_IN} busy />)

    expect(screen.getByRole('button', { name: en.working }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: en.cancel }).hasAttribute('disabled')).toBe(true)
  })
})

describe('ProviderCard Grok catalogue failure', () => {
  it('warns inside the usage panel when the catalogue could not be read', () => {
    render(<Card definition={GROK} providerStatus={grokSignedIn('models: unreachable')} />)

    fireEvent.click(screen.getByRole('button', { name: `${en.expandUsage}: ${en.grokTitle}` }))

    expect(screen.getByText(en.catalogError)).toBeTruthy()
  })

  it('stays quiet for a Grok card whose catalogue is healthy', () => {
    render(<Card definition={GROK} providerStatus={grokSignedIn()} />)

    fireEvent.click(screen.getByRole('button', { name: `${en.expandUsage}: ${en.grokTitle}` }))

    expect(screen.getByText(en.usageTitle)).toBeTruthy()
    expect(screen.queryByText(en.catalogError)).toBeNull()
  })

  it('stays quiet for a provider that has no catalogue in play', () => {
    render(<Card providerStatus={SIGNED_IN} />)

    fireEvent.click(screen.getByRole('button', { name: `${en.expandUsage}: ${en.codexTitle}` }))

    expect(screen.getByText(en.usageTitle)).toBeTruthy()
    expect(screen.queryByText(en.catalogError)).toBeNull()
  })
})
