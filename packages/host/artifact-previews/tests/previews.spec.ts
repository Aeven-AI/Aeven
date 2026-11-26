/**
 * Artifact previews: which renderer a file gets, the thumbnail an Office or iWork file carries, the cache that draws
 * each version once, the queue that bounds drawings, and a PDF's first page drawn in the worker.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import {
  DrawingQueue, PreviewCache, embeddedThumbnail, previewKey, previewKind, siblingPdf,
} from '@aeven/host-artifact-previews'
import { drawPdf } from '@aeven/host-artifact-previews/src/pdf.ts'
import { serveFolder } from '@aeven/host-artifact-previews/src/folder-server.ts'
import { mkdir, symlink, writeFile } from 'node:fs/promises'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'artifact-previews-'))
  dirs.push(dir)
  return dir
}

describe('renderer choice', () => {
  it('picks a renderer by extension and none for source files', () => {
    expect(previewKind('/a/Site/INDEX.HTML')).toBe('page')
    expect(previewKind('deck.pdf')).toBe('pdf')
    expect(previewKind('notes.md')).toBeUndefined()
    expect(previewKind('deck.key')).toBe('office')
    expect(previewKind('photo.jpeg')).toBe('image')
    expect(previewKind('src/main.ts')).toBeUndefined()
    expect(previewKind('clip.mp4')).toBeUndefined()
  })

  it('names the PDF exported beside a deck', () => {
    expect(siblingPdf('/p/series-a/deck.pptx')).toBe('/p/series-a/deck.pdf')
    expect(siblingPdf('C:\\cv\\cv.docx')).toBe('C:\\cv\\cv.pdf')
  })
})

describe('embedded thumbnails', () => {
  it('reads the preview an iWork or Office file carries, best entry first', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1])
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    expect(embeddedThumbnail(zipSync({ 'Index/Document.iwa': new Uint8Array([1]), 'preview.jpg': jpeg }))).toEqual(jpeg)
    expect(embeddedThumbnail(zipSync({ 'docProps/thumbnail.png': png, 'preview.jpg': jpeg }))).toEqual(jpeg)
    expect(embeddedThumbnail(zipSync({ 'docProps/thumbnail.png': png }))).toEqual(png)
  })

  it('finds none in a container without one or in a file that is no zip', () => {
    expect(embeddedThumbnail(zipSync({ 'word/document.xml': new Uint8Array([1]) }))).toBeUndefined()
    expect(embeddedThumbnail(new TextEncoder().encode('not a zip'))).toBeUndefined()
  })
})

describe('preview cache', () => {
  it('draws a version once, for every concurrent and later request', async () => {
    const cache = new PreviewCache(await scratch())
    let draws = 0
    const draw = async (): Promise<Uint8Array> => {
      draws += 1
      await new Promise(resolve => setTimeout(resolve, 5))
      return new Uint8Array([1, 2, 3])
    }
    const key = previewKey(['v', 1])
    const [a, b] = await Promise.all([cache.get(key, draw), cache.get(key, draw)])
    expect(a).toEqual(new Uint8Array([1, 2, 3]))
    expect(b).toEqual(a)
    expect(await new PreviewCache((cache as unknown as { root: string }).root).get(key, draw)).toEqual(a)
    expect(draws).toBe(1)
  })

  it('records that a version has no picture, and does not record a drawing that failed', async () => {
    const root = await scratch()
    const cache = new PreviewCache(root)
    let draws = 0
    expect(await cache.get('aa-none', async () => { draws += 1; return 'none' })).toBe('none')
    expect(await cache.get('aa-none', async () => { draws += 1; return new Uint8Array([9]) })).toBe('none')
    expect(draws).toBe(1)

    await expect(cache.get('bb-fail', () => Promise.reject(new Error('no browser')))).rejects.toThrow('no browser')
    expect(await cache.get('bb-fail', async () => new Uint8Array([7]))).toEqual(new Uint8Array([7]))
    // Only finished files remain; no temporary write is left behind.
    expect((await readdir(join(root, 'bb'))).every(name => !name.endsWith('.tmp'))).toBe(true)
  })

  it('keys a version by everything that changes its picture', () => {
    expect(previewKey(['page', '/a.html', 'v1', 10])).not.toBe(previewKey(['page', '/a.html', 'v2', 10]))
    expect(previewKey(['page', '/a.html', 'v1', 10])).toBe(previewKey(['page', '/a.html', 'v1', 10]))
  })
})

describe('drawing queue', () => {
  it('runs at most its limit at once', async () => {
    const queue = new DrawingQueue(2)
    let running = 0
    let most = 0
    await Promise.all(Array.from({ length: 6 }, () => queue.run(async () => {
      running += 1
      most = Math.max(most, running)
      await new Promise(resolve => setTimeout(resolve, 5))
      running -= 1
    })))
    expect(most).toBe(2)
  })
})

/** A one-page PDF with a filled rectangle, written out with its cross-reference table. */
function onePagePdf(): Uint8Array {
  const content = '0 0 1 rg 50 50 200 300 re f'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R >>',
    `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`,
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(body.length)
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`
  return new TextEncoder().encode(body)
}

describe('PDF first page', () => {
  it('draws the first page at card size as WebP in the worker', async () => {
    const limits = { timeoutMs: 20_000, maxHeapMb: 256 }
    const image = await drawPdf(onePagePdf(), { width: 120, height: 150, quality: 80 }, limits, new AbortController().signal)
    const text = new TextDecoder().decode(image.subarray(0, 16))
    expect(text.startsWith('RIFF')).toBe(true)
    expect(text.slice(8, 12)).toBe('WEBP')
  }, 30_000)

  it('rejects a file that is no PDF', async () => {
    await expect(drawPdf(new TextEncoder().encode('nope'), { width: 120, height: 150, quality: 80 }, { timeoutMs: 20_000, maxHeapMb: 256 }, new AbortController().signal))
      .rejects.toThrow()
  }, 30_000)
})

describe('folder server', () => {
  it('serves the folder\'s files and nothing outside it', async () => {
    const base = await scratch()
    const site = join(base, 'site')
    await mkdir(join(site, 'js'), { recursive: true })
    await writeFile(join(site, 'index.html'), '<p>hi</p>')
    await writeFile(join(site, 'js', 'app.js'), 'export {}')
    await writeFile(join(base, 'secret.txt'), 'secret')
    await symlink(join(base, 'secret.txt'), join(site, 'link.txt'))
    const server = await serveFolder(site)
    try {
      const page = await fetch(`${server.origin}/index.html`)
      expect(page.status).toBe(200)
      expect(page.headers.get('content-type')).toContain('text/html')
      expect((await fetch(`${server.origin}/js/app.js`)).headers.get('content-type')).toContain('text/javascript')
      for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/link.txt', '/js', '/missing.html']) {
        expect((await fetch(`${server.origin}${path}`)).status).toBe(404)
      }
      expect((await fetch(`${server.origin}/index.html`, { method: 'POST' })).status).toBe(405)
    } finally {
      await server.close()
    }
  })
})
