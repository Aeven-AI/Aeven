// @vitest-environment jsdom
/**
 * Prose file links: which file a scheme-less destination names, and how a
 * click opens it — the sidebar first, the Host's desktop where it is the
 * reader's own, and a browser download otherwise.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileLinkTarget, openProducedFile, producedFileLinks, type FileOpening } from '../src/client/file-links.ts'

const DIGEST = '86ec77a0b7a0a8e14f0f5528d3a6cebf4cb92c4c122c457030c0d5a80c82d566'

/** Records every anchor the module clicks to start a download. */
function captureDownloads(): string[] {
  const downloads: string[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.href)
  })
  return downloads
}

/** File routes that name their inputs, with a sidebar answer and desktop capability per test. */
function opening(previews: boolean, canOpenPath: boolean) {
  return {
    previewFile: vi.fn<FileOpening['previewFile']>(() => Promise.resolve(previews)),
    fileUrl: (path: string, download?: boolean) => `https://app.test/file?path=${path}${download === true ? '&download' : ''}`,
    attachmentUrl: (id: string, download?: boolean) => `https://app.test/attachment?id=${id}${download === true ? '&download' : ''}`,
    canOpenPath: () => canOpenPath,
    openFile: vi.fn<FileOpening['openFile']>(),
  } satisfies FileOpening
}

afterEach(() => { vi.restoreAllMocks() })

describe('fileLinkTarget', () => {
  it('reads a stored copy from its place in the attachment store', () => {
    const copy = { kind: 'attachment', attachmentId: `sha256:${DIGEST}` }
    expect(fileLinkTarget(`../attachments/86/${DIGEST}`, '/w')).toEqual(copy)
    expect(fileLinkTarget(`/home/avn/attachments/v1/objects/86/${DIGEST}`, '/w')).toEqual(copy)
    // A prefix that is not the digest's own is a path that only looks like the store.
    expect(fileLinkTarget(`attachments/ff/${DIGEST}`, undefined)).toEqual({ kind: 'path', path: `attachments/ff/${DIGEST}` })
  })

  it('reads any other destination as a workspace path, decoded and relative to the root', () => {
    expect(fileLinkTarget('Applications/Open/Letter%20Open.pdf', '/w')).toEqual({ kind: 'path', path: 'Applications/Open/Letter Open.pdf' })
    expect(fileLinkTarget('./out/cv.pdf', '/w')).toEqual({ kind: 'path', path: 'out/cv.pdf' })
    expect(fileLinkTarget('/w/out/cv.pdf', '/w/')).toEqual({ kind: 'path', path: 'out/cv.pdf' })
    expect(fileLinkTarget('/elsewhere/cv.pdf', '/w')).toEqual({ kind: 'path', path: '/elsewhere/cv.pdf' })
    expect(fileLinkTarget('100%.pdf', undefined)).toEqual({ kind: 'path', path: '100%.pdf' })
    // The root itself and an empty destination name no file.
    expect(fileLinkTarget('/w', '/w')).toBeUndefined()
    expect(fileLinkTarget('./', undefined)).toBeUndefined()
  })
})

describe('openProducedFile', () => {
  it('stops at the sidebar when it shows the file, passing the stored copy along', async () => {
    const downloads = captureDownloads()
    const routes = opening(true, true)
    openProducedFile({ path: 'clip.mp4', attachmentId: 'sha256:a' }, routes)
    await vi.waitFor(() => { expect(routes.previewFile).toHaveBeenCalledWith('clip.mp4', 'https://app.test/attachment?id=sha256:a') })
    await Promise.resolve()
    expect(routes.openFile).not.toHaveBeenCalled()
    expect(downloads).toEqual([])
  })

  it('opens on the desktop when the sidebar cannot, and downloads where the Host is not the reader\'s', async () => {
    const downloads = captureDownloads()
    const local = opening(false, true)
    openProducedFile({ path: 'cv.pdf' }, local)
    await vi.waitFor(() => { expect(local.openFile).toHaveBeenCalledWith('cv.pdf') })
    expect(downloads).toEqual([])

    openProducedFile({ path: 'cv.pdf' }, opening(false, false))
    openProducedFile({ path: 'cv.docx', attachmentId: 'sha256:b' }, opening(false, false))
    await vi.waitFor(() => {
      expect(downloads).toEqual([
        'https://app.test/file?path=cv.pdf&download',
        'https://app.test/attachment?id=sha256:b&download',
      ])
    })
  })
})

describe('producedFileLinks', () => {
  it('links a path to its workspace file and opens it the way a produced file opens', async () => {
    const downloads = captureDownloads()
    const routes = opening(false, false)
    const link = producedFileLinks('/w', () => [], routes).resolve('Applications/Open/Letter%20Open.pdf')
    expect(link?.href).toBe('https://app.test/file?path=Applications/Open/Letter Open.pdf')
    expect(link?.title).toBe('Applications/Open/Letter Open.pdf')
    link?.open()
    await vi.waitFor(() => { expect(downloads).toEqual(['https://app.test/file?path=Applications/Open/Letter%20Open.pdf&download']) })
    expect(routes.previewFile).toHaveBeenCalledWith('Applications/Open/Letter Open.pdf')
  })

  it('downloads a stored copy, which names no path the sidebar could show', () => {
    const downloads = captureDownloads()
    const routes = opening(true, true)
    const link = producedFileLinks('/w', () => [], routes).resolve(`../attachments/86/${DIGEST}`)
    expect(link?.href).toBe(`https://app.test/attachment?id=sha256:${DIGEST}`)
    expect(link?.title).toBeUndefined()
    link?.open()
    expect(downloads).toEqual([`https://app.test/attachment?id=sha256:${DIGEST}&download`])
    expect(routes.previewFile).not.toHaveBeenCalled()
  })

  it('opens a file the Turn produced from its stored copy, where the page cannot reach the Host', async () => {
    const downloads = captureDownloads()
    const routes = opening(false, false)
    const produced = [{ path: '/w/pdf-test/Motivation_Letter.pdf', attachmentId: 'sha256:c' }]
    const link = producedFileLinks('/w', () => produced, routes).resolve('pdf-test/Motivation_Letter.pdf')
    expect(link?.href).toBe('https://app.test/attachment?id=sha256:c')
    link?.open()
    await vi.waitFor(() => { expect(downloads).toEqual(['https://app.test/attachment?id=sha256:c&download']) })
    expect(routes.previewFile).toHaveBeenCalledWith('/w/pdf-test/Motivation_Letter.pdf', 'https://app.test/attachment?id=sha256:c')
    // Without a known root, a relative link names the one produced path ending in it, and two such paths name neither.
    const rootless = producedFileLinks(undefined, () => produced, routes).resolve('pdf-test/Motivation_Letter.pdf')
    expect(rootless?.href).toBe('https://app.test/attachment?id=sha256:c')
    const twice = [...produced, { path: '/elsewhere/pdf-test/Motivation_Letter.pdf', attachmentId: 'sha256:d' }]
    expect(producedFileLinks(undefined, () => twice, routes).resolve('pdf-test/Motivation_Letter.pdf')?.href)
      .toBe('https://app.test/file?path=pdf-test/Motivation_Letter.pdf')
    // A produced file without a copy keeps the workspace route, under the produced path.
    expect(producedFileLinks('/w', () => [{ path: '/w/a.pdf' }], routes).resolve('a.pdf')?.href).toBe('https://app.test/file?path=/w/a.pdf')
  })

  it('resolves nothing for a destination that names no file', () => {
    expect(producedFileLinks('/w', () => [], opening(true, true)).resolve('/w')).toBeUndefined()
  })
})
