/**
 * Which picture a file gets, by its extension. Each kind names the renderer that draws it.
 * @module @aeven/host-artifact-previews/kinds
 */

/** How a file's picture is made. */
export type PreviewKind =
  /** A web page, screenshotted in a headless browser. */
  | 'page'
  /** A PDF, its first page drawn by pdf.js. */
  | 'pdf'
  /** A picture, scaled down. */
  | 'image'
  /** An Office or iWork file, by the thumbnail it carries, else the PDF of the same name beside it. */
  | 'office'

const KIND_BY_EXTENSION: Readonly<Record<string, PreviewKind>> = {
  html: 'page', htm: 'page',
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image',
  docx: 'office', pptx: 'office', xlsx: 'office', key: 'office', pages: 'office', numbers: 'office',
}

/**
 * The extension of a path, lower case, without its dot.
 * @param path - a file path written with either separator.
 * @returns the extension, or an empty string when the name has none.
 */
export function extensionOf(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * The renderer a file needs.
 * @param path - a file path.
 * @returns its preview kind, or undefined when no renderer draws it.
 */
export function previewKind(path: string): PreviewKind | undefined {
  return KIND_BY_EXTENSION[extensionOf(path)]
}

/**
 * The path of the PDF with the same name beside a file, which the slides and CV skills export next to a deck or CV.
 * @param path - a file path.
 * @returns the sibling PDF's path.
 */
export function siblingPdf(path: string): string {
  const dot = path.lastIndexOf('.')
  return `${dot > Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) ? path.slice(0, dot) : path}.pdf`
}

/** A script a page loads from source that only a development server or a build turns into JavaScript. */
const SOURCE_SCRIPT = /<script\b[^>]*\bsrc\s*=\s*["']?[^"'\s>]+\.(?:tsx?|jsx|vue|svelte)(?:[?#][^"'\s>]*)?["']?/iu

/** A module script's import of a bare package name, which a browser resolves only through an import map. */
const BARE_IMPORT = /\bimport\s*(?:[\w*{}\s,]+from\s*)?["'](?![./]|https?:|data:|blob:)[^"']+["']/u

/** A template placeholder a build replaces, such as Create React App's. */
const BUILD_PLACEHOLDER = /%PUBLIC_URL%|%BASE_URL%/u

/** A refresh that sends the reader on to another address, as a redirect stub in front of a served app does. */
const REDIRECT = /<meta\b[^>]*\bhttp-equiv\s*=\s*["']?refresh["']?[^>]*\bcontent\s*=\s*["']?\s*\d+\s*;\s*url\s*=/iu

/**
 * Whether a page is the source of an app rather than a page that runs on its own: it loads TypeScript, JSX, Vue or
 * Svelte sources, imports a bare package name without an import map, carries a build placeholder, or redirects to
 * another address. Such a page draws nothing of its own until a development server or a build serves it, so it gets
 * no picture.
 * @param html - the page's text.
 * @returns true when the page needs a development server or a build.
 */
export function needsAppServer(html: string): boolean {
  if (SOURCE_SCRIPT.test(html) || BUILD_PLACEHOLDER.test(html) || REDIRECT.test(html)) return true
  if (/<script\b[^>]*\btype\s*=\s*["']?importmap/iu.test(html)) return false
  for (const match of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']?module["']?[^>]*>([\s\S]*?)<\/script>/giu)) {
    if (BARE_IMPORT.test(match[1] ?? '')) return true
  }
  return false
}
