/**
 * The rendered view of a workspace HTML file: the page's own document with every workspace-relative stylesheet,
 * script, image and media source inlined, so it renders whole inside a frame sandboxed with `allow-scripts` alone.
 * ES modules are inlined too: each workspace module the page reaches, through relative imports or through its
 * import map, becomes one `data:` URL under a generated import map, and every import of it names that map's key.
 *
 * That frame has an opaque origin, so the page can neither reach the app's storage, cookies or `parent`, nor
 * navigate the top window, and it could not authenticate a request for its own files either: this module reads
 * them through the app instead, as the explorer's image view does, and hands them to the page as text or `data:`
 * URLs. Remote (`https:`) references load as written.
 * @module
 */

// The asm.js build: synchronous, no WebAssembly, so it runs under the client's content policy.
import { parse as parseModule } from 'es-module-lexer/js'

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
 * @param folder - folder of the referring file: workspace-relative, empty for the root, or absolute for a file
 * outside the workspace.
 * @param reference - the reference as written, without its query or fragment.
 * @returns the path, absolute when a relative reference starts from an absolute folder, or undefined for one that
 * climbs above its root.
 */
export function resolveReference(folder: string, reference: string): string | undefined {
  const clean = reference.split(/[?#]/)[0] ?? ''
  const rooted = clean.startsWith('/')
  const absolute = !rooted && folder.startsWith('/')
  const parts = rooted ? [] : folder.split('/').filter(part => part !== '')
  for (const part of decodeURIComponent(clean).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.pop() === undefined) return undefined
      continue
    }
    parts.push(part)
  }
  return (absolute ? '/' : '') + parts.join('/')
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

/** Import-map key prefix naming an inlined workspace module; a bare specifier, so only the generated map resolves it. */
const MODULE_KEY_PREFIX = '@avn-workspace/'

/** Where the page's import map sends bare specifiers: exact keys, and prefix keys ending in `/`. */
interface PageImportMap {
  readonly exact: ReadonlyMap<string, string>
  readonly prefixes: ReadonlyArray<readonly [key: string, target: string]>
}

/**
 * The page's `imports` table, read from its import map scripts, which leave the document: the generated map replaces
 * them. Scoped maps are not read.
 */
function takeImportMap(doc: Document): PageImportMap {
  const exact = new Map<string, string>()
  const prefixes: Array<readonly [string, string]> = []
  for (const script of doc.querySelectorAll('script[type="importmap"]')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(script.textContent)
    } catch {
      // A malformed map maps nothing, as the browser treats it.
      parsed = undefined
    }
    script.remove()
    const imports = typeof parsed === 'object' && parsed !== null ? (parsed as { imports?: unknown }).imports : undefined
    if (typeof imports !== 'object' || imports === null) continue
    for (const [key, target] of Object.entries(imports)) {
      if (typeof target !== 'string') continue
      if (key.endsWith('/')) prefixes.push([key, target])
      else exact.set(key, target)
    }
  }
  // The longest matching prefix wins, as in the browser.
  prefixes.sort((a, b) => b[0].length - a[0].length)
  return { exact, prefixes }
}

/**
 * The page's workspace ES modules, each read once and inlined as a `data:` URL keyed in the generated import map.
 * A module's imports are rewritten to keys rather than nested `data:` URLs, so a module many others import is
 * inlined once, and an import cycle needs no special case.
 */
class ModuleGraph {
  /** Generated import-map entries: module key → `data:` URL. */
  readonly entries = new Map<string, string>()
  private readonly seen = new Set<string>()
  private pending: Array<Promise<void>> = []

  constructor(private readonly inliner: Inliner, private readonly importMap: PageImportMap, private readonly pageFolder: string) {}

