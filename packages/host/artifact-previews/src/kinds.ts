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
