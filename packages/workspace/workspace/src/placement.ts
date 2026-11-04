/**
 * Placement of a workspace that arrived from another device: the location hint a publishing device records, the
 * directory a receiving device picks for the workspace's files, and whether this device's disk can take them.
 * @module @aeven/workspace/placement
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, statfs, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

/** Numbered alternatives to a taken directory name tried under the placement root. */
const NUMBERED_NAMES = 100

/** The file in a workspace's directory that names the workspace, so another device recognizes its own copy. */
export const WORKSPACE_MARKER = '.aeven-workspace'

/**
 * A directory's path relative to this device's home directory, `/`-separated, which another device turns into its own
 * path when it places the workspace.
 * @param path - absolute directory on this device.
 * @returns the hint, or undefined for the home directory itself or a directory outside it.
 */
export function locationHint(path: string): string | undefined {
  const rel = relative(homedir(), path)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined
  return rel.split(sep).join('/')
}

/**
 * The directory a location hint names on this device.
 * @param hint - a hint {@link locationHint} returned on any device; another device wrote it, so it is checked here.
 * @returns the absolute directory under this device's home directory, or undefined for a hint that would leave it.
 */
export function hintedDirectory(hint: string): string | undefined {
  const segments = hint.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..' || /[\\:\u0000]/u.test(segment))) return undefined
  return join(homedir(), ...segments)
}

/**
 * Pick the directory a received workspace's files take here and create it: the hinted directory when it is free,
 * otherwise the title under the placement root, numbered when the name is taken. A directory is free when it does
 * not exist or is empty, so files already there are never mixed with the workspace's.
 * @param title - the workspace title.
 * @param hint - the publishing device's location hint, when it recorded one.
 * @param root - the placement root.
 * @returns the created or empty directory.
 */
export async function placeWorkspace(title: string, hint: string | undefined, root: string): Promise<string> {
  for (const candidate of placementCandidates(title, hint, root)) {
    if (await isFree(candidate)) {
      await mkdir(candidate, { recursive: true })
      return candidate
    }
  }
  throw new Error(`no free directory for workspace '${title}' under ${root}`)
}

/**
 * Whether receiving this many bytes under the placement root leaves a share of the disk free.
 * @param root - the placement root, which need not exist yet.
 * @param bytes - the size to receive.
 * @param minFreeDiskRatio - the share of the disk, from 0 to 1, that must stay free.
 * @returns whether the files fit.
 */
export async function fitsDisk(root: string, bytes: number, minFreeDiskRatio: number): Promise<boolean> {
  let probe = root
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe)
  const disk = await statfs(probe)
  return disk.bavail * disk.bsize - bytes >= disk.blocks * disk.bsize * minFreeDiskRatio
}

/**
 * Find a directory on this device that already holds a workspace's files: a placement candidate whose marker names
 * the workspace.
 * @param workspace - the workspace id.
 * @param title - the workspace title.
 * @param hint - the publishing device's location hint, when it recorded one.
 * @param root - the placement root.
 * @returns the marked directory, or undefined when none holds the workspace.
 */
export async function markedDirectory(
  workspace: string,
  title: string,
  hint: string | undefined,
  root: string,
): Promise<string | undefined> {
  for (const candidate of placementCandidates(title, hint, root)) {
    if (!existsSync(candidate)) continue
    if (await readMarker(candidate) === workspace) return candidate
  }
  return undefined
}

/**
 * Record in a workspace's directory which workspace it holds; an existing marker is left as it is.
 * @param directory - the workspace's directory.
 * @param workspace - the workspace id.
 */
export async function writeMarker(directory: string, workspace: string): Promise<void> {
  await writeFile(join(directory, WORKSPACE_MARKER), `${JSON.stringify({ workspace })}\n`, { flag: 'wx' }).catch((error: unknown) => {
    // `wx` refuses an existing marker, which stays: it may name a workspace this directory held first.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  })
}

/** The workspace id a directory's marker names, or undefined without a readable marker. */
async function readMarker(directory: string): Promise<string | undefined> {
  let text: string
  try {
    text = await readFile(join(directory, WORKSPACE_MARKER), 'utf8')
  } catch {
    // No marker, or one this device cannot read: the directory is not recognized.
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && 'workspace' in parsed && typeof parsed.workspace === 'string'
      ? parsed.workspace
      : undefined
  } catch {
    // Another device or the user wrote something else into the file; it names no workspace.
    return undefined
  }
}

/** The directories a received workspace may take, in order: the hinted directory, then the title under the root. */
function placementCandidates(title: string, hint: string | undefined, root: string): string[] {
  const candidates: string[] = []
  const hinted = hint === undefined ? undefined : hintedDirectory(hint)
  if (hinted !== undefined) candidates.push(hinted)
  const name = directoryName(title)
  for (let index = 1; index <= NUMBERED_NAMES; index += 1) {
    candidates.push(join(root, index === 1 ? name : `${name} (${String(index)})`))
  }
  return candidates
}

/** A workspace title as one directory name on every platform: separators, reserved characters, and trailing dots replaced. */
function directoryName(title: string): string {
  const cleaned = title.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '-').replace(/[. ]+$/u, '').trim()
  return cleaned === '' ? 'Workspace' : cleaned
}

async function isFree(path: string): Promise<boolean> {
  if (!existsSync(path)) return true
  try {
    return (await readdir(path)).length === 0
  } catch {
    // A path that exists but cannot be listed, such as a file, is not a free directory.
    return false
  }
}
