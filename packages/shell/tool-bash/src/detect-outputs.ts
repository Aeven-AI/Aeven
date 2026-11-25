/**
 * Undeclared-output detection for foreground bash commands: the files of watched types a command creates or changes
 * in the workspace and in the folders the command itself works in, recorded as if the command had declared them.
 * @module
 */

import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, resolve as resolvePath, sep } from 'node:path'
import type { FileSystem, FsTarget } from '@aeven/fs'

/** One watched file's target and freshness token. */
interface WatchedFile {
  target: FsTarget
  version: string | undefined
}

/** A directory the watch lists, and whether it descends into subdirectories. */
interface WatchedDirectory {
  target: FsTarget
  recursive: boolean
  extensions: ReadonlySet<string>
}

/** One file a command created or changed. */
export interface DetectedOutput {
  target: FsTarget
  /** Whether the file was absent before the command ran. */
  created: boolean
}

/** The files a watch saw before the command, and how to list the ones it then created or changed. */
export interface OutputWatch {
  /**
   * List the watched files again and compare them with the listing taken before the command.
   * @param signal - the call's lifetime.
   * @returns the created or changed files, in listing order.
   */
  changed(signal: AbortSignal): Promise<DetectedOutput[]>
}

/** What a watch needs to know about the command and the deployment. */
export interface OutputWatchOptions {
  fs: FileSystem
  command: string
  /** The resolved workspace root, listed recursively for the types the command names. */
  workspace: FsTarget
  /** The command's starting directory. */
  workdir: string
  /** Extensions, lower-case without the dot, a command is watched for when its text names them. */
  namedExtensions: ReadonlySet<string>
  /** Extensions, lower-case without the dot, watched in the command's own folders whether or not it names them. */
  documentExtensions: ReadonlySet<string>
  /** Whether a folder outside the workspace may be listed; false where readers must not learn about other folders. */
  outsideWorkspace: boolean
  /** Most directory entries one listing visits across every watched directory. */
  maxEntries: number
  signal: AbortSignal
}

/**
 * The configured extensions a command's text names, as `.ext` ending a word.
 * @param command - the command text.
 * @param extensions - configured lower-case extensions without the dot.
 * @returns the named extensions, lower-cased; empty when the command names none.
 */
export function namedExtensions(command: string, extensions: ReadonlySet<string>): Set<string> {
  const named = new Set<string>()
  for (const match of command.matchAll(/\.([A-Za-z0-9]+)\b/g)) {
    const extension = match[1]?.toLowerCase()
    if (extension !== undefined && extensions.has(extension)) named.add(extension)
  }
  return named
}

/** Shell words: a double- or single-quoted string, or a run of characters that are not quotes, blanks, or operators. */
const WORD = /"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s"';&|()<>]+)/g

/** A `cd` at the start of a command or after an operator or `then`/`do`/`else`, and its target word. */
const CD = /(?:^|[;&|(\n]|\b(?:then|do|else))\s*cd\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s;&|)]+))/g

/**
 * A shell word with `~`, `$HOME`, and `$PWD` expanded the way the folders a command works in need, and a `file://`
 * prefix dropped.
 * @param word - the word as the command spells it.
 * @param pwd - the directory `$PWD` stands for.
 * @returns the expanded word, or undefined when it still holds a variable or substitution.
 */
