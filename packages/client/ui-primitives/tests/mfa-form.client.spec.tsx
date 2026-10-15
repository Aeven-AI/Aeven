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

describe('authenticator sign-in', () => {
  it('reports a profile failure after verification and completes again without spending another code', async () => {
    const request = vi.fn<MfaFormProps['request']>().mockResolvedValue({})
    const onDone = vi.fn<MfaFormProps['onDone']>().mockRejectedValueOnce(new Error('profile-failed')).mockResolvedValueOnce(undefined)
    render(<MfaForm mode="login" t={t} request={request} onDone={onDone} onCancel={vi.fn()} />)
    submit()
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toBe('mfa.failure')
    expect(screen.getByLabelText('mfa.code').hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'mfa.confirm' }))
    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(2) })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each(['expired-code', 'too-many-attempts'])('offers a restart instead of submitting an unusable challenge after %s', async (error) => {
    const request = vi.fn<MfaFormProps['request']>().mockRejectedValue(new Error(error))
    const onCancel = vi.fn()
    render(<MfaForm mode="login" t={t} request={request} onDone={vi.fn()} onCancel={onCancel} />)
    submit()
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'mfa.confirm' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'mfa.restart' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledOnce()
  })

  it('explains a used authenticator code and permits the next code', async () => {
    const request = vi.fn<MfaFormProps['request']>().mockRejectedValueOnce(new Error('code-already-used')).mockResolvedValueOnce({})
    const onDone = vi.fn()
    render(<MfaForm mode="login" t={t} request={request} onDone={onDone} onCancel={vi.fn()} />)
    submit()
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toBe('mfa.used')
    fireEvent.change(screen.getByLabelText('mfa.code'), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'mfa.confirm' }))
    await waitFor(() => { expect(onDone).toHaveBeenCalledOnce() })
    expect(request).toHaveBeenLastCalledWith('login', '654321')
  })

  it('labels recovery-code entry independently of recovery-code disclosure', () => {
    render(<MfaForm mode="login" t={t} request={vi.fn()} onDone={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'mfa.useRecovery' }))
    expect(screen.getByLabelText('mfa.recoveryCode')).toBeDefined()
  })
})
