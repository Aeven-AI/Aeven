// @vitest-environment jsdom
/**
 * The Discord connector page's behavior: one row per installed guild with its
 * icon, name, and installer, a remove action that confirms first, a switch that
 * pauses one guild, and an install action that waits for a new row.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AccountIntegrationsView } from '@aeven/api-remotes/client'
import type { IntegrationsLocaleKey } from '../src/client/locales.ts'
import { DiscordAccounts } from '../src/client/DiscordAccounts.tsx'

afterEach(cleanup)

/** Copy for the keys the page reads, in the shape the locale seat returns. */
const COPY: Partial<Record<IntegrationsLocaleKey, string>> = {
  discordAdd: 'Add server', discordConnected: 'Server added', discordInstall: 'Discord opens in your browser.',
  discordInstalledBy: 'Added by ', discordPrivacy: 'The bot token stays on this computer.',
  discordRemove: 'Remove server', discordRemoveConfirm: 'Remove the Aeven bot from this server?',
  discordRelink: 'The Aeven bot is no longer in this server.', discordWaiting: 'Waiting for Discord…', discordMonogram: 'DC', close: 'Close', cancel: 'Cancel',
}

type Connection = AccountIntegrationsView['connectors'][number]

/** One installed guild row. */
function guild(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'c1' as Connection['id'], provider: 'discord', name: 'Aeven HQ', enabled: true, connected: true,
    discord: {
      applicationId: '1530000000000000000', botUserId: '99', guildId: '42', guildName: 'Aeven HQ',
      icon: 'https://cdn.discordapp.com/icons/42/abc.png?size=64', installedById: '7', installedByName: 'Olivier', linked: true,
    },
    ...overrides,
  }
}

/** Mount the page with stubbed operations. */
function mount(connections: Connection[], startWithInstall = false) {
  const startInstall = vi.fn()
  const disconnect = vi.fn().mockResolvedValue(undefined)
  const setConnectorEnabled = vi.fn().mockResolvedValue(undefined)
  const run = vi.fn((operation: () => Promise<unknown>) => operation().then(() => undefined))
  const toggle = (label: string, on: boolean, disabled: boolean, onChange: () => void) => <button
    type="button" role="switch" aria-label={label} aria-checked={on} disabled={disabled} onClick={onChange}
  />
  const props = {
    t: (key: IntegrationsLocaleKey) => COPY[key] ?? key,
    busy: false, connections, run, toggle, setConnectorEnabled, disconnect,
    refresh: vi.fn(), startInstall, startWithInstall,
  }
  const view = render(<DiscordAccounts {...props} />)
  return {
    startInstall, disconnect, setConnectorEnabled, props, view,
    /** Re-render with another connection list, as a refresh after the install would. */
    update: (next: Connection[]) => { view.rerender(<DiscordAccounts {...props} connections={next} />) },
  }
}

describe('Discord server rows', () => {
  it('shows the guild name, its icon, and who added it', () => {
    const page = mount([guild()])
    expect(screen.getByText('Aeven HQ')).toBeDefined()
    expect(screen.getByText('Added by Olivier')).toBeDefined()
    expect(page.view.container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.discordapp.com/icons/42/abc.png?size=64')
  })

  it('falls back to a monogram for a guild without an icon', () => {
    const { discord, ...rest } = guild()
    const { icon, ...withoutIcon } = discord!
    mount([{ ...rest, discord: withoutIcon }])
    expect(screen.getByText('DC')).toBeDefined()
  })

  it('marks a guild the bot left, and disables its switch', () => {
    mount([guild({ connected: false, discord: { ...guild().discord!, linked: false } })])
    expect(screen.getByText('The Aeven bot is no longer in this server.')).toBeDefined()
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true)
  })

  it('asks before removing the server, and removes it only on confirmation', async () => {
    const page = mount([guild()])
    fireEvent.click(screen.getByRole('button', { name: 'Remove server' }))
    expect(screen.getByText('Remove the Aeven bot from this server?')).toBeDefined()
    expect(page.disconnect).not.toHaveBeenCalled()
    // The confirmation pair renders before the row's own remove button.
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove server' })[0]!)
    await waitFor(() => { expect(page.disconnect).toHaveBeenCalledWith('c1') })
  })

  it('pauses one guild through its switch without touching the others', async () => {
    const page = mount([guild(), guild({ id: 'c2' as Connection['id'], name: 'Second', discord: { ...guild().discord!, guildId: '43', guildName: 'Second' } })])
    fireEvent.click(screen.getByRole('switch', { name: 'Aeven HQ' }))
    await waitFor(() => { expect(page.setConnectorEnabled).toHaveBeenCalledWith('c1', false) })
    expect(page.setConnectorEnabled).toHaveBeenCalledTimes(1)
  })
})

describe('installing another server', () => {
  it('opens Discord and waits until a new row arrives', () => {
    const page = mount([guild()])
    fireEvent.click(screen.getByRole('button', { name: 'Add server' }))
    expect(page.startInstall).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Waiting for Discord…')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Add server' })).toBeNull()
    page.update([guild(), guild({ id: 'c2' as Connection['id'], name: 'Second' })])
    expect(screen.queryByText('Waiting for Discord…')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add server' })).toBeDefined()
  })

  it('closes the waiting card on request', () => {
    const page = mount([guild()])
    fireEvent.click(screen.getByRole('button', { name: 'Add server' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('Waiting for Discord…')).toBeNull()
    expect(page.startInstall).toHaveBeenCalledTimes(1)
  })

  it('starts the installation on first render when the page was opened by the switch', () => {
    const page = mount([guild()], true)
    expect(page.startInstall).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Waiting for Discord…')).toBeDefined()
  })
})
