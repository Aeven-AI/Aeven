import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** The catalog package whose vendored list and reviewed values the sync reads. */
const CATALOG = join(import.meta.dirname, '..', 'packages/skill/skill-catalog')

interface VendoredEntry {
  readonly repo: string
  readonly path: string
  readonly category: string
  readonly author: string
  readonly description?: string
}

/** Vendored entries as the sync reads them. */
const entries = (): readonly VendoredEntry[] =>
  (JSON.parse(readFileSync(join(CATALOG, 'vendored.json'), 'utf8')) as { skills?: readonly VendoredEntry[] }).skills ?? []

/** Reviewed judgements keyed by installed name. */
const reviewed = (): Readonly<Record<string, { verdict?: string; value?: number }>> =>
  (JSON.parse(readFileSync(join(CATALOG, 'curation.json'), 'utf8')) as { skills?: Record<string, { verdict?: string; value?: number }> }).skills ?? {}

/** The name one entry installs under, which is the directory it ships from. */
const nameOf = (entry: VendoredEntry): string => entry.path.split('/').at(-1) ?? ''

describe('vendored skill catalog', () => {
  it('names one kebab-case directory per entry, unique across the list', () => {
    const names = entries().map(nameOf)
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    expect(new Set(names).size).toBe(names.length)
  })

  it('states the repository, directory, category and author of every entry', () => {
    for (const entry of entries()) {
      expect(entry.repo).toMatch(/^[\w.-]+\/[\w.-]+$/)
      expect(entry.path).toMatch(/^[^/]+(?:\/[^/]+)*$/)
      expect(entry.category).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(entry.author.trim()).not.toBe('')
    }
  })

  it('leaves every vendored skill with a reviewed value in curation.json', () => {
    for (const entry of entries()) expect(reviewed()[nameOf(entry)]?.value, nameOf(entry)).toBeGreaterThan(0)
  })

  it('carries an English summary only where the skill cannot describe itself in English', () => {
    for (const entry of entries().filter(entry => entry.description !== undefined)) {
      expect(entry.description?.trim()).not.toBe('')
      expect(entry.description).toMatch(/^[\x20-\x7E]+$/)
    }
  })
})
