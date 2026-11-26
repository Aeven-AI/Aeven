// @vitest-environment jsdom
/**
 * What one Files surface remembers by path: the paths a rename moves or a delete removes; and the HTML view,
 * which a new surface takes from the reader's last choice on this browser.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  FRESH_MEMORY, forgotten, recall, remember, renamed, saveHtmlView, savedHtmlView, type ExplorerMemory,
} from '../src/client/memory.ts'

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

describe('HTML view preference', () => {
  afterEach(() => { localStorage.clear() })

  it('opens HTML rendered when the reader never chose', () => {
    expect(savedHtmlView()).toBe('preview')
    expect(recall('session-1', 'surface-new').htmlView).toBe('preview')
  })

  it('starts every new surface with the view the reader chose last', () => {
    saveHtmlView('source')
    expect(recall('session-2', 'surface-a').htmlView).toBe('source')
    expect(recall('session-3', 'surface-b').htmlView).toBe('source')
    saveHtmlView('preview')
    expect(recall('session-4', 'surface-c').htmlView).toBe('preview')
  })

  it('keeps a surface where it was left', () => {
    remember('session-5', 'surface-d', { ...FRESH_MEMORY, htmlView: 'source' })
    saveHtmlView('preview')
    expect(recall('session-5', 'surface-d').htmlView).toBe('source')
  })
})
