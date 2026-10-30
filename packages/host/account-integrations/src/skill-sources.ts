/**
 * Skills installed for other coding agents on this computer, and skills fetched from a repository or package.
 *
 * Claude Code and Codex both keep a skill as a directory holding `SKILL.md` beside its resources, so Settings lists
 * what those agents installed and imports a chosen directory into the account library through the same validated
 * path as a file upload. A GitHub repository, an npm package, or a package name is fetched here and handed over as
 * the same upload shape, so neither needs a second import path.
 *
 * @module skill-sources
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { Parser } from 'tar'
import { isSkillName } from '@aeven/skill'
import { skillHeader } from './skills.ts'
import type { SkillUploadFile, SystemSkillAgent } from './types.ts'

/** File that marks a directory as a skill. */
const SKILL_FILE = 'SKILL.md'

/** Directories inside an archive or an agent home that never hold an installable skill. */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(['node_modules', '.git', '.trash'])

/**
 * Directories inside each agent home that hold skills, with how many levels below them a skill may sit: Claude Code
 * keeps synced skills under a per-account container and plugin skills under their plugin, and Codex vendors a curated
 * set below `vendor_imports`, so neither layout is one level deep.
 */
const AGENT_ROOTS: Readonly<Record<SystemSkillAgent, readonly { path: string; depth: number }[]>> = {
  claude: [{ path: 'skills', depth: 4 }, { path: 'plugins', depth: 6 }],
  codex: [{ path: 'skills', depth: 4 }, { path: 'vendor_imports', depth: 6 }],
}

/** How many directory levels below a skills root a skill may sit. */
const SKILL_SCAN_DEPTH = 4

/** Largest archive read from a repository or package, before each skill's own limit applies. */
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024

/** Most skills one reference may add, so a monorepo of skills cannot flood the library. */
const MAX_REFERENCE_SKILLS = 40

const GITHUB_API = 'https://api.github.com'
const GITHUB_CODELOAD = 'https://codeload.github.com'
const NPM_REGISTRY = 'https://registry.npmjs.org'

