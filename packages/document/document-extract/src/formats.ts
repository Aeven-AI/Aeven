/** Extension resolution for submitted documents. @module @aeven/document-extract/formats */

/** Extensions implied by media types when a file name carries none. */
const MEDIA_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.oasis.opendocument.graphics': 'odg',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'application/epub+zip': 'epub',
  'text/csv': 'csv',
  'text/tab-separated-values': 'tsv',
  'text/markdown': 'md',
  'text/html': 'html',
  'text/plain': 'txt',
  'application/json': 'json',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'application/x-iwork-pages-sffpages': 'pages',
  'application/x-iwork-numbers-sffnumbers': 'numbers',
  'application/x-iwork-keynote-sffkey': 'key',
}

/**
 * Resolve the format extension of one submitted document.
 * @param name - display name, possibly without an extension.
 * @param mediaType - browser-declared media type, possibly empty.
 * @returns the lowercase extension without the dot, or an empty string when neither input names one.
 */
export function documentExtension(name: string, mediaType: string): string {
  const dot = name.lastIndexOf('.')
  if (dot > 0 && dot < name.length - 1) return name.slice(dot + 1).toLowerCase()
  return MEDIA_TYPE_EXTENSIONS[mediaType.toLowerCase()] ?? ''
}
