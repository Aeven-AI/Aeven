// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Avatar, colorsFromId } from '../src/client/Avatar.tsx'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Aeven avatar', () => {
  it('folds one id into three stable hues', () => {
    const first = colorsFromId('u-1')
    expect(colorsFromId('u-1')).toEqual(first)
    expect(colorsFromId('u-2')).not.toEqual(first)
    expect(first).toHaveLength(3)
  })

  it('gives a reader with no id the same colours as every other', () => {
    expect(colorsFromId(null)).toEqual(colorsFromId('aeven'))
  })

  it('draws the gradient when the reader has no picture', () => {
    const { container } = render(<Avatar userId="u-1" alt="profile" />)
    expect(container.querySelector('.gradient')).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('marks the trigger avatar with a pointer and leaves the panel one bare', () => {
    const { container, rerender } = render(<Avatar userId="u-1" alt="profile" pointer />)
    expect(container.querySelector('.avatar')?.className).toContain('pointer')
    rerender(<Avatar userId="u-1" alt="profile" />)
    expect(container.querySelector('.avatar')?.className).not.toContain('pointer')
  })

  it('draws the picture when there is one', () => {
    render(<Avatar userId="u-1" imageUrl="https://media.test/u-1.png" alt="profile" />)
    expect(screen.getByAltText('profile')).toHaveProperty(
      'src', 'https://media.test/u-1.png',
    )
  })

  it('shows the spinner only for a picture that is slow to arrive', () => {
    const { container } = render(
      <Avatar userId="u-1" imageUrl="https://media.test/u-1.png" alt="profile" />,
    )
    expect(container.querySelector('.image-loader')?.className).not.toContain('loading')
    act(() => { vi.advanceTimersByTime(400) })
    expect(container.querySelector('.image-loader')?.className).toContain('loading')
  })

  it('covers the spinner once the picture has settled', () => {
    const { container } = render(
      <Avatar userId="u-1" imageUrl="https://media.test/u-1.png" alt="profile" />,
    )
    act(() => { screen.getByAltText('profile').dispatchEvent(new Event('load')) })
    expect(container.querySelector('.image-loader')?.className).not.toContain('loading')
    act(() => { vi.advanceTimersByTime(400) })
    expect(container.querySelector('.image-loader')?.className).toContain('preloaded')
  })

  it('falls back to the gradient when the picture cannot be fetched', () => {
    const { container } = render(
      <Avatar userId="u-1" imageUrl="https://media.test/gone.png" alt="profile" />,
    )
    act(() => { screen.getByAltText('profile').dispatchEvent(new Event('error')) })
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.gradient')).not.toBeNull()
  })

  it('drops its pending timer when it unmounts', () => {
    const { unmount } = render(
      <Avatar userId="u-1" imageUrl="https://media.test/u-1.png" alt="profile" />,
    )
    unmount()
    expect(() => { vi.advanceTimersByTime(1000) }).not.toThrow()
  })
})
