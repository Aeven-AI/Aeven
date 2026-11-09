/**
 * What one Files surface remembers by path: the files it showed, stepped through by back and forward, and the
 * paths a rename moves or a delete removes.
 */
import { describe, expect, it } from 'vitest'
import { FRESH_MEMORY, forgotten, renamed, stepHistory, visit, type ExplorerMemory } from '../src/client/memory.ts'

/** A surface that opened `paths` in order. */
function visited(...paths: string[]): ExplorerMemory {
  return paths.reduce(visit, FRESH_MEMORY)
}

describe('history', () => {
  it('records each opened file after the one on show', () => {
    const memory = visited('a.ts', 'b.ts', 'c.ts')
    expect(memory.history).toEqual(['a.ts', 'b.ts', 'c.ts'])
    expect(memory.historyIndex).toBe(2)
    expect(memory.openFile).toBe('c.ts')
  })

  it('steps back and forward, and stays put at either end', () => {
    const memory = visited('a.ts', 'b.ts')
    const back = stepHistory(memory, -1)
    expect(back.openFile).toBe('a.ts')
    expect(stepHistory(back, -1)).toBe(back)
    expect(stepHistory(back, 1).openFile).toBe('b.ts')
    expect(stepHistory(memory, 1)).toBe(memory)
  })

  it('drops the forward entries when a file opens after stepping back', () => {
    const memory = visit(stepHistory(visited('a.ts', 'b.ts', 'c.ts'), -1), 'd.ts')
    expect(memory.history).toEqual(['a.ts', 'b.ts', 'd.ts'])
    expect(memory.historyIndex).toBe(2)
  })

  it('does not record the file already on show twice', () => {
    expect(visit(visited('a.ts'), 'a.ts').history).toEqual(['a.ts'])
  })
})

describe('renames and deletes', () => {
  it('follows a folder rename through expansion, the open file, and history', () => {
    const memory = { ...visited('src/a.ts', 'other.ts', 'src/lib/b.ts'), expanded: new Set(['src', 'src/lib', 'srcs']) }
    const moved = renamed(memory, 'src', 'app')
    expect([...moved.expanded]).toEqual(['app', 'app/lib', 'srcs'])
    expect(moved.openFile).toBe('app/lib/b.ts')
    expect(moved.history).toEqual(['app/a.ts', 'other.ts', 'app/lib/b.ts'])
  })

  it('forgets a deleted folder, closing a file inside it', () => {
    const memory = { ...visited('notes.md', 'src/a.ts'), expanded: new Set(['src', 'docs']) }
    const gone = forgotten(memory, 'src')
    expect([...gone.expanded]).toEqual(['docs'])
    expect(gone.openFile).toBeNull()
    expect(gone.history).toEqual(['notes.md'])
    expect(gone.historyIndex).toBe(0)
  })

  it('keeps the file on show when something else is deleted', () => {
    const gone = forgotten(visited('a.ts', 'b.ts'), 'a.ts')
    expect(gone.openFile).toBe('b.ts')
    expect(gone.history).toEqual(['b.ts'])
    expect(gone.historyIndex).toBe(0)
  })
})
