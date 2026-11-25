// @vitest-environment jsdom
/**
 * The rows the voice picker card draws: languages with their voice counts, one language's voices with
 * the current choice marked, and the search that narrows them.
 */
import { describe, expect, it } from 'vitest'
import { filterRows, languageRows, voiceRows, type ReadAloudCatalog } from '../src/client/voices.ts'

const CATALOG: ReadAloudCatalog = {
  voices: [
    { id: 'nl-colette', name: 'Colette', language: 'nl', gender: 'female' },
    { id: 'nl-maarten', name: 'Maarten', language: 'nl', gender: 'male' },
    { id: 'en-sonia', name: 'Sonia', language: 'en', gender: 'female' },
  ],
  voiceByLanguage: { en: 'en-sonia' },
}

describe('language rows', () => {
  it('lists each language by name with its voice count and its subtag as a search keyword', () => {
    expect(languageRows(CATALOG, voices => `${String(voices)} voices`)).toEqual([
      { id: 'nl', label: 'Dutch', detail: '2 voices', keywords: 'nl' },
      { id: 'en', label: 'English', detail: '1 voices', keywords: 'en' },
    ])
  })
})

describe('voice rows', () => {
  it('marks Default, naming the voice it resolves to, when the language is neither mapped nor picked', () => {
    expect(voiceRows(CATALOG, 'nl', {}, 'Default')).toEqual([
      { id: 'default', label: 'Default', detail: 'Colette', active: true },
      { id: 'nl-colette', label: 'Colette' },
      { id: 'nl-maarten', label: 'Maarten' },
    ])
  })

  it('marks the voice the deployment mapped to the language', () => {
    expect(voiceRows(CATALOG, 'en', {}, 'Default')).toEqual([
      { id: 'default', label: 'Default', detail: 'Sonia' },
      { id: 'en-sonia', label: 'Sonia', active: true },
    ])
  })

  it('marks the voice the reader picked', () => {
    expect(voiceRows(CATALOG, 'nl', { nl: 'nl-maarten' }, 'Default').filter(row => row.active === true))
      .toEqual([{ id: 'nl-maarten', label: 'Maarten', active: true }])
  })

  it('draws nothing for a language the catalogue does not hold', () => {
    expect(voiceRows(CATALOG, 'fr', {}, 'Default')).toEqual([])
  })
})

describe('the search', () => {
  const rows = languageRows(CATALOG, voices => `${String(voices)} voices`)

  it('keeps every row for a blank query', () => {
    expect(filterRows(rows, '  ')).toBe(rows)
  })

  it('matches the language name and the subtag regardless of case', () => {
    expect(filterRows(rows, 'DUT').map(row => row.id)).toEqual(['nl'])
    expect(filterRows(rows, 'en').map(row => row.id)).toEqual(['en'])
  })

  it('matches nothing for a language the list does not hold', () => {
    expect(filterRows(rows, 'swahili')).toEqual([])
  })
})
