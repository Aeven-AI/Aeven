// @vitest-environment jsdom
/**
 * The Artifacts page: cards arrive page by page until the Host has read every conversation, a kind pill
 * narrows them, a card opens its artifact, and a Host that cannot be reached offers a retry.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@aeven/client-test-runtime'
import type { Artifact, ArtifactCursor, ArtifactId, ArtifactListValue } from '@aeven/host-artifacts/types'
import { ArtifactsPage } from '../src/client/ArtifactsPage.tsx'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en)

/** A fresh list memory per mount, as the plugin keeps one per app. */
function keptList(initial?: readonly Artifact[]) {
  let kept = initial
  return { read: () => kept, keep: (items: readonly Artifact[]) => { kept = items } }
}

beforeAll(() => {
  // The page measures its own width; jsdom has no layout to observe.
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
})

afterEach(() => { cleanup() })

function artifact(name: string, kind: Artifact['kind']): Artifact {
  return { id: name as ArtifactId, sessionId: 'session-1' as Artifact['sessionId'], path: `/work/${name}`, name, title: name, kind, createdAt: Date.now() }
}

function mount(
  list: (cursor?: ArtifactCursor) => Promise<ArtifactListValue | null>,
  loadText: (artifact: Artifact) => Promise<string | undefined> = async () => '# Plan\n\nShip it',
) {
  const open = vi.fn()
  const props = { t, list, open, hrefOf: (item: Artifact) => `/c/x#file=${item.path}`, previewUrls: () => [], loadMotion: async () => undefined, loadText, lastList: keptList() }
  const Page = ArtifactsPage as unknown as (p: typeof props) => ReturnType<typeof ArtifactsPage>
  render(<Page {...props} />)
  return { open }
}

describe('artifacts page', () => {
  it('reads every page and shows one card per artifact', async () => {
    const list = vi.fn(async (cursor?: ArtifactCursor): Promise<ArtifactListValue> => (cursor === undefined
      ? { items: [artifact('plan.md', 'document')], nextCursor: 'next' as ArtifactCursor, scanned: 1, total: 2 }
      : { items: [artifact('deck.pptx', 'slides')], nextCursor: null, scanned: 2, total: 2 }))
    mount(list)

    await waitFor(() => { expect(screen.getByRole('link', { name: 'Open deck.pptx' })).toBeTruthy() })
    expect(screen.getByRole('link', { name: 'Open plan.md' })).toBeTruthy()
    expect(list).toHaveBeenCalledTimes(2)
    expect(list).toHaveBeenLastCalledWith('next')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('narrows the cards to the chosen kind and opens a card', async () => {
    const deck = artifact('deck.pptx', 'slides')
    const { open } = mount(async () => ({ items: [artifact('plan.md', 'document'), deck], nextCursor: null, scanned: 1, total: 1 }))
    await waitFor(() => { expect(screen.getByRole('link', { name: 'Open plan.md' })).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: 'Slides' }))
    expect(screen.queryByRole('link', { name: 'Open plan.md' })).toBeNull()
    const card = screen.getByRole('link', { name: 'Open deck.pptx' })
    expect(card.getAttribute('href')).toBe('/c/x#file=/work/deck.pptx')
    fireEvent.click(card)
    expect(open).toHaveBeenCalledWith(deck)
    // A modified click is the browser's: it opens the address in a new tab.
    open.mockClear()
    fireEvent.click(card, { metaKey: true })
    expect(open).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Videos' }))
    expect(screen.getByText('Nothing of this kind yet.')).toBeTruthy()
  })

  it('says so when nothing was made yet', async () => {
    mount(async () => ({ items: [], nextCursor: null, scanned: 0, total: 0 }))
    await waitFor(() => { expect(screen.getByText('Everything Æven makes shows up here.')).toBeTruthy() })
  })

  it('offers a retry when the Host cannot be reached', async () => {
    let reachable = false
    mount(async () => (reachable ? { items: [artifact('plan.md', 'document')], nextCursor: null, scanned: 1, total: 1 } : null))
    await waitFor(() => { expect(screen.getByText('Could not load your artifacts.')).toBeTruthy() })

    reachable = true
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => { expect(screen.getByRole('link', { name: 'Open plan.md' })).toBeTruthy() })
  })
})

describe('text cards', () => {
  it('sets a Markdown file\'s opening in its card, with a spinner until it arrives', async () => {
    mount(async () => ({ items: [artifact('notes.md', 'document')], nextCursor: null, scanned: 1, total: 1 }))
    const card = await screen.findByRole('link', { name: 'Open notes.md' })
    await waitFor(() => { expect(card.textContent).toContain('Ship it') })
    expect(card.getAttribute('data-state')).toBe('paper')
    expect(card.querySelector('[data-level="1"]')?.textContent).toBe('Plan')
  })
})

describe('files no longer here', () => {
  it('keeps them out of the grid, lists them under their own pill, and loads nothing for them', async () => {
    const loadText = vi.fn(async (_artifact: Artifact) => 'text')
    const gone: Artifact = { ...artifact('old.md', 'document'), missing: true }
    const copied: Artifact = { ...artifact('photo.png', 'image'), missing: true, attachmentId: 'att-1' }
    mount(async () => ({ items: [artifact('plan.md', 'document'), gone, copied], nextCursor: null, scanned: 1, total: 1 }), loadText)
    await screen.findByRole('link', { name: 'Open plan.md' })
    // A file whose stored copy remains still shows from the copy.
    expect(screen.getByRole('link', { name: 'Open photo.png' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Open old.md' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Not on this device (1)' }))
    const card = screen.getByRole('link', { name: 'Open old.md' })
    expect(card.textContent).toContain('File no longer on this device')
    expect(card.getAttribute('data-state')).toBe('paper')
    expect(loadText.mock.calls.some(([item]) => item.name === 'old.md')).toBe(false)
  })
})

describe('returning to the page', () => {
  it('shows the last list at once and replaces it when the fresh read completes', async () => {
    let finish: (value: ArtifactListValue) => void = () => {}
    const list = vi.fn(() => new Promise<ArtifactListValue>((resolve) => { finish = resolve }))
    const kept = keptList([artifact('old.md', 'document')])
    const props = { t, list, open: vi.fn(), hrefOf: () => '#', previewUrls: () => [], loadMotion: async () => undefined, loadText: async () => 'x', lastList: kept }
    const Page = ArtifactsPage as unknown as (p: typeof props) => ReturnType<typeof ArtifactsPage>
    render(<Page {...props} />)
    expect(screen.getByRole('link', { name: 'Open old.md' })).toBeTruthy()

    finish({ items: [artifact('new.md', 'document')], nextCursor: null, scanned: 1, total: 1 })
    await screen.findByRole('link', { name: 'Open new.md' })
    expect(screen.queryByRole('link', { name: 'Open old.md' })).toBeNull()
    expect(kept.read()?.map(item => item.name)).toEqual(['new.md'])
  })
})