const GITHUB_URL = /^(?:git\+)?(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?(?:\/tree\/([^/?#\s]+))?(?:[/?#].*)?$/i
const NPM_URL = /^(?:https?:\/\/)?(?:www\.)?npmjs\.(?:com|org)\/package\/((?:@[\w.-]+\/)?[\w.-]+)(?:\/v\/([^/?#\s]+))?/i
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/
const PACKAGE = /^(?:@[\w.-]+\/)?[\w.-]+$/
const VERSIONED_PACKAGE = /^((?:@[\w.-]+\/)?[\w.-]+)@([\w.^~-]+)$/
const REFERENCE_HINT = 'enter a GitHub URL, an npm package, or a dependency name'

/** A skill found in one agent's home directory. */
export interface DiscoveredSkill {
  /** Agent whose home holds the skill. */
  readonly agent: SystemSkillAgent
  /** Skill directory relative to that home, with `/` separators. */
  readonly path: string
  /** Name declared by the skill's frontmatter. */
  readonly name: string
  /** Description declared by the skill's frontmatter. */
  readonly description: string
}

/** Where a reference points: a GitHub repository, or a published npm package. */
export type SkillReference =
  | { readonly kind: 'github'; readonly repo: string; readonly ref?: string }
  | { readonly kind: 'npm'; readonly name: string; readonly version?: string }

/** Network budget a reference fetch runs under. */
export interface ReferenceOptions {
  /** Request budget for the repository or registry lookup and its archive. */
  readonly timeoutMs: number
}

/**
 * List the skills one agent installed under its home directory, in name order.
 * @param agent - agent whose home is scanned.
 * @param home - absolute path of that agent's configuration root.
 * @returns every skill with valid frontmatter, one per name.
 */
export async function discoverAgentSkills(agent: SystemSkillAgent, home: string): Promise<DiscoveredSkill[]> {
  const directories: string[] = []
  for (const root of AGENT_ROOTS[agent]) await collectSkillDirectories(join(home, root.path), root.depth, directories)
  const byName = new Map<string, DiscoveredSkill>()
  for (const directory of directories.sort()) {
    const header = await readSkillHeader(directory)
    if (header === undefined || !isSkillName(header.name) || byName.has(header.name)) continue
    byName.set(header.name, { agent, path: relative(home, directory).split(sep).join('/'), ...header })
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
}

/**
 * Read one skill directory as the upload shape the account import validates.
 * @param home - absolute path of the agent's configuration root.
 * @param path - skill directory relative to that home, as {@link discoverAgentSkills} reported it.
 * @param maxBytes - largest total size the bundle may reach.
 * @returns the skill's files, `SKILL.md` at the bundle root.
 * @throws Error when the path leaves the agent home or no longer holds a skill.
 */
export async function readAgentSkill(home: string, path: string, maxBytes: number): Promise<SkillUploadFile[]> {
  if (path === '' || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new Error('skill path is outside the agent home')
  }
  const directory = join(home, path)
  if (await readSkillHeader(directory) === undefined) throw new Error('skill is no longer installed for that agent')
  const uploads: SkillUploadFile[] = []
  await collectBundleFiles(directory, '', uploads, maxBytes, { bytes: 0 })
  return uploads
}

/**
 * List the skill names a directory tree supplies, however deep each skill sits below it.
 * @param root - absolute path of a skills root, such as the bundled or user skills directory.
 * @returns every declared skill name, without duplicates.
 */
export async function discoverSkillNames(root: string): Promise<Set<string>> {
  const directories: string[] = []
  await collectSkillDirectories(root, SKILL_SCAN_DEPTH, directories)
  const names = new Set<string>()
  for (const directory of directories) {
    const header = await readSkillHeader(directory)
    if (header !== undefined && isSkillName(header.name)) names.add(header.name)
  }
  return names
}

/**
 * Recognize a GitHub URL, an npm URL, a package name, or an `owner/repository` shorthand.
 * @param reference - what the reader typed.
 * @returns where the reference points.
 * @throws Error when the text is none of those forms.
 */
export function parseSkillReference(reference: string): SkillReference {
  const text = reference.trim()
  if (text === '') throw new Error(REFERENCE_HINT)
  const github = GITHUB_URL.exec(text)
  if (github?.[1] !== undefined) {
    return { kind: 'github', repo: github[1].replace(/^\/+|\/+$/g, ''), ...github[2] === undefined ? {} : { ref: github[2] } }
  }
  const npm = NPM_URL.exec(text)
  if (npm?.[1] !== undefined) return { kind: 'npm', name: npm[1], ...npm[2] === undefined ? {} : { version: npm[2] } }
  if (text.startsWith('npm:')) return packageReference(text.slice('npm:'.length).trim())
  if (text.startsWith('@')) return packageReference(text)
  const versioned = VERSIONED_PACKAGE.exec(text)
  if (versioned?.[1] !== undefined && versioned[2] !== undefined) return { kind: 'npm', name: versioned[1], version: versioned[2] }
  if (REPOSITORY.test(text)) return { kind: 'github', repo: text }
  if (PACKAGE.test(text)) return { kind: 'npm', name: text }
  throw new Error(REFERENCE_HINT)
}

/**
 * Fetch every skill a reference publishes.
 * @param reference - parsed GitHub repository or npm package.
 * @param options - request budget.
 * @returns one upload set per skill found, in name order.
 * @throws Error when the reference cannot be fetched or carries no skill.
 */
export async function fetchReferenceSkills(reference: SkillReference, options: ReferenceOptions): Promise<SkillUploadFile[][]> {
  const archive = reference.kind === 'github'
    ? await fetchGithubArchive(reference.repo, reference.ref, options)
    : await fetchNpmArchive(reference.name, reference.version, options)
  const bundles = skillBundles(await readTarGz(archive))
  if (bundles.length === 0) throw new Error(`no SKILL.md found in ${reference.kind === 'github' ? reference.repo : reference.name}`)
  return bundles
}

/** Build a package reference from `name` or `name@version`. */
function packageReference(text: string): SkillReference {
  const versioned = VERSIONED_PACKAGE.exec(text)
  if (versioned?.[1] !== undefined && versioned[2] !== undefined) return { kind: 'npm', name: versioned[1], version: versioned[2] }
  if (!PACKAGE.test(text)) throw new Error(REFERENCE_HINT)
  return { kind: 'npm', name: text }
}

/** Append every directory at or below a root that holds a `SKILL.md`. */
async function collectSkillDirectories(directory: string, depth: number, found: string[]): Promise<void> {
  let entries
  // A root that is absent or unreadable holds no skills, which is the same answer as an empty directory.
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  if (entries.some(entry => entry.isFile() && entry.name === SKILL_FILE)) {
    found.push(directory)
    return
  }
  if (depth === 0) return
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIPPED_DIRECTORIES.has(entry.name)) continue
    await collectSkillDirectories(join(directory, entry.name), depth - 1, found)
  }
}

/** Read a directory's frontmatter, treating an absent or malformed skill file as no skill. */
async function readSkillHeader(directory: string): Promise<{ name: string; description: string } | undefined> {
  let markdown: string
  try {
    markdown = await readFile(join(directory, SKILL_FILE), 'utf8')
  } catch {
    return undefined
  }
  return skillHeader(markdown)
}

/** Append every regular file below a skill directory as a relative upload. */
async function collectBundleFiles(
  directory: string, prefix: string, uploads: SkillUploadFile[], maxBytes: number, budget: { bytes: number },
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const path = `${prefix}${entry.name}`
    const full = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) await collectBundleFiles(full, `${path}/`, uploads, maxBytes, budget)
      continue
    }
    // A link points outside the skill the reader chose, so the bundle carries only files it contains.
    if (!entry.isFile()) continue
    const data = await readFile(full)
    budget.bytes += data.byteLength
    if (budget.bytes > maxBytes) throw new Error('skill bundle exceeds the configured size limit')
    uploads.push({ path, base64: data.toString('base64') })
  }
}

/** Read one gzip'd tarball into a path-keyed file map, refusing unsafe paths and unbounded bodies. */
async function readTarGz(archive: Buffer): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>()
  const budget = { bytes: 0 }
  const parser = new Parser({
    onReadEntry: async (entry) => {
      if (entry.type !== 'File' || !isSafeArchivePath(entry.path)) {
        entry.resume()
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of entry) chunks.push(Buffer.from(chunk as Uint8Array))
      const body = Buffer.concat(chunks)
      budget.bytes += body.byteLength
      if (budget.bytes > MAX_ARCHIVE_BYTES) throw new Error('archive exceeds the configured size limit')
      files.set(entry.path, body)
    },
  })
  await pipeline(Readable.from(archive), createGunzip(), parser)
  return files
}

/** Whether an archive path is relative and stays inside the extracted root. */
function isSafeArchivePath(path: string): boolean {
  return !path.startsWith('/') && !path.includes('\\') && !/^[A-Za-z]:/.test(path)
    && path.split('/').every(part => part !== '..' && part !== '.')
}

/**
 * Group an archive's files into one bundle per directory that holds a `SKILL.md`.
 *
 * A file joins the deepest skill directory containing it, so a skill that vendors another skill keeps its own
 * resources; a name the archive carries more than once resolves to the shallower copy.
 */
function skillBundles(files: Map<string, Buffer>): SkillUploadFile[][] {
  // Directories end with `/` so a prefix test cannot match a sibling with the same leading characters.
  const directories = new Set<string>()
  for (const path of files.keys()) {
    if (path === SKILL_FILE) directories.add('')
    else if (path.endsWith(`/${SKILL_FILE}`)) directories.add(path.slice(0, path.length - SKILL_FILE.length))
  }
  const deepestFirst = [...directories].sort((left, right) => right.length - left.length)
  const members = new Map<string, string[]>()
  for (const path of files.keys()) {
    const directory = deepestFirst.find(candidate => candidate === '' || path.startsWith(candidate))
    if (directory === undefined) continue
    const owner = members.get(directory) ?? []
    owner.push(path)
    members.set(directory, owner)
  }
  const byName = new Map<string, SkillUploadFile[]>()
  for (const directory of [...directories].sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right))) {
    const header = skillHeader(files.get(`${directory}${SKILL_FILE}`)?.toString('utf8') ?? '')
    if (header === undefined || !isSkillName(header.name) || byName.has(header.name)) continue
    byName.set(header.name, (members.get(directory) ?? []).map(path => ({ path: path.slice(directory.length), base64: files.get(path)?.toString('base64') ?? '' })))
  }
  return [...byName.values()].slice(0, MAX_REFERENCE_SKILLS)
}

