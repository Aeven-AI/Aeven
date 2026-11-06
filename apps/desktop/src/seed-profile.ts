/** Relocatable Windows package layouts backed by the seed's content-addressed store. */

import { createHash } from 'node:crypto'
import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { copyFile, link, mkdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { load } from 'js-yaml'

/** Seed-relative descriptor of the Windows profile installed and tested during packaging. */
export const SEED_PROFILE_LAYOUT = 'profile-layout.json'

interface ProfileFile {
  readonly path: string
  readonly content: string
}

interface ProfileLayout {
  readonly schemaVersion: 1
  readonly arch: string
  readonly storeVersion: string
  readonly directories: readonly string[]
  readonly files: readonly ProfileFile[]
  readonly modules: Record<string, unknown>
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/[\\:\0]/u.test(value)
    && value.split('/').every(part => part !== '' && part !== '.' && part !== '..' && !/[. ]$/u.test(part))
}

/**
 * Record an installed Windows node_modules tree, adding generated files to the seed store without duplicating bytes.
 * Symbolic links are rejected: the Windows hoisted layout must be relocatable without junctions or build-host paths.
 * @param seedRoot - Seed receiving the layout descriptor before its integrity inventory is computed.
 * @param storeRoot - Loose pnpm store, before archive creation.
 * @param nodeModules - Fully installed and verified Windows dependency tree.
 * @param arch - Windows release architecture.
 * @returns Resolves after all layout files and content objects are written.
 */
export async function createSeedProfileLayout(seedRoot: string, storeRoot: string, nodeModules: string, arch: string): Promise<void> {
  if (arch !== 'arm64' && arch !== 'x64') throw new Error(`desktop seed profile: unsupported architecture ${arch}`)
  const modules: unknown = load(readFileSync(join(nodeModules, '.modules.yaml'), 'utf8'))
  if (!record(modules) || typeof modules.storeDir !== 'string' || modules.nodeLinker !== 'hoisted') {
    throw new Error('desktop seed profile: expected hoisted pnpm module metadata')
  }
  const storeVersion = basename(modules.storeDir)
  if (!/^v\d+$/u.test(storeVersion)) throw new Error('desktop seed profile: invalid store version')
  // These paths belong to the installation, not the release artifact.
  delete modules.storeDir
  delete modules.virtualStoreDir
  const directories: string[] = []
  const files: ProfileFile[] = []
  const sources: { path: string; source: string }[] = []
  const visit = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (path === '.modules.yaml' || path === '.pnpm-workspace-state-v1.json') continue
      if (!safePath(path) || entry.isSymbolicLink()) throw new Error(`desktop seed profile: unsupported path ${path}`)
      const source = join(directory, entry.name)
      if (entry.isDirectory()) {
        directories.push(path)
        visit(source, path)
        continue
      }
      if (!entry.isFile()) throw new Error(`desktop seed profile: unsupported file ${path}`)
      sources.push({ path, source })
    }
  }
  visit(nodeModules, '')
  await writeBatch(sources, async ({ path, source }) => {
    const digest = createHash('sha512').update(await readFile(source)).digest('hex')
    const contentRoot = `${storeVersion}/files/${digest.slice(0, 2)}/${digest.slice(2)}`
    let content = [contentRoot, `${contentRoot}-exec`].find(candidate => existsSync(join(storeRoot, candidate)))
    if (content === undefined) {
      content = (statSync(source).mode & 0o111) === 0 ? contentRoot : `${contentRoot}-exec`
      const destination = join(storeRoot, content)
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(source, destination)
    }
    files.push({ path, content })
  })
  files.sort((left, right) => left.path.localeCompare(right.path))
  const layout: ProfileLayout = { schemaVersion: 1, arch, storeVersion, directories, files, modules }
  writeFileSync(join(seedRoot, SEED_PROFILE_LAYOUT), `${JSON.stringify(layout)}\n`)
}