function expandWord(word: string, pwd: string): string | undefined {
  const home = homedir()
  const expanded = word
    .replace(/^file:\/\//, '')
    .replace(/^~(?=\/|$)/, home)
    .replace(/\$\{HOME\}|\$HOME\b/g, home)
    .replace(/\$\{PWD\}|\$PWD\b/g, pwd)
  return expanded.includes('$') || expanded.includes('`') ? undefined : expanded
}

/**
 * Whether a directory holds only throwaway files: the system temporary folders, and any folder below a hidden one.
 * @param path - absolute directory path.
 * @returns true when nothing a command leaves there is a deliverable.
 */
function isScratchDirectory(path: string): boolean {
  const temporary = [tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders']
  if (temporary.some(root => path === root || path.startsWith(`${root}${sep}`))) return true
  return path.split(/[\\/]/).some(segment => segment.startsWith('.') && segment !== '.' && segment !== '..')
}

/**
 * The folders a command works in: its starting directory, each directory it changes into, and the folder of each path
 * in its text that ends in a watched extension. A relative path resolves against each of those working directories.
 * @param command - the command text.
 * @param workdir - the command's starting directory.
 * @param extensions - every watched extension, lower-case without the dot.
 * @returns absolute directory paths, first-seen order, without temporary or hidden folders.
 */
export function commandDirectories(command: string, workdir: string, extensions: ReadonlySet<string>): string[] {
  const bases = [workdir]
  for (const match of command.matchAll(CD)) {
    const word = match[1] ?? match[2] ?? match[3]
    const target = word === undefined ? undefined : expandWord(word, workdir)
    if (target !== undefined && target !== '-') bases.push(resolvePath(workdir, target))
  }
  const directories = new Set(bases)
  for (const match of command.matchAll(WORD)) {
    const raw = match[1] ?? match[2] ?? match[3]
    if (raw === undefined) continue
    // `--print-to-pdf=out.pdf` and `-o=out.pdf` carry the path after the option's `=`.
    const word = match[3] !== undefined && raw.startsWith('-') && raw.includes('=') ? raw.slice(raw.indexOf('=') + 1) : raw
    const dot = word.lastIndexOf('.')
    if (dot <= 0 || !extensions.has(word.slice(dot + 1).toLowerCase())) continue
    for (const base of bases) {
      const path = expandWord(word, base)
      if (path === undefined) continue
      directories.add(dirname(isAbsolute(path) ? path : resolvePath(base, path)))
      if (isAbsolute(path)) break
    }
  }
  return [...directories].filter(directory => !isScratchDirectory(directory))
}

/**
 * The version of every file of a watched extension in the watched directories, each listed breadth first when
 * recursive, skipping hidden directories and `node_modules`, and stopping after `maxEntries` visited entries in all.
 * @param fs - the filesystem provider.
 * @param directories - the watched directories.
 * @param maxEntries - most directory entries visited across every directory.
 * @param signal - the call's lifetime.
 * @returns each matching file's target and version, by target key.
 */
async function watchedVersions(
  fs: FileSystem,
  directories: readonly WatchedDirectory[],
  maxEntries: number,
  signal: AbortSignal,
): Promise<Map<string, WatchedFile>> {
  const found = new Map<string, WatchedFile>()
  let visited = 0
  for (const directory of directories) {
    const queue: FsTarget[] = [directory.target]
    while (queue.length > 0 && visited < maxEntries) {
      const dir = queue.shift() as FsTarget
      let entries: Awaited<ReturnType<FileSystem['listDir']>>
      try {
        entries = await fs.listDir(dir, signal)
      } catch {
        // A directory the command removed, has yet to create, or the Host cannot read holds no output this call can record.
        continue
      }
      for (const entry of entries) {
        if (++visited > maxEntries) break
        if (entry.type === 'directory') {
          if (directory.recursive && !entry.name.startsWith('.') && entry.name !== 'node_modules') queue.push(entry.target)
          continue
        }
        const dot = entry.name.lastIndexOf('.')
        if (entry.type !== 'file' || dot <= 0 || !directory.extensions.has(entry.name.slice(dot + 1).toLowerCase())) continue
        const key = String(entry.target.targetKey)
        if (found.has(key)) continue
        const version = entry.version ?? (await fs.stat(entry.target, signal))?.version
        found.set(key, { target: entry.target, version: version === undefined ? undefined : String(version) })
      }
    }
  }
  return found
}

/**
 * Start watching for a command's undeclared outputs: the files of the types the command names anywhere in the
 * workspace, and documents of the configured types in the folders the command works in. Temporary and hidden folders
 * are never watched, so a scratch preview there stays out.
 * @param options - the command, its folders, and the deployment's watch settings.
 * @returns the watch, or undefined when nothing is watched.
 */
export async function watchOutputs(options: OutputWatchOptions): Promise<OutputWatch | undefined> {
  const { fs, command, workspace, workdir, signal, maxEntries } = options
  const named = namedExtensions(command, options.namedExtensions)
  const local = new Set([...named, ...options.documentExtensions])
  const directories: WatchedDirectory[] = []
  if (local.size > 0) {
    const all = new Set([...options.namedExtensions, ...options.documentExtensions])
    for (const path of commandDirectories(command, workdir, all)) {
      let target: FsTarget
      try {
        target = await fs.resolve(path, { signal })
      } catch {
        // A folder the provider refuses to resolve is one this call cannot list.
        continue
      }
      if (!options.outsideWorkspace && !fs.contains(workspace, target)) continue
      directories.push({ target, recursive: false, extensions: local })
    }
  }
  if (named.size > 0) directories.push({ target: workspace, recursive: true, extensions: named })
  if (directories.length === 0) return undefined
  const before = await watchedVersions(fs, directories, maxEntries, signal)
  return {
    async changed(callSignal) {
      const now = await watchedVersions(fs, directories, maxEntries, callSignal)
      return [...now]
        .filter(([key, file]) => !before.has(key) || before.get(key)?.version !== file.version)
        .map(([key, file]) => ({ target: file.target, created: !before.has(key) }))
    },
  }
}
