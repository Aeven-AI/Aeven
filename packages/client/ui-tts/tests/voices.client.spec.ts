/**
 * The reader's stored voice preference seen from a page without Web Storage: reading stays off, nothing
 * is persisted, and a choice made in this page still answers for as long as the page lives.
 */
import { describe, expect, it } from 'vitest'
import {
  ENABLED_KEY, preferredVoice, readEnabled, readPreferences, STORAGE_KEY, writeEnabled, writePreference,
} from '../src/client/voices.ts'

describe('voice preference without Web Storage', () => {
  it('starts with reading off', () => {
    expect(readEnabled()).toBe(false)
  })

  it('stores nothing and survives a switch of the toggle', () => {
    expect(() => { writeEnabled(true) }).not.toThrow()
    expect(() => { writeEnabled(false) }).not.toThrow()
    expect(readEnabled()).toBe(false)
  })

  it('reports no stored preference', () => {
    expect(readPreferences()).toEqual({})
    expect(preferredVoice('nl')).toBeUndefined()
  })

  it('answers the current page with the choice it was given', () => {
    expect(writePreference('nl', 'nl-NL-ColetteNeural')).toEqual({ nl: 'nl-NL-ColetteNeural' })
    expect(writePreference('nl', 'nl-NL-MaartenNeural')).toEqual({ nl: 'nl-NL-MaartenNeural' })
    expect(writePreference('nl', null)).toEqual({})
  })

  it('names the storage keys the browser keeps the choice under', () => {
    expect(STORAGE_KEY).toBe('aeven.read-aloud.voices')
    expect(ENABLED_KEY).toBe('aeven.read-aloud.enabled')
  })
})