  /** The workspace path a specifier names from `folder`, or undefined for a remote, unmapped, or escaping one. */
  private resolve(specifier: string, folder: string): string | undefined {
    if (/^\.{0,2}\//.test(specifier)) return resolveReference(folder, specifier)
    if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) return undefined
    let target = this.importMap.exact.get(specifier)
    if (target === undefined) {
      const prefix = this.importMap.prefixes.find(([key]) => specifier.startsWith(key))
      if (prefix !== undefined) target = prefix[1] + specifier.slice(prefix[0].length)
    }
    // Import-map targets resolve against the page, as the browser resolves them against its base URL.
    return target !== undefined && isWorkspaceReference(target) ? resolveReference(this.pageFolder, target) : undefined
  }

  /** The import-map key of one workspace module. */
  private key(path: string): string {
    return MODULE_KEY_PREFIX + path.split('/').map(encodeURIComponent).join('/')
  }

  /**
   * Rewrite a module's workspace imports to their keys and queue each imported module for inlining.
   * @param source - the module's text.
   * @param folder - the folder its relative specifiers resolve against.
   * @returns the module text with every workspace specifier replaced by its key.
   */
  rewrite(source: string, folder: string): string {
    let imports: ReturnType<typeof parseModule>[0]
    try {
      imports = parseModule(source)[0]
    } catch {
      // Text the lexer cannot read is not a module this page can run; it stays as written and fails as it would.
      return source
    }
    let out = ''
    let at = 0
    for (const entry of imports) {
      // `d` is -1 for a static import, the dynamic import's offset for `import()`, and -2 for `import.meta`.
      if (entry.n === undefined || entry.d < -1) continue
      const path = this.resolve(entry.n, folder)
      if (path === undefined) continue
      this.include(path)
      const key = this.key(path)
      out += source.slice(at, entry.s) + (entry.d === -1 ? key : JSON.stringify(key))
      at = entry.e
    }
    return out + source.slice(at)
  }

  private include(path: string): void {
    if (this.seen.has(path)) return
    this.seen.add(path)
    this.pending.push(this.inliner.text(path).then(async (text) => {
      if (text === undefined) return
      const rewritten = this.rewrite(text, folderOf(path))
      this.entries.set(this.key(path), await dataUrl(new Blob([rewritten], { type: 'text/javascript' })))
    }))
  }

  /** Wait until every module reached so far, and every module those reach, is inlined. */
  async settle(): Promise<void> {
    while (this.pending.length > 0) await Promise.all(this.pending.splice(0))
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
  const modules = new ModuleGraph(inliner, takeImportMap(doc), folder)
  for (const script of doc.querySelectorAll<HTMLScriptElement>('script[type="module"]:not([src])')) {
    script.textContent = modules.rewrite(script.textContent, folder)
  }
  for (const script of doc.querySelectorAll<HTMLScriptElement>('script[src]')) {
    const reference = script.getAttribute('src') ?? ''
    const target = isWorkspaceReference(reference) ? resolveReference(folder, reference) : undefined
    if (target === undefined) continue
    const module = script.getAttribute('type') === 'module'
    work.push(inliner.text(target).then((text) => {
      if (text === undefined) return
      script.removeAttribute('src')
      // A module keeps its type and imports through the generated map; `</script` inside the text would end the
      // element early.
      const source = module ? modules.rewrite(text, folderOf(target)) : text
      script.textContent = source.replace(/<\/script/gi, '<\\/script')
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
  await modules.settle()
  signal.throwIfAborted()

  if (modules.entries.size > 0) {
    // The map must precede every module script, so it opens the head.
    const map = doc.createElement('script')
    map.setAttribute('type', 'importmap')
    map.textContent = JSON.stringify({ imports: Object.fromEntries(modules.entries) }).replace(/<\/script/gi, '<\\/script')
    doc.head.prepend(map)
  }

  const policy = doc.createElement('meta')
  policy.setAttribute('http-equiv', 'Content-Security-Policy')
  policy.setAttribute('content', PREVIEW_POLICY)
  doc.head.prepend(policy)
  return `<!doctype html>\n${doc.documentElement.outerHTML}`
}
