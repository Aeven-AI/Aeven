/** Entry names are refused before any request, and long folder paths shorten from the middle. */
import { describe, expect, it } from 'vitest'
import { middleTruncate, nameProblem } from '../src/client/names.ts'

describe('nameProblem', () => {
  it.each([
    ['', 'name.empty'],
    ['   ', 'name.empty'],
    ['.', 'name.dot'],
    ['..', 'name.dot'],
    ['a/b', 'name.character'],
    ['a\\b', 'name.character'],
    ['what?', 'name.character'],
    ['CON', 'name.reserved'],
    ['lpt1.txt', 'name.reserved'],
    ['notes.', 'name.trailing'],
    ['notes ', 'name.trailing'],
    ['x'.repeat(256), 'name.long'],
  ] as const)('refuses %j as %s', (name, reason) => {
    expect(nameProblem(name)).toBe(reason)
  })

  it.each(['index.html', '.env', 'Résumé 2026.pdf', 'console.log', 'a'.repeat(255)])('accepts %j', (name) => {
    expect(nameProblem(name)).toBeUndefined()
  })
})

describe('middleTruncate', () => {
  it('leaves a path within the limit alone', () => {
    expect(middleTruncate('src/client/FilesPane.tsx', 40)).toBe('src/client/FilesPane.tsx')
  })

  it('keeps the first folder and as much of the end as fits', () => {
    expect(middleTruncate('components/sidebar/files/client/FilesPane.tsx', 36)).toBe('components/…/client/FilesPane.tsx')
  })
})
