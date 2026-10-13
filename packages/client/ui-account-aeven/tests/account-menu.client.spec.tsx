// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountMenu, type AccountMenuProps } from '../src/client/AccountMenu.tsx'

function props(overrides: Partial<AccountMenuProps> = {}): AccountMenuProps {
  return {
    reader: () => ({ userId: 'u-1', displayName: 'Ollie' }),
    openSettings: () => {},
    signOut: () => {},
    t: (key: string) => key,
    ...overrides,
  } as AccountMenuProps
}

afterEach(() => {
  cleanup()
})

describe('Aeven account menu', () => {
  it('renders nothing when nobody is signed in', () => {
    const { container } = render(<AccountMenu {...props({ reader: () => undefined })} />)
    expect(container.firstChild).toBeNull()
  })

  it('opens and closes the menu from the avatar', () => {
    render(<AccountMenu {...props()} />)
    const trigger = screen.getByLabelText('trigger.aria')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Ollie')).toBeDefined()
    fireEvent.click(trigger)
    expect(screen.queryByText('Ollie')).toBeNull()
  })

  it('offers the reader and no row beyond Settings and Log out', () => {
    render(<AccountMenu {...props()} />)
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    const rows = screen.getAllByRole('menuitem').map(row => row.textContent)
    expect(rows).toEqual(['settings', 'logout'])
    expect(screen.getByText('Ollie')).toBeDefined()
    expect(document.querySelectorAll('a')).toHaveLength(0)
  })

  it('signs out from its own row', () => {
    const signOut = vi.fn()
    render(<AccountMenu {...props({ signOut })} />)
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    fireEvent.click(screen.getByText('logout'))
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('closes itself and opens the app settings from its Settings row', () => {
    const openSettings = vi.fn()
    render(<AccountMenu {...props({ openSettings })} />)
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    fireEvent.click(screen.getByText('settings'))
    expect(openSettings).toHaveBeenCalledOnce()
    expect(screen.queryByText('Ollie')).toBeNull()
  })

  it('offers no theme switch', () => {
    render(<AccountMenu {...props()} />)
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull()
  })

  it('closes on Escape and returns focus to the avatar', () => {
    render(<AccountMenu {...props()} />)
    const trigger = screen.getByLabelText('trigger.aria')
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByText('Ollie')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('ignores other keys', () => {
    render(<AccountMenu {...props()} />)
    const trigger = screen.getByLabelText('trigger.aria')
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'a' })
    expect(screen.getByText('Ollie')).toBeDefined()
  })

  it('closes when a pointer lands outside it', () => {
    render(<AccountMenu {...props()} />)
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByText('Ollie')).toBeNull()
  })

  it('draws the reader picture when Aeven has one', () => {
    render(<AccountMenu {...props({
      reader: () => ({ userId: 'u-1', displayName: 'Ollie', imageUrl: 'https://media.test/u.png' }),
    })} />)
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    expect(screen.getAllByAltText('avatar.alt')).toHaveLength(2)
  })
})
