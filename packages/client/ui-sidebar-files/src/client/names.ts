/** Entry-name checks and path shortening for the explorer's rows. @module */
import type { SidebarFilesKey } from './locales.ts'

/** Names Windows refuses for a file or folder, with or without an extension; the Host refuses the same set. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i

/** Characters no entry name may carry on any platform the Host runs on. */
const FORBIDDEN_CHARACTERS = /[/\\:*?"<>|\u0000-\u001f]/

/**
 * Why a typed name cannot be used, checked before any request so the input keeps its text.
 * @param name - the name as typed.
 * @returns the dictionary key of the reason, or undefined for a usable name.
 */
export function nameProblem(name: string): SidebarFilesKey | undefined {
  if (name.trim() === '') return 'name.empty'
  if (name === '.' || name === '..') return 'name.dot'
  if (FORBIDDEN_CHARACTERS.test(name)) return 'name.character'
  if (WINDOWS_RESERVED.test(name)) return 'name.reserved'
  if (/[. ]$/.test(name)) return 'name.trailing'
  if (new TextEncoder().encode(name).byteLength > 255) return 'name.long'
  return undefined
}

/**
 * Shorten a path from its middle, keeping its first folder and its end, as `components/…/FilesPane.tsx`.
 * @param path - a `/`-joined path.
 * @param max - the longest result in characters.
 * @returns the path, or its shortened form when longer than `max`.
 */
export function middleTruncate(path: string, max: number): string {
  if (path.length <= max) return path
  const parts = path.split('/')
  const head = parts[0] ?? ''
  let tail = parts.at(-1) ?? ''
  for (let index = parts.length - 2; index > 0; index -= 1) {
    const next = `${parts[index] ?? ''}/${tail}`
    if (head.length + next.length + 3 > max) break
    tail = next
  }
  const shortened = `${head}/…/${tail}`
  return shortened.length < path.length ? shortened : path
}
