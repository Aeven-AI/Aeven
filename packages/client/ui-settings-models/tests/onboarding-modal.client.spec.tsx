// @vitest-environment jsdom
/**
 * Shared onboarding chrome: the inert application root and the step-owned
 * title focus. Both are the modal's own behavior — a step renders only its
 * body — so each is asserted here rather than through one of the steps.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { OnboardingModal } from '../src/client/OnboardingModal.tsx'

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

describe('OnboardingModal', () => {
  it('renders without an application root to lock', () => {
    // The shell mounts before the product root exists in some hosts; a step
    // must still be readable rather than throwing on its own chrome.
    expect(document.getElementById('root')).toBeNull()
    render(<OnboardingModal title="Step">body</OnboardingModal>)

    expect(screen.getByRole('dialog', { name: 'Step' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Step' })).toBeTruthy()
    expect(screen.getByText('body')).toBeTruthy()
  })

  it('leaves a root it inerts itself interactive again on unmount', () => {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)

    const view = render(<OnboardingModal title="Step">body</OnboardingModal>)
    expect(appRoot.inert).toBe(true)

    view.unmount()
    // Nothing else made the root inert, so leaving the flag set would make the
    // whole product unclickable after the modal closed.
    expect(appRoot.inert).not.toBe(true)
  })

  it('focuses the title only for a step that declares no form control', () => {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)

    const passive = render(<OnboardingModal title="Passive" focusTitle>body</OnboardingModal>)
    const heading = screen.getByRole('heading', { level: 2, name: 'Passive' })
    expect(document.activeElement).toBe(heading)
    // A focusable heading is reachable only where the step asked for it; the
    // tabIndex is what makes that focus land at all.
    expect(heading.getAttribute('tabindex')).toBe('-1')
    passive.unmount()

    render(<OnboardingModal title="Formed">body</OnboardingModal>)
    const formed = screen.getByRole('heading', { level: 2, name: 'Formed' })
    expect(formed.getAttribute('tabindex')).toBeNull()
    expect(document.activeElement).not.toBe(formed)
  })
})
