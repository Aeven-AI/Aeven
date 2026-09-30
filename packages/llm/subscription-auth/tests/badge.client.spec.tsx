/**
 * @vitest-environment happy-dom
 *
 * The status capsule: which of its two marks appears, and for which input, on
 * every sign-in state a provider card can carry.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Badge } from '../src/client/components/Badge.tsx'

afterEach(cleanup)

/** The capsule's decorative dot; assistive technology must never read it. */
function dots(): number {
  return screen.getByRole('status').querySelectorAll('[aria-hidden="true"]').length
}

describe('status badge', () => {
  it('shows its label with one decorative dot by default', () => {
    render(<Badge label="Signed out" />)

    expect(screen.getByRole('status').textContent).toBe('Signed out')
    expect(dots()).toBe(1)
  })

  it('draws no dot when the caller asked for a bare label', () => {
    render(<Badge label="Signed out" showDot={false} />)

    expect(screen.getByRole('status').textContent).toBe('Signed out')
    expect(dots()).toBe(0)
  })

  it("takes its tone from the provider's status when the caller names none", () => {
    render(<Badge label="Signed in" providerStatus="signed-in" />)

    expect(screen.getByRole('status').textContent).toBe('Signed in')
    expect(dots()).toBe(1)
  })

  it('keeps an uninstalled provider neutral however its status reads', () => {
    render(<Badge label="Signed in" providerStatus="signed-in" installed={false} />)

    expect(screen.getByRole('status').textContent).toBe('Signed in')
    expect(dots()).toBe(1)
  })

  it('lets an explicit tone override the provider status it was given', () => {
    render(<Badge label="Retrying" tone="warning" providerStatus="error" />)

    expect(screen.getByRole('status').textContent).toBe('Retrying')
    expect(dots()).toBe(1)
  })

  it('marks a tone-only capsule without needing a provider status', () => {
    render(<Badge label="Done" tone="success" />)

    expect(screen.getByRole('status').textContent).toBe('Done')
    expect(dots()).toBe(1)
  })

  it('keeps a neutral label when neither a tone nor a status is known', () => {
    render(<Badge label="Unknown" tone="neutral" showDot={false} />)

    expect(screen.getByRole('status').textContent).toBe('Unknown')
    expect(dots()).toBe(0)
  })
})