function readLayout(seedRoot: string): ProfileLayout {
  const value: unknown = JSON.parse(readFileSync(join(seedRoot, SEED_PROFILE_LAYOUT), 'utf8'))
  if (!record(value) || value.schemaVersion !== 1 || value.arch !== process.arch
    || typeof value.storeVersion !== 'string' || !/^v\d+$/u.test(value.storeVersion)
    || !Array.isArray(value.directories) || !value.directories.every(safePath)
    || !Array.isArray(value.files) || !record(value.modules) || value.modules.nodeLinker !== 'hoisted') {
    throw new Error('desktop seed profile: invalid layout or architecture')
  }
  const paths = new Set<string>()
  for (const path of value.directories) {
    const key = path.toLowerCase()
    if (paths.has(key)) throw new Error(`desktop seed profile: duplicate path ${path}`)
    paths.add(key)
  }
  for (const file of value.files) {
    if (!record(file) || !safePath(file.path) || typeof file.content !== 'string'
      || !/^v\d+\/files\/[0-9a-f]{2}\/[0-9a-f]{126}(?:-exec)?$/u.test(file.content)
      || !file.content.startsWith(`${value.storeVersion}/`) || paths.has(file.path.toLowerCase())
      || file.path.toLowerCase() === '.modules.yaml' || file.path.toLowerCase() === '.pnpm-workspace-state-v1.json') {
      throw new Error('desktop seed profile: invalid file or duplicate path')
    }
    paths.add(file.path.toLowerCase())
  }
  return value as unknown as ProfileLayout
}

/**
 * Run `write` over every item with up to 64 calls in flight, starting the next item as soon as a call finishes.
 * No item starts after a failure, and every started call settles before the first failure is thrown.
 */
async function writeBatch<T>(items: readonly T[], write: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0
  let failure: { readonly reason: unknown } | undefined
  const worker = async (): Promise<void> => {
    while (failure === undefined && next < items.length) {
      const item = items[next++] as T
      try {
        await write(item)
      } catch (reason) {
        failure ??= { reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(64, items.length) }, worker))
  if (failure !== undefined) throw failure.reason
}

async function linkProfileFile(source: string, destination: string): Promise<void> {
  try {
    await link(source, destination)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    // Node reports NTFS's 1,024-link limit as UNKNOWN rather than EMLINK.
    if (code !== 'EMLINK' && !(process.platform === 'win32' && code === 'UNKNOWN' && (await stat(source)).nlink >= 1024)) {
      throw error
    }
    await copyFile(source, destination, constants.COPYFILE_EXCL)
  }
}

/**
 * Recreate the packaged Windows dependency tree by hard-linking complete content objects into an empty profile.
 * Each reused writable-store object receives one digest check, and all checks pass before the first file is linked;
 * freshly verified extraction results retain their archive verification. No dependency resolution or lifecycle
 * script runs. All writers finish before rejection.
 * Files whose content object reached the filesystem's hard-link limit are copied with exclusive destination creation.
 * @param seedRoot - Integrity-verified seed containing the layout.
 * @param storeRoot - Persistent store populated from that seed's verified archives, on the profile's volume.
 * @param stagingProfile - New profile receiving node_modules.
 * @param activeProfile - Final profile location recorded in pnpm's installation metadata.
 * @param extracted - Paths freshly extracted from an integrity-verified seed and merged under the transaction lock;
 *   only these objects skip the persistent-store digest check.
 * @returns Resolves after every file and the relocated pnpm metadata are installed.
 */
export async function installSeedProfileLayout(
  seedRoot: string,
  storeRoot: string,
  stagingProfile: string,
  activeProfile: string,
  extracted: ReadonlySet<string> = new Set(),
): Promise<void> {
  const layout = readLayout(seedRoot)
  const destination = join(stagingProfile, 'node_modules')
  await mkdir(destination)
  await writeBatch(layout.directories, path => mkdir(join(destination, path), { recursive: true }))
  // All checks run before the first link: on Windows, linking a file right after reading it costs several times as
  // much as the two steps apart (.agents/notes/implemented/bug-fix/2026-11-06-desktop-update-layout-and-health-check-speed.md).
  const reused = [...new Set(layout.files.filter(file => !extracted.has(file.content)).map(file => file.content))]
  await writeBatch(reused, async (content) => {
    const digest = createHash('sha512').update(await readFile(join(storeRoot, content))).digest('hex')
    const expected = content.split('/').slice(2).join('').replace(/-exec$/u, '')
    if (digest !== expected) throw new Error(`desktop seed profile: corrupt store content ${content}`)
  })
  await writeBatch(layout.files, file => linkProfileFile(join(storeRoot, file.content), join(destination, file.path)))
  writeFileSync(join(destination, '.modules.yaml'), `${JSON.stringify({
    ...layout.modules,
    storeDir: join(storeRoot, layout.storeVersion),
    virtualStoreDir: join(activeProfile, 'node_modules', '.pnpm'),
  }, null, 2)}\n`)
}
