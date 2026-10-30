// @vitest-environment jsdom
/**
 * The reader's voice preference as the browser keeps it, the language groups the picker draws, and the
 * two conversation readers: the text of one message, and the newest `read_aloud` an agent asked for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ENABLED_KEY, groupVoices, latestReadAloudRequest, messageText, preferredVoice, readEnabled,
  readPreferences, STORAGE_KEY, writeEnabled, writePreference, type ReadAloudCatalog,
} from '../src/client/voices.ts'
import { assistantNode, toolResultNode } from './harness.client.ts'

beforeEach(() => { localStorage.clear() })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readEnabled / writeEnabled', () => {
  it('starts off and remembers the switch across reloads', () => {
    expect(readEnabled()).toBe(false)
    writeEnabled(true)
    expect(localStorage.getItem(ENABLED_KEY)).toBe('on')
    expect(readEnabled()).toBe(true)
    writeEnabled(false)
    expect(localStorage.getItem(ENABLED_KEY)).toBe('off')
    expect(readEnabled()).toBe(false)
  })

  it('keeps the choice for this page when storage refuses the write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => { writeEnabled(true) }).not.toThrow()
  })
})

describe('readPreferences / writePreference / preferredVoice', () => {
  it('reads nothing from empty, unreadable or non-object storage', () => {
    expect(readPreferences()).toEqual({})
    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(readPreferences()).toEqual({})
    localStorage.setItem(STORAGE_KEY, 'null')
    expect(readPreferences()).toEqual({})
    localStorage.setItem(STORAGE_KEY, '7')
    expect(readPreferences()).toEqual({})
  })

  it('keeps only the language entries that name a voice', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ nl: 'nl-NL-ColetteNeural', en: 4 }))
    expect(readPreferences()).toEqual({ nl: 'nl-NL-ColetteNeural' })
  })

  it('stores one language\u2019s voice and forgets it when the default is chosen again', () => {
    expect(writePreference('nl', 'nl-NL-ColetteNeural')).toEqual({ nl: 'nl-NL-ColetteNeural' })
    expect(readPreferences()).toEqual({ nl: 'nl-NL-ColetteNeural' })
    expect(preferredVoice('nl')).toBe('nl-NL-ColetteNeural')

    expect(writePreference('en', 'en-GB-SoniaNeural')).toEqual({
      nl: 'nl-NL-ColetteNeural',
      en: 'en-GB-SoniaNeural',
    })
    expect(writePreference('nl', null)).toEqual({ en: 'en-GB-SoniaNeural' })
    expect(preferredVoice('nl')).toBeUndefined()
  })

  it('keeps the choice for this page when storage refuses the write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(writePreference('nl', 'nl-NL-ColetteNeural')).toEqual({ nl: 'nl-NL-ColetteNeural' })
  })
})

describe('groupVoices', () => {
  const catalog: ReadAloudCatalog = {
    voices: [
      { id: 'nl-bart', name: 'Bart', language: 'nl', gender: 'male' },
      { id: 'nl-colette', name: 'Colette', language: 'nl', gender: 'female' },
      { id: 'en-sonia', name: 'Sonia', language: 'en', gender: 'female' },
      { id: 'de-katja', name: 'Katja', language: 'de', gender: 'female' },
      { id: 'de-conrad', name: 'Conrad', language: 'de', gender: 'male' },
      { id: 'qq-ghost', name: 'Ghost', language: 'qq', gender: 'male' },
    ],
    voiceByLanguage: { en: 'en-sonia', de: 'de-missing' },
  }

  it('lists one section per language, by language name, with its voices by name', () => {
    const groups = groupVoices(catalog)
    expect(groups.map(group => [group.language, group.name])).toEqual([
      ['nl', 'Dutch'],
      ['en', 'English'],
      ['de', 'German'],
      ['qq', 'qq'],
    ])
    expect(groups.map(group => group.voices.map(voice => voice.name))).toEqual([
      ['Bart', 'Colette'],
      ['Sonia'],
      ['Conrad', 'Katja'],
      ['Ghost'],
    ])
  })

  it('falls back to the voice the deployment mapped to the language', () => {
    expect(groupVoices(catalog).find(group => group.language === 'en')).toMatchObject({
      mapped: 'en-sonia',
      defaultVoice: { id: 'en-sonia', name: 'Sonia' },
    })
  })

  it('falls back to the first female voice of a language the deployment does not map', () => {
    expect(groupVoices(catalog).find(group => group.language === 'nl')).toMatchObject({
      mapped: undefined,
      defaultVoice: { id: 'nl-colette', name: 'Colette' },
    })
  })

  it('falls back to the language\u2019s first voice when its mapping names no known voice', () => {
    expect(groupVoices(catalog).find(group => group.language === 'de')).toMatchObject({
      mapped: 'de-missing',
      defaultVoice: { id: 'de-katja', name: 'Katja' },
    })
  })

  it('falls back to the language\u2019s first voice when it has no female voice', () => {
    expect(groupVoices(catalog).find(group => group.language === 'qq')?.defaultVoice).toEqual({
      id: 'qq-ghost',
      name: 'Ghost',
    })
  })

  it('names a language by its raw subtag when the browser cannot localize it', () => {
    vi.spyOn(Intl.DisplayNames.prototype, 'of').mockReturnValue(undefined)
    expect(groupVoices(catalog).map(group => group.name)).toEqual(['de', 'en', 'nl', 'qq'])
  })

  it('names a language by its raw subtag where the browser has no display names at all', () => {
    vi.spyOn(Intl, 'DisplayNames').mockImplementation(function UnsupportedDisplayNames(): never {
      throw new Error('unsupported')
    })
    expect(groupVoices(catalog).map(group => group.name)).toEqual(['de', 'en', 'nl', 'qq'])
  })

  it('has no sections for a catalogue without voices', () => {
    expect(groupVoices({ voices: [], voiceByLanguage: {} })).toEqual([])
  })
})

describe('messageText', () => {
  it('joins the prose blocks of the named message', () => {
    const nodes = [
      assistantNode('m1', [
        { kind: 'text', text: 'First paragraph.' },
        { kind: 'reasoning', text: 'thinking out loud' },
        { kind: 'tool-call', callId: 'c1', name: 'read', argsRaw: '{}' },
        { kind: 'text', text: 'Second paragraph.' },
      ]),
    ]
    expect(messageText(nodes, 'm1')).toBe('First paragraph.\n\nSecond paragraph.')
  })

  it('reports nothing for another message, a message without prose, or an unknown id', () => {
    const nodes = [
      assistantNode('m1', [{ kind: 'reasoning', text: 'thinking out loud' }]),
      assistantNode('m2', [{ kind: 'text', text: 'Spoken.' }]),
    ]
    expect(messageText(nodes, 'm1')).toBe('')
    expect(messageText(nodes, 'nope')).toBe('')
  })
})

describe('latestReadAloudRequest', () => {
  it('reports no request before an agent asks', () => {
    expect(latestReadAloudRequest([])).toBe('')
    expect(latestReadAloudRequest([assistantNode('m1', [{ kind: 'text', text: 'hi' }])])).toBe('')
  })

  it('reads the switch out of the newest settled call', () => {
    const nodes = [
      toolResultNode(4, 'read_aloud', '{"enabled":false}'),
      toolResultNode(9, 'read_aloud', '{"enabled":true}'),
    ]
    expect(latestReadAloudRequest(nodes)).toBe('9:on')
    expect(latestReadAloudRequest(nodes.toReversed())).toBe('9:on')
  })

  it('reports the switch off for a call that asked for silence', () => {
    expect(latestReadAloudRequest([toolResultNode(3, 'read_aloud', '{"enabled":false}')])).toBe('3:off')
  })

  it('ignores results of other tools and results whose call is outside the window', () => {
    expect(latestReadAloudRequest([
      toolResultNode(2, 'read_aloud', '{}'),
      toolResultNode(5, 'search', '{}'),
      toolResultNode(8, null, '{}'),
    ])).toBe('2:on')
  })

  it('treats arguments it cannot read as a request to read', () => {
    expect(latestReadAloudRequest([toolResultNode(1, 'read_aloud', '{"enabled"')])).toBe('1:on')
    expect(latestReadAloudRequest([toolResultNode(1, 'read_aloud', 'null')])).toBe('1:on')
    expect(latestReadAloudRequest([toolResultNode(1, 'read_aloud', '"on"')])).toBe('1:on')
    expect(latestReadAloudRequest([toolResultNode(1, 'read_aloud', '{"voice":"x"}')])).toBe('1:on')
  })
})
