/**
 * File intake on the public input face: a slot component's own upload (such as
 * Imagine's preset reference picker) registers images through the same intake
 * the composer's attach control uses, and a draft that cannot take them keeps
 * nothing.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { DraftAttachmentId, SubmitOutcome } from '../src/client/contract/input.ts'
import type { DraftImageIntake } from '../src/client/input/facade.ts'
import { SessionInputShell } from '../src/client/input/facade.ts'

/** One chosen file, with the media type the intake validates. */
function png(name: string): File {
  return new File([Uint8Array.of(1, 2, 3)], name, { type: 'image/png' })
}

/**
 * A shell over a scripted intake.
 * @param intake - the registration outcome each call answers.
 * @param options - whether a never-settling command submit locks the draft first.
 * @returns the shell plus the intake's spies.
 */
function bench(intake: DraftImageIntake, options?: { locked?: boolean }) {
  const create = vi.fn(() => intake)
  const release = vi.fn()
  const busyNotice = vi.fn(() => 'file-busy')
  const sink = vi.fn(() => Promise.resolve<SubmitOutcome>({ kind: 'success' }))
  const shell = new SessionInputShell({
    actx: {} as Context,
    defaultSink: sink,
    commandImages: {
      serialize: () => Promise.resolve([]),
      release: () => {},
      unsupportedNotice: (token: string) => `${token.trim()} images-unsupported`,
    },
    draftImages: { create, release, busyNotice },
  })
  if (options?.locked === true) {
    // A claimed enter whose submit never settles is the cheapest real lock:
    // the machine sits in 'submitting', the phase every draft write refuses.
    const token = '/goal '
    shell.setDraft(token)
    shell.beginCommand(
      { token, hint: 'goal', submit: () => new Promise<never>(() => {}) },
      { start: 0, end: token.length, draftRev: shell.snapshot.draftRev },
    )
    shell.submit('queue')
  }
  return { shell, create, release, busyNotice }
}

describe('input face image intake', () => {
  it('leaves the draft and the intake alone for an empty batch', () => {
    const b = bench({ kind: 'created', ids: [] as readonly DraftAttachmentId[] })
    expect(b.shell.addImageFiles([])).toBeNull()
    expect(b.create).not.toHaveBeenCalled()
    expect(b.shell.snapshot.imageIds).toEqual([])
  })

  it('appends the registered images in order and answers no notice', () => {
    const b = bench({ kind: 'created', ids: ['a' as DraftAttachmentId, 'b' as DraftAttachmentId] })
    expect(b.shell.addImageFiles([png('one.png'), png('two.png')])).toBeNull()
    expect(b.create).toHaveBeenCalledTimes(1)
    expect(b.shell.snapshot.imageIds).toEqual(['a', 'b'])
    expect(b.shell.actions.addImageFiles([png('three.png')])).toBeNull()
    expect(b.shell.snapshot.imageIds).toEqual(['a', 'b', 'a', 'b'])
  })

  it('surfaces the intake refusal and leaves the draft untouched', () => {
    const b = bench({ kind: 'refused', message: 'only images' })
    expect(b.shell.addImageFiles([png('notes.txt.png')])).toBe('only images')
    expect(b.shell.snapshot.imageIds).toEqual([])
    expect(b.release).not.toHaveBeenCalled()
  })

  it('frees the images a locked draft refused and answers the busy notice', () => {
    const b = bench({ kind: 'created', ids: ['a' as DraftAttachmentId] }, { locked: true })
    expect(b.shell.addImageFiles([png('one.png')])).toBe('file-busy')
    expect(b.release).toHaveBeenCalledWith(['a'])
    expect(b.shell.snapshot.imageIds).toEqual([])
  })
})
