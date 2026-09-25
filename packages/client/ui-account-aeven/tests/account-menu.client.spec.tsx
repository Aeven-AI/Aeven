// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountMenu, type AccountMenuProps } from '../src/client/AccountMenu.tsx'

function props(overrides: Partial<AccountMenuProps> = {}): AccountMenuProps {
  return {
    reader: () => ({ userId: 'u-1', displayName: 'Ollie' }),
    accountUrl: () => 'https://aeven.test/account/',
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

  it('links the reader and Account at the configured account page', () => {
    render(<AccountMenu {...props()} />)
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    const links = [...document.querySelectorAll('a')].map(a => a.getAttribute('href'))
    expect(links).toEqual([
      'https://aeven.test/account/',
      'https://aeven.test/account/',
    ])
  })

  it('offers no account rows when the deployment names no web client', () => {
    render(<AccountMenu {...props({ accountUrl: () => undefined })} />)
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    expect(document.querySelectorAll('a')).toHaveLength(0)
    expect(screen.getByText('Ollie')).toBeDefined()
    expect(screen.getByText('settings')).toBeDefined()
    expect(screen.getByText('logout')).toBeDefined()
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
