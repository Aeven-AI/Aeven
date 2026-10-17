// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountSection, type AccountSectionProps } from '../src/client/AccountSection.tsx'
import { en } from '../src/client/locales.ts'

const picture = (): File => new File([new Uint8Array([1, 2, 3])], 'me.png', { type: 'image/png' })

/**
 * Render the account page. The plan, credit and usage reads are refused on
 * purpose: this suite is about the picture row, which draws above them.
 */
function show(overrides: Partial<AccountSectionProps> = {}) {
  const props = {
    reader: () => ({ userId: 'reader-1', displayName: 'Ollie', email: 'ollie@example.test' }),
    signOut: vi.fn(),
    setImage: vi.fn(async () => 'https://media.test/user-images/reader-1-new.webp'),
    removeImage: vi.fn(async () => {}),
    mfa: vi.fn(async () => ({ enabled: false })),
    cloud: () => Promise.reject(new Error('unavailable')),
    cached: () => undefined,
    t: (key: keyof typeof en) => en[key],
    ...overrides,
  }
  return { ...render(<AccountSection {...props as unknown as AccountSectionProps} />), props }
}

const picker = (): HTMLInputElement => {
  const input = document.querySelector('input[type="file"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('the picture picker is missing')
  return input
}

/** The icon controls are icon-only, so their accessible name is the only text they carry. */
const iconButton = (name: keyof typeof en): HTMLElement => {
  const button = screen.getByRole('button', { name: en[name] })
  if (button.textContent !== '') throw new Error(`${name} carries text as well as its icon`)
  return button
}

afterEach(cleanup)

describe('the account picture', () => {
  it('offers an upload and no removal while the account has no picture', () => {
    show()
    expect(iconButton('avatar.upload')).toBeDefined()
    expect(screen.queryByRole('button', { name: en['avatar.remove'] })).toBeNull()
    // With no picture there is no image to draw, so the initial is the trigger.
    expect(screen.queryByAltText(en['avatar.alt'])).toBeNull()
    expect(screen.getByRole('button', { name: en['avatar.choose'] })).toBeDefined()
  })

  it('opens the picker from the picture itself', () => {
    const { container } = show({
      reader: () => ({ userId: 'reader-1', displayName: 'Ollie', imageUrl: 'https://media.test/old.webp' }),
    })
    const input = picker()
    const opened = vi.fn()
    input.addEventListener('click', opened)

    fireEvent.click(screen.getByRole('button', { name: en['avatar.choose'] }))

    expect(opened).toHaveBeenCalledOnce()
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(1)
  })

  it('offers a removal while the account has one', () => {
    show({ reader: () => ({ userId: 'reader-1', displayName: 'Ollie', imageUrl: 'https://media.test/old.webp' }) })
    expect(screen.getByAltText(en['avatar.alt'])).toBeDefined()
    expect(iconButton('avatar.remove')).toBeDefined()
  })

  it('stores the picture the reader picks and draws the stored one', async () => {
    const { props } = show()
    fireEvent.change(picker(), { target: { files: [picture()] } })

    await waitFor(() => { expect(screen.getByAltText(en['avatar.alt'])).toBeDefined() })
    expect(props.setImage).toHaveBeenCalledOnce()
    expect((props.setImage as unknown as { mock: { calls: File[][] } }).mock.calls[0]?.[0]).toBeInstanceOf(File)
    // The removal only appears once there is something to remove.
    expect(iconButton('avatar.remove')).toBeDefined()
  })

  it('does nothing when the picker is dismissed with no file', () => {
    const { props } = show()
    fireEvent.change(picker(), { target: { files: [] } })
    expect(props.setImage).not.toHaveBeenCalled()
  })

  it('removes the picture and draws the initial again', async () => {
    const { props } = show({ reader: () => ({ userId: 'reader-1', displayName: 'Ollie', imageUrl: 'https://media.test/old.webp' }) })
    fireEvent.click(iconButton('avatar.remove'))

    await waitFor(() => { expect(screen.queryByAltText(en['avatar.alt'])).toBeNull() })
    expect(props.removeImage).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: en['avatar.remove'] })).toBeNull()
  })

  it('says so when the picture cannot be stored, and keeps the old one', async () => {
    show({
      reader: () => ({ userId: 'reader-1', displayName: 'Ollie', imageUrl: 'https://media.test/old.webp' }),
      setImage: () => Promise.reject(new Error('invalid-image')),
    })
    fireEvent.change(picker(), { target: { files: [picture()] } })

    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByRole('alert').textContent).toBe(en['avatar.failed'])
    expect(screen.getByAltText(en['avatar.alt'])).toBeDefined()
  })

  it('says so when the picture cannot be removed', async () => {
    show({
      reader: () => ({ userId: 'reader-1', displayName: 'Ollie', imageUrl: 'https://media.test/old.webp' }),
      removeImage: () => Promise.reject(new Error('request-failed')),
    })
    fireEvent.click(iconButton('avatar.remove'))

    expect((await screen.findByRole('alert')).textContent).toBe(en['avatar.failed'])
    expect(screen.getByAltText(en['avatar.alt'])).toBeDefined()
  })

  it('shows the work in progress and holds both actions until it settles', async () => {
    let finish: (url: string | undefined) => void = () => {}
    show({
      setImage: () => new Promise<string | undefined>((resolve) => { finish = resolve }),
    })
    fireEvent.change(picker(), { target: { files: [picture()] } })

    const uploading = await screen.findByRole('button', { name: en['avatar.uploading'] })
    expect(uploading.hasAttribute('disabled')).toBe(true)

    finish('https://media.test/user-images/reader-1-new.webp')
    await waitFor(() => { expect(screen.getByRole('button', { name: en['avatar.upload'] })).toBeDefined() })
  })
})
