// @vitest-environment jsdom
/**
 * The bubble's keep-away from the viewport edge, through the real chain: the
 * app's `Tooltip` reads the frame's page inset token and the engine hands
 * popper that number. tippy is stubbed so the props it receives are observable
 * without a live popper.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** The stubbed tippy factory, recording every creation and the props it received. */
const tippy = vi.hoisted(() => vi.fn((_reference: Element, _props: Record<string, unknown>) => ({
  destroy: vi.fn(),
  setProps: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
})))

vi.mock('tippy.js', () => ({ default: tippy }))

import { Tooltip } from '@aeven/client-ui-primitives'

/** Let the engine's dynamic tippy import and its `.then` settle inside act(). */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** Mount one tooltip over the token state under test and report what tippy got. */
async function overflowPadding(): Promise<unknown> {
  render(
    <Tooltip label="Rail">
      <button type="button">anchor</button>
    </Tooltip>,
  )
  await settle()
  const props = tippy.mock.calls.at(-1)?.[1] as
    | { popperOptions?: { modifiers?: { options?: { padding?: unknown } }[] } }
    | undefined
  if (props === undefined) throw new Error('the engine never created a tooltip')
  return props.popperOptions?.modifiers?.[0]?.options?.padding
}

afterEach(() => {
  document.body.style.removeProperty('--dsw-aeven-page-inset')
  tippy.mockClear()
  cleanup()
})

describe('Tooltip page inset', () => {
  it('keeps the inset the frame page token holds off the clamped edge', async () => {
    document.body.style.setProperty('--dsw-aeven-page-inset', '24px')
    expect(await overflowPadding()).toBe(24)
  })

  it('leaves tippy its own gutter where no theme is mounted', async () => {
    expect(await overflowPadding()).toBeUndefined()
  })
})
