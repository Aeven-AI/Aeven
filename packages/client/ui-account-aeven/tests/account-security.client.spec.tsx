// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountSection, type AccountSectionProps } from '../src/client/AccountSection.tsx'
import { en } from '../src/client/locales.ts'

function show(mfa: AccountSectionProps['mfa']) {
  return render(<AccountSection {...{
    reader: () => ({ userId: 'security-reader', displayName: 'Reader' }),
    signOut: vi.fn(), mfa,
    cloud: () => Promise.reject(new Error('unavailable')),
    cached: () => undefined,
    t: (key: keyof typeof en) => en[key],
  } as unknown as AccountSectionProps} />)
}

afterEach(cleanup)

describe('Account security', () => {
  it('keeps the switch off through enrollment and shows recovery codes after verification', async () => {
    const mfa = vi.fn<AccountSectionProps['mfa']>().mockImplementation(async (action) => {
      if (action === 'status') return { enabled: false }
      if (action === 'setup') return { secret: 'TESTSETUPKEY', qrCode: 'data:image/png;base64,AA==' }
      return { recoveryCodes: ['1234-5678-90ab-cdef'] }
    })
    show(mfa)
    const toggle = screen.getByRole('switch', { name: 'Two-factor authentication' })
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
    const toggle = screen.getByRole('switch')
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
    const toggle = screen.getByRole('switch')
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
    expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(true)
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }))
    await waitFor(() => { expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(false) })
    expect(screen.getByText('Off')).toBeDefined()
  })
})
