/**
 * Finding a checkout of a repository this device already has, by reading only each candidate's Git configuration.
 * @module @aeven/workspace-git-sync/discovery
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { remoteKey } from './remote.ts'

/** Where and how long discovery looks. */
export interface DiscoveryOptions {
  /** Directories whose subdirectories are candidates. */
  roots: string[]
  /** Levels of subdirectories under each root that are candidates. */
  depth: number
  /** Longest one search reads configurations. */
  timeoutMs: number
  /** How long the list of candidates under the roots is reused. */
  cacheMs: number
}

/** Directories never descended into while listing candidates. */
const SKIPPED = new Set(['node_modules', 'Library', 'AppData'])

/** Finds existing checkouts by their remote. */
export class CheckoutDiscovery {
  private cached: { at: number; directories: Promise<string[]> } | undefined

  /** @param options - roots, depth, and time limits. */
  constructor(private readonly options: DiscoveryOptions) {}

  /**
   * The first checkout whose remotes include the repository, looking at the given directories, then at the
   * subdirectories of the given parents, then under the roots, and giving up at the time limit.
   * @param key - the repository's {@link remoteKey}.
   * @param direct - directories to try first, such as the placed directory.
   * @param parents - directories whose subdirectories to try next, such as the parents of other workspaces' directories.
   * @param exclude - directories that may not be returned, such as those other workspaces use.
   * @returns the checkout's directory, or undefined when none was found in time.
   */
  async find(
    key: string,
    direct: readonly string[],
    parents: readonly string[],
    exclude: ReadonlySet<string>,
  ): Promise<string | undefined> {
    const deadline = Date.now() + this.options.timeoutMs
    const seen = new Set<string>()
    for (const candidate of [...direct, ...await list(parents, 1), ...await this.directories()]) {
      if (Date.now() >= deadline) return undefined
      if (seen.has(candidate) || exclude.has(candidate)) continue
      seen.add(candidate)
      if ((await remotesOf(candidate)).includes(key)) return candidate
    }
    return undefined
  }

  private directories(): Promise<string[]> {
    if (this.cached !== undefined && Date.now() - this.cached.at < this.options.cacheMs) return this.cached.directories
    this.cached = { at: Date.now(), directories: list(this.options.roots, this.options.depth) }
    return this.cached.directories
  }
}

/** Subdirectories of the roots, up to the depth, breadth first. */
async function list(roots: readonly string[], depth: number): Promise<string[]> {
  const found: string[] = []
  let level = [...roots]
  for (let current = 0; current < depth && level.length > 0; current += 1) {
    const next: string[] = []
    for (const directory of level) {
      let entries
      try {
        entries = await readdir(directory, { withFileTypes: true })
      } catch {
        // A missing or unreadable root has no candidates.
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || SKIPPED.has(entry.name)) continue
        next.push(join(directory, entry.name))
      }
    }
    found.push(...next)
    level = next
  }
  return found
}

/** The remote keys a directory's Git configuration lists, empty when the directory is not the top of a work tree. */
async function remotesOf(directory: string): Promise<string[]> {
  const config = await configPath(directory)
  if (config === undefined) return []
  let text: string
  try {
    text = await readFile(config, 'utf8')
  } catch {
    // A configuration that disappeared or cannot be read lists no remotes.
    return []
  }
  const keys: string[] = []
  let inRemote = false
  for (const line of text.split(/\r?\n/u)) {
    const section = /^\s*\[\s*([^\s\]]+)/u.exec(line)
    if (section !== null) inRemote = section[1]?.toLowerCase() === 'remote'
    const url = inRemote ? /^\s*url\s*=\s*(.+?)\s*$/iu.exec(line)?.[1] : undefined
    const key = url === undefined ? undefined : remoteKey(url.replace(/^"(.*)"$/u, '$1'))
    if (key !== undefined) keys.push(key)
  }
  return keys
}

/** The configuration file of the work tree at a directory: `.git/config`, or the common directory's for a linked work tree. */
async function configPath(directory: string): Promise<string | undefined> {
  const dotGit = join(directory, '.git')
  let info
  try {
    info = await stat(dotGit)
  } catch {
    // No `.git`: not the top of a work tree.
    return undefined
  }
  if (info.isDirectory()) return join(dotGit, 'config')
  let gitDir: string
  try {
    const pointer = /^gitdir:\s*(.+?)\s*$/mu.exec(await readFile(dotGit, 'utf8'))?.[1]
    if (pointer === undefined) return undefined
    gitDir = isAbsolute(pointer) ? pointer : resolve(directory, pointer)
    const common = (await readFile(join(gitDir, 'commondir'), 'utf8').catch(() => '')).trim()
    if (common !== '') gitDir = isAbsolute(common) ? common : resolve(gitDir, common)
  } catch {
    // An unreadable `.git` file points nowhere this search can follow.
    return undefined
  }
  return join(gitDir, 'config')
}

/**
 * The parents of directories other workspaces use, which often hold more checkouts.
 * @param paths - directories bound to workspaces on this device.
 * @returns their distinct parent directories.
 */
export function parentsOf(paths: readonly string[]): string[] {
  return [...new Set(paths.map(path => dirname(path)))]
}
