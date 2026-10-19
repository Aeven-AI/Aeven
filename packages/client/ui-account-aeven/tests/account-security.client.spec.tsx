// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountSection, type AccountSectionProps } from '../src/client/AccountSection.tsx'
import { en } from '../src/client/locales.ts'

/**
 * Render the account page against one protection-status read.
 *
 * The status is cached between visits, exactly as the plugin's own face keeps it, so
 * a test reads it once and the page paints from there.
 * @param mfa - the protection operations.
 * @returns the render handle.
 */
function show(mfa: AccountSectionProps['mfa']) {
  let known: boolean | undefined
  return render(<AccountSection {...{
    reader: () => ({ userId: 'security-reader', displayName: 'Reader' }),
    signOut: vi.fn(), mfa,
    security: {
      cached: () => known,
      read: () => mfa('status').then((answer) => { known = answer.enabled === true; return known }),
      record: (enabled: boolean) => { known = enabled },
    },
    cloud: () => Promise.reject(new Error('unavailable')),
    cached: () => undefined,
    t: (key: keyof typeof en) => en[key],
  } as unknown as AccountSectionProps} />)
}

afterEach(cleanup)

describe('Account security', () => {
  it('keeps the whole page behind one loader until the status has answered', async () => {
    // The status is one of the page's reads, so the loader covers the page: no cell
    // arrives without the protection state, and none of them reports on its own.
    show(vi.fn<AccountSectionProps['mfa']>().mockImplementation(() => new Promise(() => {})))

    expect((await screen.findByRole('status')).textContent).toContain(en['section.loading'])
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByText(en['security.info'])).toBeNull()
  })

  it('paints the switch from the cached status without reading it again', async () => {
    // A return to the page must not spend a round trip before the switch can draw.
    const mfa = vi.fn<AccountSectionProps['mfa']>().mockResolvedValue({ enabled: false })
    show(mfa)
    await screen.findByRole('switch')
    expect(mfa).toHaveBeenCalledWith('status')
    expect(mfa.mock.calls.filter(call => call[0] === 'status')).toHaveLength(1)
  })

  it('keeps the switch off through enrollment and shows recovery codes after verification', async () => {
    const mfa = vi.fn<AccountSectionProps['mfa']>().mockImplementation(async (action) => {
      if (action === 'status') return { enabled: false }
      if (action === 'setup') return { secret: 'TESTSETUPKEY', qrCode: 'data:image/png;base64,AA==' }
      return { recoveryCodes: ['1234-5678-90ab-cdef'] }
    })
    show(mfa)
    // The switch is drawn only once the status has answered; before that the group
    // shows the loader rather than a switch that cannot state anything.
    const toggle = await screen.findByRole('switch', { name: 'Two-factor authentication' })
    await waitFor(() => { expect(toggle.hasAttribute('disabled')).toBe(false) })
    expect(screen.queryByText('Manage account')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Security' }).parentElement).toMatchSnapshot()
    fireEvent.click(toggle)
    await screen.findByAltText(en['mfa.scan'])
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Save your recovery codes')
    expect(mfa).toHaveBeenCalledWith('enable', '123456')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(toggle.hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => { expect(screen.queryByText('Save your recovery codes')).toBeNull() })
    expect(toggle.hasAttribute('disabled')).toBe(false)
    expect(screen.getByText('On')).toBeDefined()
  })

  it('keeps protection on after a refused code and turns it off only after successful verification', async () => {
    const mfa = vi.fn<AccountSectionProps['mfa']>()
      .mockResolvedValueOnce({ enabled: true })
      .mockRejectedValueOnce(new Error('invalid-code'))
      .mockResolvedValueOnce({ enabled: false })
    show(mfa)
    const toggle = await screen.findByRole('switch')
    await waitFor(() => { expect(toggle.hasAttribute('disabled')).toBe(false) })
    fireEvent.click(toggle)
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Turn off two-factor authentication' }))
    await screen.findByRole('alert')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Please check your code and try again.')).toBeDefined()
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Turn off two-factor authentication' }))
    await waitFor(() => { expect(toggle.getAttribute('aria-checked')).toBe('false') })
    expect(mfa).toHaveBeenLastCalledWith('disable', '123456')
    expect(screen.queryByText(en['mfa.disableInfo'])).toBeNull()
    expect(screen.getByText('Off')).toBeDefined()
  })

  it('cancels disabling without changing protection or sending a disable request', async () => {
    const mfa = vi.fn<AccountSectionProps['mfa']>().mockResolvedValue({ enabled: true })
    show(mfa)
    const toggle = await screen.findByRole('switch')
    await waitFor(() => { expect(toggle.hasAttribute('disabled')).toBe(false) })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(mfa).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('Authenticator code')).toBeNull()
  })

  it('shows unavailable status and prevents changing protection when status cannot be read', async () => {
    const mfa = vi.fn<AccountSectionProps['mfa']>().mockRejectedValueOnce(new Error('request-failed'))
      .mockResolvedValueOnce({ enabled: false })
    show(mfa)
    await screen.findByRole('alert')
    expect(screen.getByText('Unavailable')).toBeDefined()
    expect((await screen.findByRole('switch')).hasAttribute('disabled')).toBe(true)
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }))
    await waitFor(() => { expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(false) })
    expect(screen.getByText('Off')).toBeDefined()
  })
})
