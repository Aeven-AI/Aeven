/**
 * The rendered view of a workspace HTML file: the page's own document with every workspace-relative stylesheet,
 * script, image and media source inlined, so it renders whole inside a frame sandboxed with `allow-scripts` alone.
 *
 * That frame has an opaque origin, so the page can neither reach the app's storage, cookies or `parent`, nor
 * navigate the top window, and it could not authenticate a request for its own files either: this module reads
 * them through the app instead, as the explorer's image view does, and hands them to the page as text or `data:`
 * URLs. Remote (`https:`) references load as written.
 * @module
 */

/** Reads one workspace file's bytes for the page. */
export type AssetReader = (path: string, signal: AbortSignal) => Promise<Blob | undefined>

/** Inclusive byte cap on one inlined file; a larger one is left out of the page. */
const MAX_ASSET_BYTES = 8 * 1024 * 1024

/** Inclusive byte cap on everything one page inlines. */
const MAX_PAGE_BYTES = 32 * 1024 * 1024

/**
 * What the page may load. Its inlined files need inline styles, scripts and `data:` URLs; remote files load over
 * HTTPS. The frame's sandbox, not this policy, keeps the page away from the app.
 */
const PREVIEW_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' data: https:",
  "style-src 'unsafe-inline' data: https:",
  'img-src data: blob: https:',
  'media-src data: blob: https:',
  'font-src data: https:',
  'connect-src https:',
].join('; ')

/** Whether a reference names a workspace file rather than a remote address, a fragment or inline data. */
function isWorkspaceReference(reference: string): boolean {
  const value = reference.trim()
  return value !== '' && !value.startsWith('#') && !value.startsWith('//') && !/^[a-z][a-z0-9+.-]*:/i.test(value)
}

/**
 * Resolve a page reference to a workspace path.
 * @param folder - workspace-relative folder of the referring file; empty for the root.
 * @param reference - the reference as written, without its query or fragment.
 * @returns the workspace path, or undefined for one that climbs above the root.
 */
export function resolveReference(folder: string, reference: string): string | undefined {
  const clean = reference.split(/[?#]/)[0] ?? ''
  const parts = clean.startsWith('/') ? [] : folder.split('/').filter(part => part !== '')
  for (const part of decodeURIComponent(clean).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.pop() === undefined) return undefined
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

/** Folder of a workspace path. */
function folderOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

/** A blob as a `data:` URL. */
function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => { resolve(typeof reader.result === 'string' ? reader.result : '') }
    reader.onerror = () => { reject(reader.error ?? new Error('read failed')) }
    reader.readAsDataURL(blob)
  })
}

/** One page's inlining budget and reader. */
class Inliner {
  private bytes = 0

  constructor(private readonly read: AssetReader, private readonly signal: AbortSignal) {}

  /** One workspace file within budget, or undefined when it is missing or too large. */
  private async blob(path: string): Promise<Blob | undefined> {
    const blob = await this.read(path, this.signal).catch(() => undefined)
    if (blob === undefined || blob.size > MAX_ASSET_BYTES || this.bytes + blob.size > MAX_PAGE_BYTES) return undefined
    this.bytes += blob.size
    return blob
  }

  async text(path: string): Promise<string | undefined> {
    return (await this.blob(path))?.text()
  }

  async url(path: string): Promise<string | undefined> {
    const blob = await this.blob(path)
    return blob === undefined ? undefined : dataUrl(blob)
  }

  /** A stylesheet with its workspace `url(...)` references inlined, resolved against the stylesheet's own folder. */
  async css(text: string, folder: string): Promise<string> {
    const pattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g
    const found = [...text.matchAll(pattern)]
    const urls = await Promise.all(found.map(async (match) => {
      const reference = match[2] ?? ''
      if (!isWorkspaceReference(reference)) return undefined
      const path = resolveReference(folder, reference)
      return path === undefined ? undefined : this.url(path)
    }))
    let index = 0
    return text.replace(pattern, (whole) => {
      const url = urls[index++]
      return url === undefined ? whole : `url("${url}")`
    })
  }
}

/** Attributes holding one workspace file the page shows, by element. */
const MEDIA_ATTRIBUTES: ReadonlyArray<readonly [selector: string, attribute: string]> = [
  ['img[src]', 'src'],
  ['source[src]', 'src'],
  ['video[src]', 'src'],
  ['video[poster]', 'poster'],
  ['audio[src]', 'src'],
  ['track[src]', 'src'],
  ['input[type="image"][src]', 'src'],
  ['link[rel~="icon"][href]', 'href'],
]

/**
 * Build the document a sandboxed frame renders for one workspace HTML file.
 * @param html - the file's text.
 * @param path - the file's workspace path, which its relative references resolve against.
 * @param read - reads one workspace file's bytes.
 * @param signal - abandons the build when the file view moves on.
 * @returns the complete document for the frame's `srcdoc`.
 */
export async function previewDocument(html: string, path: string, read: AssetReader, signal: AbortSignal): Promise<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const folder = folderOf(path)
  const inliner = new Inliner(read, signal)
  const work: Array<Promise<void>> = []

  for (const link of doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]')) {
    const reference = link.getAttribute('href') ?? ''
    const target = isWorkspaceReference(reference) ? resolveReference(folder, reference) : undefined
    if (target === undefined) continue
    work.push(inliner.text(target).then(async (text) => {
      if (text === undefined) return
      const style = doc.createElement('style')
      const media = link.getAttribute('media')
      if (media !== null) style.setAttribute('media', media)
      style.textContent = await inliner.css(text, folderOf(target))
      link.replaceWith(style)
    }))
  }
  for (const style of doc.querySelectorAll('style')) {
    const text = style.textContent
    work.push(inliner.css(text, folder).then((inlined) => { style.textContent = inlined }))
  }
  for (const script of doc.querySelectorAll<HTMLScriptElement>('script[src]')) {
    const reference = script.getAttribute('src') ?? ''
    const target = isWorkspaceReference(reference) ? resolveReference(folder, reference) : undefined
    if (target === undefined) continue
    work.push(inliner.text(target).then((text) => {
      if (text === undefined) return
      script.removeAttribute('src')
      // An inline module or classic script keeps its type; `</script` inside the text would end the element early.
      script.textContent = text.replace(/<\/script/gi, '<\\/script')
    }))
  }
  for (const [selector, attribute] of MEDIA_ATTRIBUTES) {
    for (const element of doc.querySelectorAll(selector)) {
      const reference = element.getAttribute(attribute) ?? ''
      const target = isWorkspaceReference(reference) ? resolveReference(folder, reference) : undefined
      if (target === undefined) continue
      work.push(inliner.url(target).then((url) => { if (url !== undefined) element.setAttribute(attribute, url) }))
    }
  }
  for (const element of doc.querySelectorAll<HTMLElement>('[style]')) {
    const text = element.getAttribute('style') ?? ''
    if (!text.includes('url(')) continue
    work.push(inliner.css(text, folder).then((inlined) => { element.setAttribute('style', inlined) }))
  }
  await Promise.all(work)
  signal.throwIfAborted()

  const policy = doc.createElement('meta')
  policy.setAttribute('http-equiv', 'Content-Security-Policy')
  policy.setAttribute('content', PREVIEW_POLICY)
  doc.head.prepend(policy)
  return `<!doctype html>\n${doc.documentElement.outerHTML}`
}
