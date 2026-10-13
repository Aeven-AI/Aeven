/**
 * @vitest-environment happy-dom
 *
 * What the copy button says while it copies: the label follows the clipboard's
 * answer and returns to idle on its own, one copy at a time.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CopyButton } from '../src/client/components/CopyButton.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (document as unknown as Record<string, unknown>)['execCommand']
})

/** A copy that the browser accepts, so the button's own behaviour is what is measured. */
function acceptCopies(): void {
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => undefined) } })
}

/** A copy the browser refuses, with no `execCommand` fallback available either. */
function refuseCopies(): void {
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: vi.fn(async () => {
        throw new Error('clipboard denied')
      }),
    },
  })
}

/** Let the click's promise chain settle without letting the 2s reset elapse. */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

function renderButton(props: Partial<ComponentProps<typeof CopyButton>> = {}) {
  return render(
    <CopyButton text="ABCD-1234" idleLabel="Copy code" copiedLabel="Copied" failedLabel="Copy failed" {...props} />,
  )
}

describe('copy button', () => {
  it('confirms the copy and returns to idle by itself', async () => {
    vi.useFakeTimers()
    acceptCopies()
    renderButton()
    const button = screen.getByRole('button')

    expect(button.textContent).toBe('Copy code')
    fireEvent.click(button)
    await settle()
    expect(button.textContent).toBe('Copied')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(button.textContent).toBe('Copy code')
  })

  it('reports a refused copy rather than claiming success', async () => {
    vi.useFakeTimers()
    refuseCopies()
    renderButton()
    const button = screen.getByRole('button')

    fireEvent.click(button)
    await settle()
    expect(button.textContent).toBe('Copy failed')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(button.textContent).toBe('Copy code')
  })

  it('restarts its reset window when a second copy starts', async () => {
    vi.useFakeTimers()
    acceptCopies()
    renderButton()
    const button = screen.getByRole('button')

    fireEvent.click(button)
    await settle()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    fireEvent.click(button)
    await settle()
    // The first click's reset must not cut the second one short.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_999)
    })
    expect(button.textContent).toBe('Copied')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(button.textContent).toBe('Copy code')
  })

  it('drops its pending reset when it unmounts', async () => {
    vi.useFakeTimers()
    acceptCopies()
    const { unmount } = renderButton()

    fireEvent.click(screen.getByRole('button'))
    await settle()
    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('copies from its primary form too', async () => {
    vi.useFakeTimers()
    acceptCopies()
    renderButton({ primary: true, idleLabel: 'Copy redirect' })
    const button = screen.getByRole('button')

    fireEvent.click(button)
    await settle()
    expect(button.textContent).toBe('Copied')
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('offers nothing to copy while the caller says it is busy', () => {
    renderButton({ disabled: true })
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true)
  })

  it('offers nothing to copy when it was given no text', () => {
    renderButton({ text: '' })
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true)
  })
})
