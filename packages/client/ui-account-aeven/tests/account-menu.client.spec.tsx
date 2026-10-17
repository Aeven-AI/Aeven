// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountMenu, type AccountMenuProps } from '../src/client/AccountMenu.tsx'

function props(overrides: Partial<AccountMenuProps> = {}): AccountMenuProps {
  return {
    reader: () => ({ userId: 'u-1', displayName: 'Ollie' }),
    openSettings: () => {},
    accountType: () => Promise.resolve(undefined),
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

  it('offers the reader above Settings and Log out, and nothing else', () => {
    render(<AccountMenu {...props()} />)
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    const rows = screen.getAllByRole('menuitem').map(row => row.textContent)
    // The profile row carries the avatar's initial as well as the name.
    expect(rows).toEqual([expect.stringContaining('Ollie'), 'settings', 'logout'])
    expect(document.querySelectorAll('a')).toHaveLength(0)
  })

  it('names the plan the account is on, once it has read it', async () => {
    const translate = (key: string, params?: Record<string, string>): string =>
      key === 'plan.status' ? `${params?.plan ?? ''} plan` : key === 'plan.free' ? 'Free' : key
    render(<AccountMenu {...props({
      accountType: () => Promise.resolve({ plan: 'free' }),
      t: translate as AccountMenuProps['t'],
    })} />)
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    expect(await screen.findByText('Free plan')).toBeDefined()
  })

  it('names a paid plan by the name the account route states', async () => {
    const translate = (key: string, params?: Record<string, string>): string =>
      key === 'plan.status' ? `${params?.plan ?? ''} plan` : key
    render(<AccountMenu {...props({
      accountType: () => Promise.resolve({ plan: 'pro', name: 'Pro' }),
      t: translate as AccountMenuProps['t'],
    })} />)
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    expect(await screen.findByText('Pro plan')).toBeDefined()
  })

  it('names a reader who has only an account email, drawing the initial from it', () => {
    render(<AccountMenu {...props({ reader: () => ({ userId: 'u-6', email: 'ollie@example.test' }) })} />)
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    // The trigger and the panel both draw the avatar, so both carry the initial.
    expect(screen.getAllByText('O')).toHaveLength(2)
  })

  it('names a reader who has only a display name', () => {
    render(<AccountMenu {...props({ reader: () => ({ userId: 'u-7', displayName: 'Ollie' }) })} />)
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    expect(screen.getByText('Ollie')).toBeDefined()
  })

  it('names a paid plan by its id when the route stated no name', async () => {
    const translate = (key: string, params?: Record<string, string>): string =>
      key === 'plan.status' ? `${params?.plan ?? ''} plan` : key
    render(<AccountMenu {...props({
      accountType: () => Promise.resolve({ plan: 'pro' }),
      t: translate as AccountMenuProps['t'],
    })} />)
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    expect(await screen.findByText('pro plan')).toBeDefined()
  })

  it('draws no plan line when the account type cannot be read', async () => {
    const translate = (key: string, params?: Record<string, string>): string =>
      key === 'plan.status' ? `${params?.plan ?? ''} plan` : key
    render(<AccountMenu {...props({
      accountType: () => Promise.resolve(undefined),
      t: translate as AccountMenuProps['t'],
    })} />)
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    await screen.findByText('Ollie')
    expect(screen.queryByText(/ plan$/u)).toBeNull()
  })

  it('reads the plan with the page, so an open names it at once', async () => {
    const translate = (key: string, params?: Record<string, string>): string =>
      key === 'plan.status' ? `${params?.plan ?? ''} plan` : key === 'plan.free' ? 'Free' : key
    const accountType = vi.fn(() => Promise.resolve({ plan: 'free' }))
    render(<AccountMenu {...props({ accountType, t: translate as AccountMenuProps['t'] })} />)
    // Asked while the panel is still closed: the open below needs no request.
    await waitFor(() => { expect(accountType).toHaveBeenCalledOnce() })
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    expect(screen.getByText('Free plan')).toBeDefined()
    expect(accountType).toHaveBeenCalledOnce()
  })

  it('asks again on an open that still has no plan', async () => {
    const translate = (key: string, params?: Record<string, string>): string =>
      key === 'plan.status' ? `${params?.plan ?? ''} plan` : key
    const accountType = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ plan: 'pro', name: 'Pro' }) as AccountMenuProps['accountType']
    render(<AccountMenu {...props({ accountType, t: translate as AccountMenuProps['t'] })} />)
    await waitFor(() => { expect(accountType).toHaveBeenCalledOnce() })
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    expect(await screen.findByText('Pro plan')).toBeDefined()
  })

  it('leads to the account page from the picture and the name', () => {
    const openSettings = vi.fn()
    render(<AccountMenu {...props({ openSettings })} />)
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    fireEvent.click(screen.getByText('Ollie'))
    expect(openSettings).toHaveBeenCalledWith('account')
    expect(screen.queryByText('Ollie')).toBeNull()
  })

  it('leads to the account page from the picture too', () => {
    const openSettings = vi.fn()
    render(<AccountMenu {...props({
      reader: () => ({ userId: 'u-1', displayName: 'Ollie', imageUrl: 'https://media.test/u.png' }),
      openSettings,
    })} />)
    fireEvent.click(screen.getByLabelText('trigger.aria'))
    const rows = screen.getAllByRole('menuitem')
    fireEvent.click(within(rows[0] as HTMLElement).getByAltText('avatar.alt'))
    expect(openSettings).toHaveBeenCalledWith('account')
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
