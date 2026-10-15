// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MfaForm, type MfaFormProps } from '../src/MfaForm.tsx'

const t: MfaFormProps['t'] = key => key

afterEach(cleanup)

function submit() {
  fireEvent.change(screen.getByLabelText('mfa.code'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'mfa.confirm' }))
}

describe('authenticator enrollment in settings', () => {
  it('states the setup step instead of naming the feature its host row already names', async () => {
    const request = vi.fn<MfaFormProps['request']>().mockResolvedValue({ secret: 'TESTSETUPKEY', qrCode: 'data:image/png;base64,AA==' })
    render(<MfaForm layout="cells" mode="setup" t={t} request={request} onDone={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByAltText('mfa.scan')
    expect(screen.getByText('mfa.scan')).toBeDefined()
    expect(screen.getByText('TESTSETUPKEY')).toBeDefined()
    expect(screen.queryByText('mfa.title')).toBeNull()
    submit()
    await waitFor(() => { expect(request).toHaveBeenCalledWith('enable', '123456') })
  })

  it('explains a used code and lets the reader answer the same step again', async () => {
    const request = vi.fn<MfaFormProps['request']>()
      .mockResolvedValueOnce({ secret: 'TESTSETUPKEY', qrCode: 'data:image/png;base64,AA==' })
      .mockRejectedValueOnce(new Error('code-already-used'))
      .mockResolvedValueOnce({})
    render(<MfaForm layout="cells" mode="setup" t={t} request={request} onDone={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByAltText('mfa.scan')
    submit()
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toBe('mfa.used')
    submit()
    await waitFor(() => { expect(request).toHaveBeenLastCalledWith('enable', '123456') })
  })

  it('offers a restart rather than a submission the challenge can no longer answer', async () => {
    const request = vi.fn<MfaFormProps['request']>()
      .mockResolvedValueOnce({ secret: 'TESTSETUPKEY', qrCode: 'data:image/png;base64,AA==' })
      .mockRejectedValueOnce(new Error('expired-code'))
    render(<MfaForm layout="cells" mode="setup" t={t} request={request} onDone={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByAltText('mfa.scan')
    submit()
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toBe('mfa.expired')
    expect(screen.getByRole('button', { name: 'mfa.confirm' }).hasAttribute('disabled')).toBe(true)
  })

  it('turns protection off only through the same code step', async () => {
    const request = vi.fn<MfaFormProps['request']>().mockResolvedValue({ enabled: false })
    const onDone = vi.fn()
    render(<MfaForm mode="disable" t={t} request={request} onDone={onDone} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('mfa.code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'mfa.disable' }))
    await waitFor(() => { expect(onDone).toHaveBeenCalledOnce() })
    expect(request).toHaveBeenCalledWith('disable', '123456')
  })

  it('labels recovery-code entry independently of recovery-code disclosure', () => {
    render(<MfaForm mode="disable" t={t} request={vi.fn()} onDone={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'mfa.useRecovery' }))
    expect(screen.getByLabelText('mfa.recoveryCode')).toBeDefined()
  })
})
