import { describe, expect, it } from 'vitest'

import Renderer from '../../src/engine/renderer.tsx'

/**
 * rehype-react keys elements by the identity of the component it was given, so
 * a cell map rebuilt per append makes every cached row look like a different
 * component and remounts it. For a cell holding a diagram that remount re-runs
 * the whole diagram engine over source that did not change, which is expensive
 * enough to block the main thread.
 *
 * The map the caches receive therefore has to be the same object, holding the
 * same functions, for the life of the renderer.
 */
describe('cached cell component identity', () => {
  it('hands every table and list append one stable cell map', () => {
    const renderer: any = new Renderer()
    const map = renderer.cellMap
    const { a, m, img } = map

    renderer.processCacheMd('| A |\n| --- |\n| x |\n', 'table', false)
    renderer.processCacheMd('| A |\n| --- |\n| x |\n| y |\n', 'table', false)
    renderer.processCacheMd('- one\n- two', 'list', true)
    renderer.settledTableBlock('| A |\n| --- |\n| x |\n')

    expect(renderer.cellMap).toBe(map)
    expect(renderer.cellMap.a).toBe(a)
    expect(renderer.cellMap.m).toBe(m)
    expect(renderer.cellMap.img).toBe(img)
  })

  it('keeps that map across a reset, which drops content and not wiring', () => {
    const renderer: any = new Renderer()
    const map = renderer.cellMap

    renderer.processCacheMd('| A |\n| --- |\n| x |\n', 'table', false)
    renderer.reset()
    renderer.processCacheMd('| A |\n| --- |\n| x |\n', 'table', false)

    expect(renderer.cellMap).toBe(map)
  })

  it('applies host overrides to the cell map once, at construction', () => {
    const Override = () => null
    const renderer: any = new Renderer({ components: { img: Override } })

    expect(renderer.cellMap.img).toBe(Override)
    expect(renderer.components.img).toBe(Override)
  })
})
