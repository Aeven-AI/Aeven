// @vitest-environment jsdom
/**
 * The rendered view of a workspace HTML page: its workspace stylesheets, scripts, images, and CSS `url()`s are
 * inlined, remote and inline references stay as written, and the document carries its own content policy.
 */
import { describe, expect, it } from 'vitest'
import { previewDocument, resolveReference } from '../src/client/preview.ts'

describe('resolveReference', () => {
  it.each([
    ['site', 'style.css', 'site/style.css'],
    ['site', './img/a.png', 'site/img/a.png'],
    ['site/pages', '../style.css', 'site/style.css'],
    ['site', '/assets/logo.svg', 'assets/logo.svg'],
    ['site', 'a%20b.png?v=2#top', 'site/a b.png'],
    ['', 'index.css', 'index.css'],
  ])('resolves %j + %j to %j', (folder, reference, path) => {
    expect(resolveReference(folder, reference)).toBe(path)
  })

  it('refuses a reference that climbs above the workspace root', () => {
    expect(resolveReference('site', '../../secret.css')).toBeUndefined()
  })
})

/** A reader over fixed workspace files, recording what it was asked for. */
function reader(files: Record<string, string | Blob>) {
  const asked: string[] = []
  const read = async (path: string): Promise<Blob | undefined> => {
    asked.push(path)
    const file = files[path]
    return file === undefined ? undefined : typeof file === 'string' ? new Blob([file]) : file
  }
  return { read, asked }
}

describe('previewDocument', () => {
  it('inlines the page workspace stylesheets, scripts, images, and stylesheet urls', async () => {
    const files = reader({
      'site/style.css': 'body { background: url("bg.png") }',
      'site/bg.png': new Blob(['PNG'], { type: 'image/png' }),
      'site/app.js': 'document.title = "ran"',
      'site/img/logo.png': new Blob(['LOGO'], { type: 'image/png' }),
    })
    const html = [
      '<html><head><link rel="stylesheet" href="style.css"><script src="app.js"></script></head>',
      '<body><img src="img/logo.png" alt="logo"></body></html>',
    ].join('')
    const page = await previewDocument(html, 'site/index.html', files.read, new AbortController().signal)
    const doc = new DOMParser().parseFromString(page, 'text/html')

    expect(doc.querySelector('link[rel="stylesheet"]')).toBeNull()
    expect(doc.querySelector('style')?.textContent).toMatch(/url\("data:image\/png;base64,/)
    const script = doc.querySelector('script')
    expect(script?.hasAttribute('src')).toBe(false)
    expect(script?.textContent).toBe('document.title = "ran"')
    expect(doc.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    expect(files.asked.sort()).toEqual(['site/app.js', 'site/bg.png', 'site/img/logo.png', 'site/style.css'])
  })

  it('leaves remote, inline, and missing references as written', async () => {
    const files = reader({})
    const html = '<link rel="stylesheet" href="https://cdn.example/a.css"><img src="data:image/gif;base64,R0"><img src="missing.png">'
    const page = await previewDocument(html, 'index.html', files.read, new AbortController().signal)
    const doc = new DOMParser().parseFromString(page, 'text/html')

    expect(doc.querySelector('link')?.getAttribute('href')).toBe('https://cdn.example/a.css')
    expect([...doc.querySelectorAll('img')].map(image => image.getAttribute('src'))).toEqual(['data:image/gif;base64,R0', 'missing.png'])
    expect(files.asked).toEqual(['missing.png'])
  })

  it('heads the document with a content policy and keeps an inlined script from closing its element', async () => {
    const files = reader({ 'x.js': 'const s = "</script><b>"' })
    const page = await previewDocument('<script src="x.js"></script>', 'index.html', files.read, new AbortController().signal)
    const doc = new DOMParser().parseFromString(page, 'text/html')

    expect(doc.head.firstElementChild?.getAttribute('http-equiv')).toBe('Content-Security-Policy')
    expect(doc.head.firstElementChild?.getAttribute('content')).toContain("default-src 'none'")
    expect(doc.querySelectorAll('script')).toHaveLength(1)
    expect(doc.querySelector('b')).toBeNull()
  })

  it('stops when the file view moves on', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(previewDocument('<p>hi</p>', 'index.html', reader({}).read, controller.signal)).rejects.toThrow()
  })
})
