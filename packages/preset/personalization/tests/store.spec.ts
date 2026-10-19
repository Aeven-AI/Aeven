import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PERSONALIZATION, PERSONALIZATION_VERSION, PersonalizationStore, parsePersonalization,
  personalizationPath, renderPersonalization,
} from '../src/store.ts'

const roots: string[] = []

function root(): string {
  const directory = mkdtempSync(join(tmpdir(), 'avn-personalization-'))
  roots.push(directory)
  return directory
}

afterEach(() => {
  roots.length = 0
})

function store(options: { maxNotesChars?: number; maxMasterPromptChars?: number } = {}): PersonalizationStore {
  return new PersonalizationStore(root(), options.maxNotesChars ?? 100, options.maxMasterPromptChars ?? 200)
}

describe('parsePersonalization', () => {
  it('reads a document this version wrote', () => {
    expect(parsePersonalization(JSON.stringify({ version: PERSONALIZATION_VERSION, voice: 'warm', notes: 'Be brief.', masterPrompt: 'Mine.' })))
      .toEqual({ voice: 'warm', notes: 'Be brief.', masterPrompt: 'Mine.' })
  })

  it('yields the defaults for a document it cannot read', () => {
    expect(parsePersonalization('{ not json')).toEqual(DEFAULT_PERSONALIZATION)
    expect(parsePersonalization('null')).toEqual(DEFAULT_PERSONALIZATION)
    // A document from an older format version is not half-trusted.
    expect(parsePersonalization(JSON.stringify({ version: PERSONALIZATION_VERSION - 1, voice: 'warm' })))
      .toEqual(DEFAULT_PERSONALIZATION)
  })

  it('yields the defaults for malformed fields', () => {
    expect(parsePersonalization(JSON.stringify({ version: PERSONALIZATION_VERSION, voice: 'shouty', notes: 7, masterPrompt: false })))
      .toEqual({ voice: 'automatic', notes: '', masterPrompt: '' })
  })
})

describe('renderPersonalization', () => {
  it('renders nothing for every default', () => {
    expect(renderPersonalization(DEFAULT_PERSONALIZATION)).toBe('')
  })

  it('renders the voice, the notes, or both under the guidance line', () => {
    expect(renderPersonalization({ voice: 'direct', notes: '', masterPrompt: 'Mine.' }))
      .toBe('How this person asked you to talk with them. It outranks the voice defaults above; something they ask for in the conversation outranks it.\n<personalization>\nVoice: Straight to the point in every reply, personal topics included: brief and plain, no small talk, and still kind.\n</personalization>')
    expect(renderPersonalization({ voice: 'automatic', notes: 'No lists.', masterPrompt: '' }))
      .toContain('In their own words: No lists.')
    // The master prompt is a persona of its own and never joins this block.
    expect(renderPersonalization({ voice: 'automatic', notes: '', masterPrompt: 'Mine.' })).toBe('')
  })
})

describe('PersonalizationStore', () => {
  it('reads the defaults before anything is stored', () => {
    const preferences = store()
    expect(preferences.read('owner')).toEqual({ ...DEFAULT_PERSONALIZATION, maxNotesChars: 100, maxMasterPromptChars: 200 })
    expect(preferences.block('owner')).toBe('')
  })

  it('stores a voice change and reports it', () => {
    const preferences = store()
    const change = preferences.update('owner', { voice: 'playful' })
    expect(change.changed).toBe(true)
    expect(change.state.voice).toBe('playful')
    expect(preferences.read('owner').voice).toBe('playful')
    // The stored document is the next reader's input, not a process-local cache.
    expect(JSON.parse(readFileSync(personalizationPath(roots[0]!, 'owner'), 'utf8')))
      .toEqual({ version: PERSONALIZATION_VERSION, voice: 'playful', notes: '', masterPrompt: '' })
  })

  it('trims both texts and refuses overlong ones whole', () => {
    const preferences = store({ maxNotesChars: 5, maxMasterPromptChars: 5 })
    expect(preferences.update('owner', { notes: '  abc  ' }).state.notes).toBe('abc')
    const notes = preferences.update('owner', { notes: 'abcdef' })
    expect(notes).toMatchObject({ changed: false, reason: 'notes-too-long' })
    expect(notes.state.notes).toBe('abc')
    const master = preferences.update('owner', { masterPrompt: 'abcdef' })
    expect(master).toMatchObject({ changed: false, reason: 'master-prompt-too-long' })
    expect(preferences.read('owner').masterPrompt).toBe('')
  })

  it('reports no change when a write would store the same preferences', () => {
    const preferences = store()
    preferences.update('owner', { voice: 'warm', notes: 'Brief.' })
    expect(preferences.update('owner', { voice: 'warm', notes: 'Brief.' })).toMatchObject({ changed: false })
  })

  it('rejects a voice this store does not offer', () => {
    expect(() => store().update('owner', { voice: 'shouty' as never })).toThrow('unknown personalization voice: shouty')
  })

  it('resets a person master prompt to the shipped one', () => {
    const preferences = store()
    preferences.update('owner', { masterPrompt: 'Mine.' })
    const reset = preferences.resetMasterPrompt('owner')
    expect(reset.changed).toBe(true)
    expect(reset.state.masterPrompt).toBe('')
    expect(preferences.resetMasterPrompt('owner')).toMatchObject({ changed: false })
  })

  it('re-reads the document when another writer moved it', () => {
    const preferences = store()
    preferences.read('owner')
    writeFileSync(personalizationPath(roots[0]!, 'owner'), JSON.stringify({
      version: PERSONALIZATION_VERSION, voice: 'warm', notes: 'Written elsewhere.', masterPrompt: '',
    }))
    expect(preferences.read('owner').voice).toBe('warm')
    expect(preferences.block('owner')).toContain('Written elsewhere.')
  })

  it('keeps each person apart', () => {
    const preferences = store()
    preferences.update('alice', { voice: 'direct' })
    expect(preferences.read('bob').voice).toBe('automatic')
  })
})
