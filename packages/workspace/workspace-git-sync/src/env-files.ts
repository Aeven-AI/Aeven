/**
 * Environment files: files Git ignores that a project needs to run, such as `.env`, which travel with a repository
 * workspace and are restored only where no file of that name exists.
 * @module @aeven/workspace-git-sync/env-files
 */
import { existsSync } from 'node:fs'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import type { Git } from './git.ts'

/** Which ignored files travel. */
export interface EnvFileOptions {
  /** File-name patterns that travel, with `*` and `?` wildcards. */
  patterns: string[]
  /** File-name patterns that never travel, such as templates. */
  exclude: string[]
  /** Largest file that travels. */
  maxBytes: number
  /** Most files one workspace carries. */
  maxFiles: number
}

/** Matches file names against wildcard patterns. */
export class EnvFileNames {
  private readonly include: RegExp[]
  private readonly exclude: RegExp[]

  /** @param options - the patterns. */
  constructor(options: EnvFileOptions) {
    this.include = options.patterns.map(wildcard)
    this.exclude = options.exclude.map(wildcard)
  }

  /**
   * Whether a work-tree-relative path names an environment file: its name matches a pattern and no exclusion, and it
   * lies outside Git's own directory.
   * @param path - `/`-separated path relative to the work tree.
   * @returns whether the file travels.
   */
  matches(path: string): boolean {
    const segments = path.split('/')
    const name = segments.at(-1) ?? ''
    if (segments.some(segment => segment === '' || segment === '.' || segment === '..' || segment === '.git')) return false
    return this.include.some(pattern => pattern.test(name)) && !this.exclude.some(pattern => pattern.test(name))
  }
}

/**
 * Read the work tree's environment files: the files Git ignores whose names match, within the size and count limits.
 * Ignored directories are not entered, so a file inside `node_modules` never travels.
 * @param git - this device's Git.
 * @param root - the work tree.
 * @param names - the name patterns.
 * @param options - the limits.
 * @returns each file's `/`-separated relative path and its contents, base64-encoded.
 */
export async function readEnvFiles(git: Git, root: string, names: EnvFileNames, options: EnvFileOptions): Promise<Map<string, string>> {
  const listed = await git.output(['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'], { cwd: root })
  const files = new Map<string, string>()
  for (const path of listed.split('\0')) {
    if (files.size >= options.maxFiles) break
    if (!names.matches(path)) continue
    const absolute = join(root, ...path.split('/'))
    const info = await lstat(absolute).catch(() => undefined)
    if (info?.isFile() !== true || info.size > options.maxBytes) continue
    files.set(path, (await readFile(absolute)).toString('base64'))
  }
  return files
}

/**
 * Write the environment files the work tree lacks; an existing file of the same name is never replaced.
 * @param root - the work tree.
 * @param files - relative paths and base64 contents another device published.
 * @param names - the name patterns, which every path must match.
 * @param options - the limits, which every file must meet.
 * @returns the paths written.
 */
export async function restoreEnvFiles(
  root: string,
  files: Iterable<[string, string]>,
  names: EnvFileNames,
  options: EnvFileOptions,
): Promise<string[]> {
  const written: string[] = []
  for (const [path, content] of files) {
    // Another device wrote these entries; a path outside the patterns could name a hook or a source file.
    if (posix.isAbsolute(path) || !names.matches(path)) continue
    const bytes = Buffer.from(content, 'base64')
    const absolute = join(root, ...path.split('/'))
    if (bytes.length > options.maxBytes || existsSync(absolute)) continue
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, bytes, { mode: 0o600, flag: 'wx' }).then(() => written.push(path), (error: unknown) => {
      // `wx` refuses a file created since the check above, which then stays the local value.
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    })
  }
  return written
}

/** A wildcard file-name pattern as an anchored expression. */
function wildcard(pattern: string): RegExp {
  const source = pattern.replace(/[.+^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '[^/]*').replace(/\?/gu, '[^/]')
  return new RegExp(`^${source}$`, 'u')
}
