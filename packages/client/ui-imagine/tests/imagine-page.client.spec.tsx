// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ImaginePage } from '../src/client/ImaginePage.tsx'
import type { ImaginePageProps } from '../src/client/slots.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

// The page reads none of the standard kit hooks.
const unusedHook = (() => { throw new Error('unused by the Imagine page') }) as never
const kit = { useSessions: unusedHook, useSessionPendingInteraction: unusedHook, useWorkspaces: unusedHook }
const t: ImaginePageProps['t'] = key => (en as Record<string, string>)[key] ?? key
const heroT = (key => key === 'brand.localBuild' ? 'Æven' : key) as ImaginePageProps['heroT']

describe('ImaginePage', () => {
  it('opens on the chat hero over a composer that keeps the draft and sends nothing yet', () => {
    const { container } = render(<ImaginePage {...kit} t={t} heroT={heroT} />)
    expect(screen.getByTestId('hero-greeting').textContent).toContain('Æven')

    const input = screen.getByRole('textbox', { name: en.placeholder })
    expect(input.getAttribute('placeholder')).toBe(en.placeholder)
    fireEvent.change(input, { target: { value: 'a lighthouse at dusk' } })
    expect((input as HTMLTextAreaElement).value).toBe('a lighthouse at dusk')
    // The box is sized to its content after every edit.
    expect((input as HTMLTextAreaElement).style.height).toMatch(/px$/)

    expect(screen.getByRole('button', { name: en.add }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: en.send }).hasAttribute('disabled')).toBe(true)
    expect(container.querySelector('[data-imagine-root]')).not.toBeNull()
  })
})
