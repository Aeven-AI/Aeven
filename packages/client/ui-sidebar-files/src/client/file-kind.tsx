/** What a file is, judged by its name, and the glyph and viewer that follow from it. */
import type { ReactNode } from 'react'
import {
  IconLucideFile, IconLucideFileArchive, IconLucideFileBraces, IconLucideFileCode, IconLucideFileImage,
  IconLucideFileText,
} from '@aeven/client-ui-primitives'

/** How the explorer shows a file. */
export type FileKind = 'code' | 'data' | 'markdown' | 'text' | 'image' | 'archive' | 'other'

const CODE = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h',
  'cc', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'lua', 'sql', 'css', 'scss', 'less', 'html',
  'htm', 'vue', 'svelte', 'astro', 'graphql', 'gql', 'dart', 'scala', 'ex', 'exs', 'erl', 'hs', 'ml', 'r', 'pl',
  'zig', 'nim', 'dockerfile', 'makefile',
])
const DATA = new Set(['json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'xml', 'csv', 'tsv', 'ini', 'env', 'lock', 'plist'])
const MARKDOWN = new Set(['md', 'mdx', 'markdown'])
const TEXT = new Set(['txt', 'log', 'rst', 'text', 'conf', 'cfg', 'properties', 'gitignore', 'gitattributes', 'editorconfig', 'npmrc'])
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
const ARCHIVE = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'zst'])

/**
 * The extension that decides a file's kind: the text after the last dot, or the
 * whole lower-cased name for extensionless files such as `Dockerfile`, and the
 * text after a leading dot for dotfiles such as `.gitignore`.
 * @param name - the file's basename.
 * @returns the lower-cased extension.
 */
export function extensionOf(name: string): string {
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  return dot === -1 ? lower : lower.slice(dot + 1)
}

/**
 * Classify a file by its name.
 * @param name - the file's basename.
 * @returns the kind the explorer shows it as.
 */
export function fileKindOf(name: string): FileKind {
  const extension = extensionOf(name)
  if (MARKDOWN.has(extension)) return 'markdown'
  if (IMAGE.has(extension)) return 'image'
  if (ARCHIVE.has(extension)) return 'archive'
  if (DATA.has(extension)) return 'data'
  if (CODE.has(extension)) return 'code'
  if (TEXT.has(extension)) return 'text'
  return 'other'
}

/**
 * The lucide glyph a file's row and pill carry.
 * @param name - the file's basename.
 * @returns the glyph element.
 */
export function fileGlyph(name: string): ReactNode {
  switch (fileKindOf(name)) {
    case 'code': return <IconLucideFileCode />
    case 'data': return <IconLucideFileBraces />
    case 'markdown':
    case 'text': return <IconLucideFileText />
    case 'image': return <IconLucideFileImage />
    case 'archive': return <IconLucideFileArchive />
    case 'other': return <IconLucideFile />
  }
}
