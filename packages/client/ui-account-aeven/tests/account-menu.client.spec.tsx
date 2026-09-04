// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountMenu, type AccountMenuProps } from '../src/client/AccountMenu.tsx'

const CLEARANCE = '--dsh-header-overlay-clearance'

function props(overrides: Partial<AccountMenuProps> = {}): AccountMenuProps {
  return {
    reader: () => ({ userId: 'u-1', displayName: 'Ollie' }),
    accountUrl: () => 'https://aeven.test/account/',
    nightMode: () => false,
    setNightMode: () => {},
    signOut: () => {},
    t: (key: string) => key,
    ...overrides,
  } as AccountMenuProps
}

afterEach(() => {
  cleanup()
  document.documentElement.style.removeProperty(CLEARANCE)
})

describe('Aeven account menu', () => {
  it('renders nothing when nobody is signed in', () => {
    const { container } = render(<AccountMenu {...props({ reader: () => undefined })} />)
    expect(container.firstChild).toBeNull()
    expect(document.documentElement.style.getPropertyValue(CLEARANCE)).toBe('')
  })

  it('reserves header room while it is mounted and gives it back', () => {
    const { unmount } = render(<AccountMenu {...props()} />)
    expect(document.documentElement.style.getPropertyValue(CLEARANCE)).toBe('42px')
    unmount()
    expect(document.documentElement.style.getPropertyValue(CLEARANCE)).toBe('')
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

  it('links the reader, Account, and Settings at the configured account page', () => {
    render(<AccountMenu {...props()} />)
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    const links = [...document.querySelectorAll('a')].map(a => a.getAttribute('href'))
    expect(links).toEqual([
      'https://aeven.test/account/',
      'https://aeven.test/account/',
      'https://aeven.test/account/',
    ])
  })

  it('offers no account rows when the deployment names no web client', () => {
    render(<AccountMenu {...props({ accountUrl: () => undefined })} />)
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    expect(document.querySelectorAll('a')).toHaveLength(0)
    expect(screen.getByText('Ollie')).toBeDefined()
    expect(screen.getByText('logout')).toBeDefined()
  })

  it('signs out from its own row', () => {
    const signOut = vi.fn()
    render(<AccountMenu {...props({ signOut })} />)
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    fireEvent.click(screen.getByText('logout'))
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('switches the app theme from the night-mode row and reports its state', () => {
    const setNightMode = vi.fn()
    render(<AccountMenu {...props({ setNightMode })} />)
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    const toggle = screen.getByText('nightMode').closest('button')
    expect(toggle?.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle as HTMLElement)
    expect(setNightMode).toHaveBeenCalledWith(true)
    expect(toggle?.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle as HTMLElement)
    expect(setNightMode).toHaveBeenLastCalledWith(false)
  })

  it('opens already checked for a reader whose app is dark', () => {
    render(<AccountMenu {...props({ nightMode: () => true })} />)
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    expect(screen.getByText('nightMode').closest('button')?.className).toContain('checked')
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
