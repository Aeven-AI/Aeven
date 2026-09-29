// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Avatar, initialOf } from '../src/client/Avatar.tsx'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Aeven avatar', () => {
  it('takes the initial from the display name first', () => {
    expect(initialOf('ollie', 'bob@mail.test')).toBe('O')
  })

  it('takes the initial from the email address when there is no name', () => {
    expect(initialOf(undefined, 'bob@mail.test')).toBe('B')
    expect(initialOf('  ', 'bob@mail.test')).toBe('B')
  })

  it('draws no letter when there is neither name nor email address', () => {
    expect(initialOf(undefined, undefined)).toBe('')
  })

  it('draws the initial when the reader has no picture', () => {
    const { container } = render(<Avatar name="Ollie" alt="profile" />)
    expect(container.querySelector('.initial')?.textContent).toBe('O')
    expect(container.querySelector('img')).toBeNull()
  })

  it('marks the trigger avatar with a pointer and leaves the panel one bare', () => {
    const { container, rerender } = render(<Avatar name="Ollie" alt="profile" pointer />)
    expect(container.querySelector('.avatar')?.className).toContain('pointer')
    rerender(<Avatar name="Ollie" alt="profile" />)
    expect(container.querySelector('.avatar')?.className).not.toContain('pointer')
  })

  it('draws the picture when there is one', () => {
    render(<Avatar name="Ollie" imageUrl="https://media.test/u-1.png" alt="profile" />)
    expect(screen.getByAltText('profile')).toHaveProperty(
      'src', 'https://media.test/u-1.png',
    )
  })

  it('shows the spinner only for a picture that is slow to arrive', () => {
    const { container } = render(
      <Avatar name="Ollie" imageUrl="https://media.test/u-1.png" alt="profile" />,
    )
    expect(container.querySelector('.image-loader')?.className).not.toContain('loading')
    act(() => { vi.advanceTimersByTime(400) })
    expect(container.querySelector('.image-loader')?.className).toContain('loading')
  })

  it('covers the spinner once the picture has settled', () => {
    const { container } = render(
      <Avatar name="Ollie" imageUrl="https://media.test/u-1.png" alt="profile" />,
    )
    act(() => { screen.getByAltText('profile').dispatchEvent(new Event('load')) })
    expect(container.querySelector('.image-loader')?.className).not.toContain('loading')
    act(() => { vi.advanceTimersByTime(400) })
    expect(container.querySelector('.image-loader')?.className).toContain('preloaded')
  })

  it('falls back to the initial when the picture cannot be fetched', () => {
    const { container } = render(
      <Avatar email="bob@mail.test" imageUrl="https://media.test/gone.png" alt="profile" />,
    )
    act(() => { screen.getByAltText('profile').dispatchEvent(new Event('error')) })
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.initial')?.textContent).toBe('B')
  })

  it('drops its pending timer when it unmounts', () => {
    const { unmount } = render(
      <Avatar name="Ollie" imageUrl="https://media.test/u-1.png" alt="profile" />,
    )
    unmount()
    expect(() => { vi.advanceTimersByTime(1000) }).not.toThrow()
  })
})