/** Fetch a GitHub repository tarball, trying the default branch and then the two conventional names. */
async function fetchGithubArchive(repo: string, ref: string | undefined, options: ReferenceOptions): Promise<Buffer> {
  const refs = ref === undefined ? await githubRefs(repo, options) : [ref]
  let failure: unknown
  for (const candidate of refs) {
    try {
      return await download(`${GITHUB_CODELOAD}/${repo}/tar.gz/${candidate}`, options)
    } catch (error) {
      failure = error
    }
  }
  throw failure instanceof Error ? failure : new Error(`${repo} could not be fetched`)
}

/** Read a repository's default branch, falling back to the two names GitHub initializes. */
async function githubRefs(repo: string, options: ReferenceOptions): Promise<string[]> {
  const response = await request(`${GITHUB_API}/repos/${repo}`, options)
  if (!response.ok) return ['main', 'master']
  const body: unknown = await response.json()
  const branch = typeof body === 'object' && body !== null ? (body as { default_branch?: unknown }).default_branch : undefined
  return typeof branch === 'string' && branch !== '' ? [branch] : ['main', 'master']
}

/** Fetch one npm package's tarball, from its latest release or the version the reference names. */
async function fetchNpmArchive(name: string, version: string | undefined, options: ReferenceOptions): Promise<Buffer> {
  const registry = `${NPM_REGISTRY}/${name.startsWith('@') ? name.replace('/', '%2f') : name}`
  const response = await request(registry, options)
  if (!response.ok) throw new Error(`npm package ${name} could not be found`)
  const body: unknown = await response.json()
  const metadata = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
  const tags = metadata['dist-tags']
  const resolved = version ?? (typeof tags === 'object' && tags !== null ? (tags as Record<string, unknown>).latest : undefined)
  const versions = metadata.versions
  const entry = typeof resolved === 'string' && typeof versions === 'object' && versions !== null
    ? (versions as Record<string, unknown>)[resolved]
    : undefined
  const dist = typeof entry === 'object' && entry !== null ? (entry as { dist?: unknown }).dist : undefined
  const tarball = typeof dist === 'object' && dist !== null ? (dist as { tarball?: unknown }).tarball : undefined
  if (typeof tarball !== 'string') throw new Error(`npm package ${name} has no published tarball`)
  return download(tarball, options)
}

/** Request one URL under the reference budget. */
function request(url: string, options: ReferenceOptions): Promise<Response> {
  return fetch(url, {
    signal: AbortSignal.timeout(options.timeoutMs),
    headers: { accept: 'application/vnd.github+json, application/json', 'user-agent': 'aeven' },
    redirect: 'follow',
  })
}

/** Download one archive, refusing a body larger than the archive limit. */
async function download(url: string, options: ReferenceOptions): Promise<Buffer> {
  const response = await request(url, options)
  if (!response.ok) throw new Error(`fetching ${new URL(url).hostname} failed with status ${response.status}`)
  const body = Buffer.from(await response.arrayBuffer())
  if (body.byteLength > MAX_ARCHIVE_BYTES) throw new Error('archive exceeds the configured size limit')
  return body
}
