/**
 * What one Files surface remembers by path: the paths a rename moves or a delete removes.
 */
import { describe, expect, it } from 'vitest'
import { FRESH_MEMORY, forgotten, renamed, type ExplorerMemory } from '../src/client/memory.ts'

/** A surface showing `openFile` with `expanded` open. */
function showing(openFile: string, expanded: string[] = []): ExplorerMemory {
  return { ...FRESH_MEMORY, openFile, expanded: new Set(expanded) }
}

describe('renames and deletes', () => {
  it('follows a folder rename through expansion and the open file', () => {
    const moved = renamed(showing('src/lib/b.ts', ['src', 'src/lib', 'srcs']), 'src', 'app')
    expect([...moved.expanded]).toEqual(['app', 'app/lib', 'srcs'])
    expect(moved.openFile).toBe('app/lib/b.ts')
  })

  it('forgets a deleted folder, closing a file inside it', () => {
    const gone = forgotten(showing('src/a.ts', ['src', 'docs']), 'src')
    expect([...gone.expanded]).toEqual(['docs'])
    expect(gone.openFile).toBeNull()
  })

  it('keeps the file on show when something else is deleted', () => {
    expect(forgotten(showing('b.ts'), 'a.ts').openFile).toBe('b.ts')
  })
})
