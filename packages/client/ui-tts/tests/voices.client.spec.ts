/**
 * The reader's stored voice preference seen from a page without Web Storage: nothing is persisted, and a
 * choice made in this page still answers for as long as the page lives.
 */
import { describe, expect, it } from 'vitest'
import {
  preferredVoice, readPreferences, STORAGE_KEY, writePreference,
} from '../src/client/voices.ts'

describe('voice preference without Web Storage', () => {
  it('reports no stored preference', () => {
    expect(readPreferences()).toEqual({})
    expect(preferredVoice('nl')).toBeUndefined()
  })

  it('answers the current page with the choice it was given', () => {
    expect(writePreference('nl', 'nl-NL-ColetteNeural')).toEqual({ nl: 'nl-NL-ColetteNeural' })
    expect(writePreference('nl', 'nl-NL-MaartenNeural')).toEqual({ nl: 'nl-NL-MaartenNeural' })
    expect(writePreference('nl', null)).toEqual({})
  })

  it('names the storage key the browser keeps the choice under', () => {
    expect(STORAGE_KEY).toBe('aeven.read-aloud.voices')
  })
})
