// @vitest-environment jsdom
/**
 * Imagine's starter prompts: the grid, the popup a card opens, and the message
 * the composer receives from it. Choosing never generates on its own — the
 * popup writes the draft and stages the photos, and the reader sends. The
 * message itself is not shown in the popup, so these specs read it back off the
 * composer face it was written to.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState } from '@aeven/api-session-controller/client'
import type { InputState } from '@aeven/client-ui-conversation/client'
import type { SessionPendingInteractionSnapshot } from '@aeven/client-ui-session/client'
import type { SessionId } from '@aeven/session/types'
import {
  bindSnapshotSelector, chatSnapshot, conversationSnapshot, makeTranslate, sessionSnapshot, workspaceSnapshot,
} from '@aeven/client-test-runtime'
import { en as commonEn } from '@aeven/client-locale/src/locales/en.ts'
import { en } from '../src/client/locales.ts'
import { IMAGINE_PROMPTS } from '../src/client/prompts.ts'
import type { ImaginePrompt } from '../src/client/prompts.ts'
import { IMAGINE_LOOKS, IMAGINE_SCENES } from '../src/client/scenes.ts'
import { PromptDialog } from '../src/client/PromptDialog.tsx'
import { ImaginePrompts } from '../src/client/ImaginePrompts.tsx'

afterEach(cleanup)

// jsdom implements neither preview-URL verb.
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => `blob:staged-${String(Math.random()).slice(2)}`)
  URL.revokeObjectURL = vi.fn()
})

const EN_LOOK_LINES = IMAGINE_LOOKS.map(id => en[`create.look.${id}` as keyof typeof en])
const t = makeTranslate(en, commonEn)
const SID = 's1' as SessionId

/**
 * One observable source over a fixed snapshot: the selector hooks take a
 * source, and these seats never move.
 * @param value - the snapshot to serve.
 * @returns the source.
 */
function source<T>(value: T) {
  return { getSnapshot: () => value, subscribe: () => () => {} }
}

/** The starter prompt under test, by id. */
function prompt(id: ImaginePrompt['id']): ImaginePrompt {
  const found = IMAGINE_PROMPTS.find(entry => entry.id === id)
  if (found === undefined) throw new Error(`no starter prompt "${id}"`)
  return found
}

/** The composer input face the popup writes through. */
function inputFace() {
  return {
    setDraft: vi.fn(),
    appendText: vi.fn(() => true),
    addImages: vi.fn(() => true),
    addImageFiles: vi.fn<(files: readonly File[]) => string | null>(() => null),
    removeImage: vi.fn(),
    pruneImages: vi.fn(),
    submit: vi.fn(),
  }
}

/**
 * Every image the document holds. The popup portals into the body, and an
 * `alt=""` example image carries no accessible `img` role.
 */
function images(): readonly HTMLImageElement[] {
  return [...document.querySelectorAll('img')]
}

/**
 * The message the popup wrote into the composer.
 * @param actions - the composer face the popup applied through.
 * @returns the draft text of the last write, empty before any.
 */
function draftOf(actions: ReturnType<typeof inputFace>): string {
  return String(actions.setDraft.mock.calls[0]?.[0] ?? '')
}

