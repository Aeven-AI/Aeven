// @vitest-environment jsdom
/**
 * The composer Options row for the reading voice: it opens a card beside the popup, lists the Host's
 * voices by language, and remembers the voice the reader picks for each language.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { SessionId } from '@aeven/session/types'
import { en } from '../src/client/locales.ts'
import { readPreferences, STORAGE_KEY, type ReadAloudCatalog } from '../src/client/voices.ts'
import { SystemVoice, type SystemVoiceProps } from '../src/client/SystemVoice.tsx'
import { makeT } from './harness.ts'

const SID = 's1' as SessionId
const t = makeT()

const CATALOG: ReadAloudCatalog = {
  voices: [
    { id: 'nl-colette', name: 'Colette', language: 'nl', gender: 'female' },
    { id: 'nl-maarten', name: 'Maarten', language: 'nl', gender: 'male' },
    { id: 'en-sonia', name: 'Sonia', language: 'en', gender: 'female' },
  ],
  voiceByLanguage: { en: 'en-sonia' },
}

beforeEach(() => { localStorage.clear() })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/**
 * The Options row over a catalogue that resolves when the case says so.
 * @param options - `fail` rejects the catalogue, `pending` leaves it unresolved.
 * @returns the render result and the catalogue reader.
 */
function picker(options: { fail?: boolean; pending?: boolean } = {}) {
  let settle!: (catalog: ReadAloudCatalog) => void
  let reject!: (error: unknown) => void
  const loadCatalog = vi.fn(() => new Promise<ReadAloudCatalog>((resolve, fail) => {
    settle = resolve
    reject = fail
    if (options.fail === true) fail(new Error('catalog unavailable'))
    if (options.pending !== true && options.fail !== true) resolve(CATALOG)
  }))
  const props = { sessionId: SID, loadCatalog, t } as unknown as SystemVoiceProps
  const view = render(<SystemVoice {...props} />)
  return { ...view, props, loadCatalog, settle: (catalog = CATALOG) => { settle(catalog) }, reject }
}

/**
 * Open the card and wait for the catalogue to be drawn.
 * @returns the card's contents.
 */
async function openCard(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('menuitem', { name: en['voice.row'] }))
  return await screen.findByRole('group', { name: en['voice.row'] })
}

describe('the row', () => {
  it('opens the card and reads the catalogue once', async () => {
    const { loadCatalog } = picker({ pending: true })
    const row = screen.getByRole('menuitem', { name: en['voice.row'] })
    expect(row.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('group')).toBeNull()

    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(en['voice.loading'])).toBeDefined()

    fireEvent.click(row)
    expect(screen.queryByRole('group')).toBeNull()

    await act(async () => { fireEvent.click(row) })
    await waitFor(() => { expect(screen.getByText(en['voice.loading'])).toBeDefined() })
    expect(loadCatalog).toHaveBeenCalledTimes(2)
  })

  it('lists the voices by language once the catalogue arrives', async () => {
    picker()
    const card = await openCard()

    expect(within(card).getByText('Dutch')).toBeDefined()
    expect(within(card).getByText('English')).toBeDefined()
    expect(within(card).getByText(en['voice.count'].replace('{count}', '2'))).toBeDefined()
    expect(within(card).getByText(en['voice.count'].replace('{count}', '1'))).toBeDefined()
    expect(within(card).getByRole('menuitemradio', { name: 'Colette' })).toBeDefined()
  })

  it('reports a catalogue the Host could not deliver', async () => {
    picker({ fail: true })
    const card = await openCard()

    await waitFor(() => { expect(within(card).getByText(en['voice.unavailable'])).toBeDefined() })
  })
})

describe('choosing a voice', () => {
  it('marks the voice the deployment mapped to the language', async () => {
    picker()
    const card = await openCard()
    const english = within(card).getByText('English').closest('section')
    if (english === null) throw new Error('English section missing')

    expect(within(english).getByRole('menuitemradio', { name: 'Sonia' }).getAttribute('aria-checked')).toBe('true')
    expect(within(english).getByRole('menuitemradio', { name: /^Default/ }).getAttribute('aria-checked')).toBe('false')
  })

  it('marks the default row, with the voice it resolves to, when the language is not mapped', async () => {
    picker()
    const card = await openCard()
    const dutch = within(card).getByText('Dutch').closest('section')
    if (dutch === null) throw new Error('Dutch section missing')

    const fallback = within(dutch).getByRole('menuitemradio', { name: /^Default/ })
    expect(fallback.getAttribute('aria-checked')).toBe('true')
    expect(fallback.textContent).toBe(`${en['voice.default']}Colette`)
    expect(within(dutch).getByRole('menuitemradio', { name: 'Colette' }).getAttribute('aria-checked')).toBe('false')
  })

  it('stores the chosen voice and moves the check to it', async () => {
    picker()
    const card = await openCard()
    const dutch = within(card).getByText('Dutch').closest('section')
    if (dutch === null) throw new Error('Dutch section missing')

    fireEvent.click(within(dutch).getByRole('menuitemradio', { name: 'Maarten' }))
    expect(readPreferences()).toEqual({ nl: 'nl-maarten' })
    expect(within(dutch).getByRole('menuitemradio', { name: 'Maarten' }).getAttribute('aria-checked')).toBe('true')
    expect(within(dutch).getByRole('menuitemradio', { name: 'Colette' }).getAttribute('aria-checked')).toBe('false')
  })

  it('forgets the language\u2019s voice when the reader picks the default again', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ nl: 'nl-maarten' }))
    picker()
    const card = await openCard()
    const dutch = within(card).getByText('Dutch').closest('section')
    if (dutch === null) throw new Error('Dutch section missing')

    expect(within(dutch).getByRole('menuitemradio', { name: 'Maarten' }).getAttribute('aria-checked')).toBe('true')

    fireEvent.click(within(dutch).getByRole('menuitemradio', { name: /^Default/ }))
    expect(readPreferences()).toEqual({})
    expect(within(dutch).getByRole('menuitemradio', { name: /^Default/ }).getAttribute('aria-checked')).toBe('true')
  })
})

describe('the card\u2019s room', () => {
  it('grows upward to the space above the popup edge and follows the window', async () => {
    const measure = vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue({ bottom: 400 } as DOMRect)
    picker()
    const card = await openCard()
    expect(card.style.maxHeight).toBe('336px')

    measure.mockReturnValue({ bottom: 500 } as DOMRect)
    await act(async () => { fireEvent(window, new Event('resize')) })
    expect(card.style.maxHeight).toBe('436px')
  })

  it('keeps the card\u2019s natural height when the seat cannot be measured', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(undefined as unknown as DOMRect)
    picker()
    const card = await openCard()

    expect(card.style.maxHeight).toBe('')
  })
})
