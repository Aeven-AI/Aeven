import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/engine/math-notation.ts', async () => {
  const actual = await vi.importActual<typeof import('../../src/engine/math-notation.ts')>(
    '../../src/engine/math-notation.ts',
  )

  return { ...actual, convertMath: vi.fn(() => null) }
})

import Renderer from '../../src/engine/renderer.tsx'

describe('renderer math fallback', () => {
  it('normalizes an empty converter result', () => {
    const renderer: any = new Renderer()
    expect(renderer.mdMath('input', 'text')).toBe('')
  })
})