describe('starter prompt popup', () => {
  it('shows the result with the original it started from, and writes the message on Try it', () => {
    const actions = inputFace()
    render(<PromptDialog prompt={prompt('instagram-retouch')} inputActions={actions} t={t} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Instagram improve' })).toBeTruthy()
    const sources = images().map(image => image.getAttribute('src') ?? '')
    expect(sources.some(src => src.endsWith('instagram-retouch-before.jpg'))).toBe(true)
    expect(sources.some(src => src.endsWith('instagram-retouch.jpg'))).toBe(true)
    // Both halves of the pair are named for what the reader is looking at.
    expect(screen.getByText('Before')).toBeTruthy()
    expect(screen.getByText('After')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try it' }))
    // The default frame is the 4:5 portrait, and the message asks for the photo.
    expect(draftOf(actions)).toContain('Generate one image at 1638x2048.')
    expect(draftOf(actions)).toContain("If I haven't attached a photo yet")
  })

  it('writes the size line of the ratio the reader chose', () => {
    const actions = inputFace()
    render(<PromptDialog prompt={prompt('instagram-retouch')} inputActions={actions} t={t} onClose={vi.fn()} />)
    expect(screen.getByText('1638x2048 px')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '1:1' }))
    expect(screen.getByText('2048x2048 px')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try it' }))
    expect(draftOf(actions)).toContain('2048x2048')
    expect(draftOf(actions)).not.toContain('1638x2048')
    fireEvent.click(screen.getByRole('button', { name: 'Auto' }))
    expect(screen.getByText('Matches your photo')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try it' }))
    expect(String(actions.setDraft.mock.calls[1]?.[0])).not.toContain('Generate one image at')
  })

  it('writes the message and stages the chosen photo, then closes', () => {
    const actions = inputFace()
    const close = vi.fn()
    render(<PromptDialog prompt={prompt('instagram-retouch')} inputActions={actions} t={t} onClose={close} />)
    const photo = new File([Uint8Array.of(1)], 'portrait.png', { type: 'image/png' })
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [photo] } })
    // The pair plus the staged photo's own tile.
    expect(images().length).toBe(3)
    fireEvent.click(screen.getByRole('button', { name: 'Try it' }))
    expect(actions.addImageFiles).toHaveBeenCalledWith([photo])
    expect(actions.setDraft).toHaveBeenCalledTimes(1)
    expect(actions.setDraft.mock.calls[0]?.[0]).toContain('Generate one image at 1638x2048.')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('keeps the popup open with the reason when the draft refuses the photo', () => {
    const actions = inputFace()
    actions.addImageFiles.mockReturnValue('Files cannot be added right now')
    const close = vi.fn()
    render(<PromptDialog prompt={prompt('instagram-retouch')} inputActions={actions} t={t} onClose={close} />)
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File([Uint8Array.of(1)], 'portrait.png', { type: 'image/png' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Try it' }))
    expect(screen.getByRole('alert').textContent).toBe('Files cannot be added right now')
    expect(actions.setDraft).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it('stages nothing and asks for no photo on a prompt that generates from text', () => {
    const actions = inputFace()
    const close = vi.fn()
    render(<PromptDialog prompt={prompt('watercolor')} inputActions={actions} t={t} onClose={close} />)
    expect(screen.getByText('Optional')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try it' }))
    expect(actions.addImageFiles).not.toHaveBeenCalled()
    expect(draftOf(actions)).toContain('quiet harbor town')
    expect(draftOf(actions)).not.toContain("If I haven't attached a photo yet")
    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('aerial view', () => {
  it("shows the reader's photo becoming the aerial frame, and sends the short command", () => {
    const actions = inputFace()
    render(<PromptDialog prompt={prompt('aerial-view')} inputActions={actions} t={t} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Aerial view' })).toBeTruthy()
    const sources = images().map(image => image.getAttribute('src') ?? '')
    expect(sources.some(src => src.endsWith('aerial-view-before.jpg'))).toBe(true)
    expect(sources.some(src => src.endsWith('aerial-view.jpg'))).toBe(true)
    expect(screen.getByText('Your photo')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try it' }))
    const text = draftOf(actions)
    expect(text).toContain('as a real drone photograph from high above')
    expect(text).toContain('not a miniature or tilt-shift effect')
    expect(text).toContain("If I haven't attached a photo yet")
    expect(text).toContain('Generate one image at 1638x2048.')
    // The point of this card: one ask and two guards, not a craft paragraph.
    expect(text.length).toBeLessThan(700)
  })

  it("drops the size line when the reader keeps their photo's own frame", () => {
    const actions = inputFace()
    render(<PromptDialog prompt={prompt('aerial-view')} inputActions={actions} t={t} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Auto' }))
    fireEvent.click(screen.getByRole('button', { name: 'Try it' }))
    expect(draftOf(actions)).not.toContain('Generate one image at')
    expect(draftOf(actions)).toContain('as a real drone photograph from high above')
  })

  it('stages the chosen photo and writes the draft', () => {
    const actions = inputFace()
    const close = vi.fn()
    render(<PromptDialog prompt={prompt('aerial-view')} inputActions={actions} t={t} onClose={close} />)
    const photo = new File([Uint8Array.of(1)], 'pool.png', { type: 'image/png' })
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [photo] } })
    fireEvent.click(screen.getByRole('button', { name: 'Try it' }))
    expect(actions.addImageFiles).toHaveBeenCalledWith([photo])
    expect(actions.setDraft).toHaveBeenCalledWith(expect.stringContaining('seen from directly above'.replace('seen from directly above', 'from high above')))
    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('instagram original', () => {
  /** Every scene line the composed prompt could carry. */
  const sceneLines = IMAGINE_SCENES.map(id => en[`create.scene.${id}` as keyof typeof en])
  /** The scene line the popup currently shows. */
  function sceneOf(text: string): string | undefined {
    return sceneLines.find(line => text.includes(line))
  }

  it('offers one guide image and no photo input', () => {
    render(
      <PromptDialog prompt={prompt('instagram-original')} inputActions={inputFace()} t={t} onClose={vi.fn()} />,
    )
    expect(screen.getByRole('dialog', { name: 'Instagram original' })).toBeTruthy()
    expect(images().some(one => (one.getAttribute('src') ?? '').endsWith('instagram-original.jpg'))).toBe(true)
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it('composes one scene and one grade into the fixed craft', () => {
    // The scene is drawn once per open: pin the draw so the composed message is
    // the same on every run.
    const draw = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      const actions = inputFace()
      render(<PromptDialog prompt={prompt('instagram-original')} inputActions={actions} t={t} onClose={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: 'Try it' }))
      const draft = draftOf(actions)
      expect(sceneOf(draft)).toBe(en[`create.scene.${IMAGINE_SCENES[0]}` as keyof typeof en])
      expect(draft).toContain(en['create.craft'])
      expect(draft).toContain('Generate one image at 1638x2048.')
      expect(draft).not.toContain("If I haven't attached a photo yet")
      expect(EN_LOOK_LINES.some(line => draft.includes(line))).toBe(true)
    } finally {
      draw.mockRestore()
    }
  })

  it('writes the composed prompt and stages nothing', () => {
    const actions = inputFace()
    const close = vi.fn()
    render(<PromptDialog prompt={prompt('instagram-original')} inputActions={actions} t={t} onClose={close} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try it' }))
    expect(actions.addImageFiles).not.toHaveBeenCalled()
    expect(actions.setDraft).toHaveBeenCalledWith(expect.stringContaining(en['create.craft']))
    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('video starters', () => {
  it('asks for a moving shot in a video frame, not an image', () => {
    const actions = inputFace()
    render(<PromptDialog prompt={prompt('video-coast')} inputActions={actions} t={t} onClose={vi.fn()} />)
    // The frame choices are the video model's, and they state no pixel tier.
    expect(screen.getByText('16:9 · 1080p')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '9:16' }))
    fireEvent.click(screen.getByRole('button', { name: 'Try it' }))
    const draft = draftOf(actions)
    expect(draft).toContain('rise-and-reveal')
    expect(draft).toContain('Generate one video, 9:16 at 1080p.')
    expect(draft).not.toContain('Generate one image')
  })
})

describe('video starter popup', () => {
  it('plays its own clip beside the frame choices', () => {
    render(<PromptDialog prompt={prompt('video-coast')} inputActions={inputFace()} t={t} onClose={vi.fn()} />)
    const clip = document.querySelector('video')
    expect(clip?.getAttribute('src') ?? '').toMatch(/coastline\.mp4$/)
    expect(clip?.autoplay).toBe(true)
    expect(clip?.muted).toBe(true)
    expect(clip?.loop).toBe(true)
  })
})

describe('starter prompt grid', () => {
  /**
   * Mount the grid with the framework's session kit: the seats the grid never
   * reads carry the runtime's own empty snapshots.
   * @param actions - the composer input face.
   * @returns the render result.
   */
  function mountGrid(actions: ReturnType<typeof inputFace>) {
    type GridProps = Parameters<typeof ImaginePrompts>[0]
    // `useTrajectory` takes the selector itself, so its snapshot type comes
    // from the hook's own parameter list.
    const trajectory: Parameters<Parameters<GridProps['useTrajectory']>[0]>[0] = {
      eventNodes: [], eventLocations: new Map(), requests: [], callSchemas: new Map(), partial: null, runningCalls: [],
    }
    const input: InputState = {
      draft: '', imageIds: [], draftRev: 0, phase: 'plain', occurrences: [], queue: [],
    }
    const list: SessionListState = {
      ids: [], byId: {}, current: SID, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    }
    const pending: SessionPendingInteractionSnapshot = new Map()
    return render(
      <ImaginePrompts
        inputActions={actions}
        useSession={bindSnapshotSelector(source(sessionSnapshot(SID)))}
        sessionId={SID}
        useConversation={bindSnapshotSelector(source(conversationSnapshot()))}
        useChat={bindSnapshotSelector(source(chatSnapshot()))}
        useInput={bindSnapshotSelector(source(input))}
        useTrajectory={selector => selector(trajectory)}
        useProjection={() => undefined}
        useSessions={bindSnapshotSelector(source(list))}
        useSessionPendingInteraction={bindSnapshotSelector(source(pending))}
        useWorkspaces={bindSnapshotSelector(source(workspaceSnapshot()))}
        t={t}
      />,
    )
  }

  it('leads with the create preset, then the retouch preset', () => {
    mountGrid(inputFace())
    const cards = screen.getAllByRole('button').map(button => button.textContent)
    expect(cards[0]).toBe('Instagram original')
    expect(cards[1]).toBe('Instagram improve')
    expect(cards[2]).toBe('Aerial view')
  })

  it('opens the clicked card as a popup and closes it again', () => {
    const actions = inputFace()
    mountGrid(actions)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Instagram improve' }))
    expect(screen.getByRole('dialog', { name: 'Instagram improve' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(actions.setDraft).not.toHaveBeenCalled()
  })

  it('plays a moving example in place of its still, silently and on a loop', () => {
    mountGrid(inputFace())
    const clip = document.querySelector('video')
    expect(clip?.getAttribute('src') ?? '').toMatch(/golden-turn\.mp4$/)
    expect(clip?.autoplay).toBe(true)
    expect(clip?.muted).toBe(true)
    expect(clip?.loop).toBe(true)
  })

  it('drops an example image that fails to load, keeping the card title-only', () => {
    mountGrid(inputFace())
    const cards = images().length
    const image = images().find(one => (one.getAttribute('src') ?? '').endsWith('instagram-retouch.jpg'))!
    fireEvent.error(image)
    expect(images().length).toBe(cards - 1)
    expect(images().some(one => (one.getAttribute('src') ?? '').endsWith('instagram-retouch.jpg'))).toBe(false)
    expect(screen.getByRole('button', { name: 'Instagram improve' })).toBeTruthy()
  })
})
