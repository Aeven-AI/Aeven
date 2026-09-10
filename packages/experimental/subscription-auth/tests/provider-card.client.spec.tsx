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
import type { ProviderStatus } from '../src/client/types.ts'

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

const BASE = {
  provider: 'codex',
  route: 'codex-oauth',
  displayName: 'OpenAI Codex',
  loginMethods: ['device', 'browser'],
  recommendedLoginMethod: 'browser',
  models: [],
  available: [],
  selected: [],
} as const

const SIGNED_IN: ProviderStatus = { ...BASE, status: 'signed-in', accounts: [], activeAccountId: 'a1' }

function Card({ providerStatus }: { providerStatus: ProviderStatus }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <ProviderCard
      t={t}
      definition={CODEX}
      providerStatus={providerStatus}
      busy={false}
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
