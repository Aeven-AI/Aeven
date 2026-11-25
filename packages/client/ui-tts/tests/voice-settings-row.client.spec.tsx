// @vitest-environment jsdom
/**
 * The Settings read-aloud voices row: its pill opens the popupSelect card's markup over the settings
 * panel, the card searches the languages, turns to one language's voices, and stores the voice picked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { en } from '../src/client/locales.ts'
import { readPreferences, STORAGE_KEY, type ReadAloudCatalog } from '../src/client/voices.ts'
import { VoiceSettingsRow, type VoiceSettingsRowProps } from '../src/client/VoiceSettingsRow.tsx'
import { makeT } from './harness.client.ts'

const CATALOG: ReadAloudCatalog = {
  voices: [
    { id: 'nl-colette', name: 'Colette', language: 'nl', gender: 'female' },
    { id: 'nl-maarten', name: 'Maarten', language: 'nl', gender: 'male' },
    { id: 'en-sonia', name: 'Sonia', language: 'en', gender: 'female' },
  ],
  voiceByLanguage: { en: 'en-sonia' },
}

beforeEach(() => {
  localStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/**
 * Render the row over a catalogue reader.
 * @param loadCatalog - the reader; resolves the fixture catalogue by default.
 * @returns the reader.
 */
function row(loadCatalog = vi.fn(async () => CATALOG)) {
  const props = { loadCatalog, t: makeT() } as unknown as VoiceSettingsRowProps
  render(<VoiceSettingsRow {...props} />)
  return loadCatalog
}

/** @returns the pill that opens the card. */
function pill(): HTMLElement {
  return screen.getByRole('button', { expanded: false })
}

/**
 * Open the card and wait for the languages.
 * @returns the list of rows.
 */
async function openList(): Promise<HTMLElement> {
  await act(async () => { fireEvent.click(pill()) })
  return await screen.findByRole('listbox', { name: en['voice.settings.title'] })
}

describe('the pill', () => {
  it('says Default until a language has a voice of its own', () => {
    row()
    expect(pill().textContent).toBe(en['voice.default'])
  })

  it('counts the languages the reader customized', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ nl: 'nl-maarten', en: 'en-sonia' }))
    row()
    expect(pill().textContent).toBe(en['voice.customized'].replace('{count}', '2'))
  })
})

describe('the card', () => {
  it('lists the languages with their voice counts and focuses the search', async () => {
    row()
    const list = await openList()

    expect(within(list).getAllByRole('option').map(option => option.textContent)).toEqual([
      `Dutch${en['voice.count'].replace('{count}', '2')}`,
      `English${en['voice.count'].replace('{count}', '1')}`,
    ])
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: en['voice.search'] }))
  })

  it('narrows the languages to the search and says when none matches', async () => {
    row()
    const list = await openList()
    const search = screen.getByRole('textbox', { name: en['voice.search'] })

    fireEvent.change(search, { target: { value: 'nl' } })
    expect(within(list).getAllByRole('option').map(option => option.textContent?.startsWith('Dutch'))).toEqual([true])

    fireEvent.change(search, { target: { value: 'swahili' } })
    expect(screen.getByText(en['voice.noMatch'])).toBeDefined()
  })

  it('reports a catalogue the Host could not deliver', async () => {
    row(vi.fn(async () => { throw new Error('no catalogue') }))
    await act(async () => { fireEvent.click(pill()) })

    expect(await screen.findByText(en['voice.unavailable'])).toBeDefined()
  })

  it('turns to a language’s voices and stores the voice picked there', async () => {
    row()
    const list = await openList()
    fireEvent.click(within(list).getByText('Dutch'))

    const voices = screen.getByRole('listbox', { name: en['voice.settings.title'] })
    expect(within(voices).getAllByRole('option').map(option => option.textContent)).toEqual([
      `${en['voice.default']}Colette`, 'Colette', 'Maarten',
    ])
    fireEvent.click(within(voices).getByText('Maarten'))

    expect(readPreferences()).toEqual({ nl: 'nl-maarten' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(pill().textContent).toBe(en['voice.customized'].replace('{count}', '1'))
  })

  it('picks with the arrow keys and Enter', async () => {
    row()
    await openList()
    const search = screen.getByRole('textbox', { name: en['voice.search'] })

    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    fireEvent.keyDown(search, { key: 'Enter' })

    expect(readPreferences()).toEqual({})
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('closes on Escape without letting the settings panel see it', async () => {
    row()
    await openList()
    const panelEscape = vi.fn()
    document.addEventListener('keydown', panelEscape)

    fireEvent.keyDown(screen.getByRole('textbox', { name: en['voice.search'] }), { key: 'Escape' })

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(panelEscape).not.toHaveBeenCalled()
    document.removeEventListener('keydown', panelEscape)
  })

  it('closes on a press outside it', async () => {
    row()
    await openList()

    fireEvent.pointerDown(document.body)

    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
