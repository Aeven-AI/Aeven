/** Formats the in-process JavaScript readers cover. @module @aeven/document-extract-js/formats */

import type { DocumentFormats } from '@aeven/document-extract'

/** Plain-text and source-code extensions decoded as UTF-8. */
export const TEXT_EXTENSIONS: readonly string[] = [
  'txt', 'text', 'log', 'md', 'markdown', 'mdx', 'rst', 'adoc', 'tex', 'bib',
  'json', 'jsonl', 'ndjson', 'xml', 'svg', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties',
  'csv', 'tsv',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte', 'astro',
  'css', 'scss', 'sass', 'less',
  'py', 'rb', 'php', 'java', 'kt', 'kts', 'swift', 'rs', 'go', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'cs',
  'm', 'mm', 'scala', 'dart', 'lua', 'r', 'pl', 'pm', 'ex', 'exs', 'erl', 'hs', 'clj', 'elm', 'zig', 'nim',
  'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'sql', 'graphql', 'gql', 'proto', 'dockerfile', 'makefile', 'gradle',
]

/** Extensions read by the structured readers. */
export const STRUCTURED_EXTENSIONS: readonly string[] = [
  'pdf',
  'docx', 'docm', 'dotx',
  'xlsx', 'xlsm', 'xlsb', 'xls', 'ods', 'numbers',
  'pptx', 'pptm', 'potx', 'odp', 'otp',
  'odt', 'ott',
  'rtf', 'epub', 'html', 'htm', 'xhtml',
]

/** Media types for the same formats. */
const MEDIA_TYPES: readonly string[] = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/rtf', 'text/rtf', 'application/epub+zip',
  'text/plain', 'text/markdown', 'text/csv', 'text/tab-separated-values', 'text/html', 'text/css', 'text/xml',
  'text/javascript', 'application/javascript', 'application/json', 'application/xml', 'application/x-yaml',
]

/** Everything this provider claims. */
export const JS_FORMATS: DocumentFormats = {
  extensions: [...STRUCTURED_EXTENSIONS, ...TEXT_EXTENSIONS],
  mediaTypes: MEDIA_TYPES,
}
