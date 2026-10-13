// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Spinner } from '@aeven/client-ui-primitives'

afterEach(cleanup)

describe('Spinner', () => {
  it('is decorative, so the surface around it owns the status text', () => {
    // Every caller wraps this in its own role="status" with the label for what
    // is loading; announcing here would read the wait out twice.
    const { container } = render(<Spinner />)
    const spinner = container.firstElementChild as HTMLElement
    expect(spinner.getAttribute('aria-hidden')).toBe('true')
    expect(spinner.textContent).toBe('')
    expect(spinner.querySelector('svg')).not.toBeNull()
  })

  it('appends a caller class to its own instead of replacing it', () => {
    // The module class carries the size and the rotation; a surface that
    // overrode it rather than adding to it would get a static glyph.
    const { container, rerender } = render(<Spinner />)
    const own = (container.firstElementChild as HTMLElement).className
    expect(own).not.toBe('')

    rerender(<Spinner className="surface" />)
    const classes = (container.firstElementChild as HTMLElement).className.split(' ')
    expect(classes).toContain('surface')
    expect(classes).toContain(own)
  })

  it('draws one shared glyph, inheriting the surface colour', () => {
    const { container } = render(<Spinner />)
    const path = container.querySelector('svg path')
    expect(path?.getAttribute('stroke')).toBe('currentColor')
  })
})
