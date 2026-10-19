// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PersonalizationView } from '@aeven/api-remotes/client'
// The plugin's namespace merge reaches this program only through its entry.
import type {} from '../src/client/index.ts'
import type { PersonalizationSectionProps } from '../src/client/PersonalizationSection.tsx'
import { PersonalizationSection } from '../src/client/PersonalizationSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

/** The seat's key domain falls back to the key, and interpolates as the real chain does. */
const t: PersonalizationSectionProps['t'] = (key, variables) => {
  const copy = (en as Record<string, string>)[key] ?? key
  return variables === undefined
    ? copy
    : copy.replace(/\{(\w+)\}/g, (match, name: string) => String(variables[name] ?? match))
}

// Global standard kit stubs: this page consumes none of these hooks.
const unusedHook = (() => { throw new Error('unused by the personalization page') }) as never
const kit = { useSessions: unusedHook, useWorkspaces: unusedHook, useSessionPendingInteraction: unusedHook }

const VIEW: PersonalizationView = {
  voice: 'automatic',
  notes: '',
  masterPrompt: '',
  effectiveMasterPrompt: 'You are Aeven.',
  customMasterPrompt: false,
  maxNotesChars: 50,
  maxMasterPromptChars: 200,
}

function mount(overrides: {
  view?: Partial<PersonalizationView>
  update?: PersonalizationSectionProps['update']
  resetMasterPrompt?: PersonalizationSectionProps['resetMasterPrompt']
  read?: PersonalizationSectionProps['read']
} = {}) {
  const view = { ...VIEW, ...overrides.view }
  const update = overrides.update ?? vi.fn(async () => ({ changed: true, view }))
  const resetMasterPrompt = overrides.resetMasterPrompt
    ?? vi.fn(async () => ({ changed: true, view: { ...view, masterPrompt: '', effectiveMasterPrompt: 'You are Aeven.', customMasterPrompt: false } }))
  const read = overrides.read ?? vi.fn(async () => view)
  const props: PersonalizationSectionProps = {
    ...kit,
    close: vi.fn(),
    detail: undefined,
    showDetail: vi.fn(),
    t,
    read,
    cachedView: () => undefined,
    update,
    resetMasterPrompt,
  }
  render(<PersonalizationSection {...props} />)
  return { view, update, resetMasterPrompt, read }
}

describe('PersonalizationSection', () => {
  it('offers the four voices as one radio row and reads the chosen one below it', async () => {
    mount()
    await screen.findByRole('radiogroup', { name: en.voice })
    const options = screen.getAllByRole('radio')
    expect(options.map(option => option.textContent)).toEqual([
      en['voice.automatic'], en['voice.warm'], en['voice.direct'], en['voice.playful'],
    ])
    expect(options[0]!.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(en['voice.automatic.description'])).toBeTruthy()
    // Only the chosen voice explains itself; the others are names on one track.
    expect(screen.queryByText(en['voice.warm.description'])).toBeNull()
  })

  it('saves a voice on the choice itself', async () => {
    const { update } = mount()
    await screen.findByRole('radiogroup', { name: en.voice })
    screen.getByRole('radio', { name: en['voice.warm'] }).click()
    await waitFor(() => { expect(update).toHaveBeenCalledWith({ voice: 'warm' }) })
  })

  it('enables the notes Save only while the notes differ, and saves them', async () => {
    const { update } = mount()
    const notes = await screen.findByLabelText(en.notes)
    const save = screen.getAllByRole('button', { name: en.save })[0]!
    expect(save.hasAttribute('disabled')).toBe(true)
    fireEvent.change(notes, { target: { value: 'Say less.' } })
    await waitFor(() => { expect(save.hasAttribute('disabled')).toBe(false) })
    save.click()
    await waitFor(() => { expect(update).toHaveBeenCalledWith({ notes: 'Say less.' }) })
    expect(await screen.findByText(en.saved)).toBeTruthy()
  })

  it('refuses to save notes over their bound', async () => {
    mount({ view: { notes: 'x'.repeat(49) } })
    const notes = await screen.findByLabelText(en.notes)
    fireEvent.change(notes, { target: { value: 'x'.repeat(60) } })
    const save = screen.getAllByRole('button', { name: en.save })[0]!
    await waitFor(() => { expect(save.hasAttribute('disabled')).toBe(true) })
    expect(screen.getByText('60 / 50')).toBeTruthy()
  })

  it('shows the master prompt on the page, on the text the sessions already carry', async () => {
    mount()
    const editor = (await screen.findByRole('textbox', { name: en.master })) as HTMLTextAreaElement
    expect(editor.value).toBe('You are Aeven.')
    expect(screen.getByText(en.masterDescription)).toBeTruthy()
    // Nothing to reset while the shipped prompt stands.
    expect(screen.getByRole('button', { name: en.masterReset }).hasAttribute('disabled')).toBe(true)
  })

  it('shows the badge and the reset action only for a person who changed the prompt', async () => {
    mount()
    await screen.findByRole('textbox', { name: en.master })
    expect(screen.queryByText(en.masterChanged)).toBeNull()
    cleanup()

    mount({ view: { masterPrompt: 'My prompt.', effectiveMasterPrompt: 'My prompt.', customMasterPrompt: true } })
    await screen.findByText(en.masterChanged)
    expect(screen.getByRole('button', { name: en.masterReset }).hasAttribute('disabled')).toBe(false)
  })

  it('resets to the shipped prompt and paints the shipped text again', async () => {
    const { resetMasterPrompt } = mount({
      view: { masterPrompt: 'My prompt.', effectiveMasterPrompt: 'My prompt.', customMasterPrompt: true },
    })
    await screen.findByText(en.masterChanged)
    screen.getByRole('button', { name: en.masterReset }).click()
    await waitFor(() => { expect(resetMasterPrompt).toHaveBeenCalled() })
    expect(await screen.findByText(en.reset)).toBeTruthy()
  })

  it('reports a failed read with a retry that reads again', async () => {
    const read = vi.fn<PersonalizationSectionProps['read']>(async () => { throw new Error('offline') })
    mount({ read })
    const retry = await screen.findByRole('button', { name: en.retry })
    expect(screen.getByText(new RegExp(en.failed))).toBeTruthy()
    read.mockResolvedValueOnce(VIEW)
    retry.click()
    expect(await screen.findByText(en['voice.automatic.description'])).toBeTruthy()
    expect(read).toHaveBeenCalledTimes(2)
  })
})
