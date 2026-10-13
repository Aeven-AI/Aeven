import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/engine/stream/list-structure.ts', async () => {
  const actual = await vi.importActual<typeof import('../../src/engine/stream/list-structure.ts')>(
    '../../src/engine/stream/list-structure.ts',
  )

  return { ...actual, listItems: vi.fn() }
})

import { ListCache } from '../../src/engine/cache/list.tsx'
import { listItems } from '../../src/engine/stream/list-structure.ts'

const mockedListItems = vi.mocked(listItems)
const processor = {
  parse: vi.fn(value => value),
  runSync: vi.fn(() => ({ type: 'root', children: [] })),
} as any

describe('list cache defensive inputs', () => {
  it('handles missing, blank, and markerless items', () => {
    const cache = new ListCache()

    mockedListItems.mockReturnValueOnce([undefined as any])
    cache.append('- item', processor, {})
    expect(cache.data).toEqual([null])

    mockedListItems.mockReturnValueOnce(['   '])
    cache.append('- item', processor, {})
    expect(cache.data).toEqual([null])

    mockedListItems.mockReturnValueOnce(['markerless item'])
    cache.append('- item\n\ncontinued', processor, {})
    expect(processor.parse).toHaveBeenLastCalledWith(
      'markerless item\n\n- x',
    )
  })
})
