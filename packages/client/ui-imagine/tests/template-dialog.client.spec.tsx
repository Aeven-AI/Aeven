// @vitest-environment jsdom
/**
 * The template popup the Slides and Resumes cards open: every slide or page
 * pages through, and `Use template` writes a request for that template into the
 * composer, attaching the reader's material first when they added some. The
 * popup sends nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@aeven/client-test-runtime'
import { en as commonEn } from '@aeven/client-locale/src/locales/en.ts'
import { en } from '../src/client/locales.ts'
import { TemplateDialog } from '../src/client/TemplateDialog.tsx'
import type { OpenTemplate } from '../src/client/TemplateDialog.tsx'
import { RESUME_TEMPLATES } from '../src/client/resumes.ts'

afterEach(cleanup)

// jsdom has no layout, so the strip's follow-the-picture scroll is a no-op here.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

const t = makeTranslate(en, commonEn)

/** The composer input face the popup writes through. */
function inputFace(refusal: string | null = null) {
  return {
    setDraft: vi.fn(),
    appendText: vi.fn(() => true),
    addImages: vi.fn(() => true),
    addImageFiles: vi.fn<(files: readonly File[]) => string | null>(() => null),
    addFiles: vi.fn<(files: readonly File[]) => string | null>(() => refusal),
    removeImage: vi.fn(),
    pruneImages: vi.fn(),
    submit: vi.fn(),
  }
}

/**
 * Open one template's popup.
 * @param template - the gallery and template.
 * @param actions - the composer input face.
 * @returns the close handler the popup was given.
 */
function open(template: OpenTemplate, actions: ReturnType<typeof inputFace>) {
  const onClose = vi.fn()
  render(<TemplateDialog template={template} inputActions={actions} t={t} onClose={onClose} />)
  return onClose
}

/** Stage files through the popup's hidden picker. */
function pick(...files: File[]): void {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (input === null) throw new Error('no file picker')
  fireEvent.change(input, { target: { files } })
}

describe('resume template popup', () => {
  it('pages through every page of the sample resume', () => {
    open({ kind: 'resumes', id: 'black' }, inputFace())
    const pages = RESUME_TEMPLATES.find(item => item.id === 'black')?.pages ?? 0
    expect(screen.getByRole('dialog', { name: 'Black' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Page \d+ of \d+$/ })).toHaveLength(pages)
    expect(screen.getByRole('img', { name: `Page 1 of ${pages}` }).getAttribute('src')).toMatch(/cv-templates\/black\/page-01\.webp$/)
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByRole('img', { name: `Page 2 of ${pages}` }).getAttribute('src')).toMatch(/cv-templates\/black\/page-02\.webp$/)
  })

  it('offers a resume and a portrait photo as starting material', () => {
    open({ kind: 'resumes', id: 'white' }, inputFace())
    const accept = document.querySelector<HTMLInputElement>('input[type="file"]')?.accept ?? ''
    expect(accept.split(',')).toEqual(expect.arrayContaining(['.pdf', '.docx', '.pages', '.jpg', '.png']))
    expect(screen.getByText('Your resume (PDF, Word or Pages) and a portrait photo')).toBeTruthy()
  })

  it('writes a request for a resume in the template and closes, attaching nothing', () => {
    const actions = inputFace()
    const onClose = open({ kind: 'resumes', id: 'black' }, actions)
    fireEvent.click(screen.getByRole('button', { name: 'Use template' }))
    expect(actions.addFiles).not.toHaveBeenCalled()
    expect(actions.setDraft).toHaveBeenCalledWith(expect.stringContaining('in the Black resume template'))
    expect(actions.submit).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('attaches the current resume and photo, then asks for it rebuilt in the template', () => {
    const actions = inputFace()
    open({ kind: 'resumes', id: 'white' }, actions)
    const cv = new File(['cv'], 'cv.pdf', { type: 'application/pdf' })
    const photo = new File(['photo'], 'me.jpg', { type: 'image/jpeg' })
    pick(cv, photo)
    expect(screen.getByText('cv.pdf')).toBeTruthy()
    expect(screen.getByText('me.jpg')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use template' }))
    expect(actions.addFiles).toHaveBeenCalledWith([cv, photo])
    expect(actions.setDraft).toHaveBeenCalledWith(expect.stringContaining('the attached photo as the portrait'))
  })

  it('keeps the popup open with the reason when the draft refuses the files', () => {
    const actions = inputFace('Too many files')
    const onClose = open({ kind: 'resumes', id: 'black' }, actions)
    pick(new File(['cv'], 'cv.pdf'))
    fireEvent.click(screen.getByRole('button', { name: 'Use template' }))
    expect(screen.getByRole('alert').textContent).toBe('Too many files')
    expect(actions.setDraft).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('slide template popup', () => {
  it('still pages slides and asks for a presentation', () => {
    const actions = inputFace()
    open({ kind: 'slides', id: 'lush-lux' }, actions)
    expect(screen.getAllByRole('button', { name: /^Slide \d+ of \d+$/ })).toHaveLength(20)
    fireEvent.click(screen.getByRole('button', { name: 'Use template' }))
    expect(actions.setDraft).toHaveBeenCalledWith(expect.stringContaining('in the Lush Lux slide template'))
  })
})
