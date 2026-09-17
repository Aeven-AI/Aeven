/**
 * @vitest-environment happy-dom
 *
 * The keyframe sheet is injected at most once per document: a second call is a
 * no-op, and a sheet a previous copy of the module already injected is adopted
 * rather than duplicated.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

const STYLE_ID = 'avn-coding-oauth-micro-styles'

afterEach(() => {
  for (const style of document.head.querySelectorAll(`style#${STYLE_ID}`)) style.remove()
})

/** A module instance that has never injected anything, whatever earlier tests did. */
async function freshEnsureMicroStyles(): Promise<() => void> {
  vi.resetModules()
  const module = await import('../src/client/microStyles.ts')
  return module.ensureMicroStyles
}

describe('micro styles injection', () => {
  it('injects the keyframe sheet into the head, once', async () => {
    const ensureMicroStyles = await freshEnsureMicroStyles()

    ensureMicroStyles()

    const injected = document.getElementById(STYLE_ID)
    expect(injected?.tagName).toBe('STYLE')
    expect(injected?.textContent).toContain('@keyframes avn-coding-oauth-spin')
    expect(injected?.textContent).toContain('@keyframes avn-coding-oauth-skeleton-pulse')
    expect(injected?.textContent).toContain('prefers-reduced-motion')

    // A later call in the same module instance adds nothing.
    ensureMicroStyles()
    expect(document.querySelectorAll(`style#${STYLE_ID}`)).toHaveLength(1)
  })

  it('adopts the sheet a previous copy of the module already injected', async () => {
    const existing = document.createElement('style')
    existing.id = STYLE_ID
    document.head.append(existing)

    const ensureMicroStyles = await freshEnsureMicroStyles()
    ensureMicroStyles()

    expect(document.getElementById(STYLE_ID)).toBe(existing)
    expect(document.querySelectorAll(`style#${STYLE_ID}`)).toHaveLength(1)
    // The adopted sheet is left exactly as the first copy wrote it.
    expect(existing.textContent).toBe('')
  })
})
