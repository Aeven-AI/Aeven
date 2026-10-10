/**
 * The create prompt's scene and look pools: the walk a popup performs, pinned
 * as a pure function so a reroll never repeats and never leaves the pools.
 */
import { describe, expect, it } from 'vitest'
import { IMAGINE_LOOKS, IMAGINE_SCENES, variationAt } from '../src/client/scenes.ts'

describe('variation walk', () => {
  it('starts inside the pools for any roll', () => {
    for (const roll of [0, 0.01, 0.5, 0.999]) {
      const { scene, look } = variationAt(roll, 0)
      expect(IMAGINE_SCENES).toContain(scene)
      expect(IMAGINE_LOOKS).toContain(look)
    }
    expect(variationAt(0, 0).scene).toBe(IMAGINE_SCENES[0])
    expect(variationAt(0.999, 0).scene).toBe(IMAGINE_SCENES[IMAGINE_SCENES.length - 1])
  })

  it('walks every scene once before repeating, and wraps', () => {
    const walked = IMAGINE_SCENES.map((_, step) => variationAt(0.4, step).scene)
    expect(new Set(walked).size).toBe(IMAGINE_SCENES.length)
    expect(variationAt(0.4, IMAGINE_SCENES.length).scene).toBe(walked[0])
  })

  it('keeps pairs changing after the shorter pool wraps', () => {
    const pairs = new Set(
      Array.from({ length: 18 }, (_, step) => JSON.stringify(variationAt(0.25, step))),
    )
    expect(pairs.size).toBeGreaterThan(IMAGINE_LOOKS.length)
  })
})
