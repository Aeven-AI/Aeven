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

function Card({
  providerStatus,
  definition = CODEX,
  busy = false,
  onSubmitRedirect = vi.fn(),
}: {
  providerStatus: ProviderStatus
  definition?: ProviderCardDefinition
  busy?: boolean
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
      popupBlocked={false}
      expanded={expanded}
      usage={undefined}
      usageError={undefined}
      usageLoading={false}
      onRefreshUsage={vi.fn()}
      onSignIn={vi.fn()}
      onSignOut={vi.fn()}
      onCancelLogin={vi.fn()}
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
