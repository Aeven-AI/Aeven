/**
 * Placement of a workspace that arrived from another device: the location hint a publishing device records, the
 * directory a receiving device picks for the workspace's files, and whether this device's disk can take them.
 * @module @aeven/workspace/placement
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, statfs } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

/** Numbered alternatives to a taken directory name tried under the placement root. */
const NUMBERED_NAMES = 100

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
  const candidates: string[] = []
  const hinted = hint === undefined ? undefined : hintedDirectory(hint)
  if (hinted !== undefined) candidates.push(hinted)
  const name = directoryName(title)
  for (let index = 1; index <= NUMBERED_NAMES; index += 1) {
    candidates.push(join(root, index === 1 ? name : `${name} (${String(index)})`))
  }
  for (const candidate of candidates) {
    if (await isFree(candidate)) {
      await mkdir(candidate, { recursive: true })
      return candidate
    }
  }
  throw new Error(`no free directory for workspace '${title}' under ${root}`)
}

/**
 * Whether receiving this many bytes under the placement root stays within a size limit and leaves a share of the
 * disk free.
 * @param root - the placement root, which need not exist yet.
 * @param bytes - the size to receive.
 * @param maxBytes - the largest size received without being asked.
 * @param minFreeDiskRatio - the share of the disk, from 0 to 1, that must stay free.
 * @returns whether the files fit.
 */
export async function fitsDisk(root: string, bytes: number, maxBytes: number, minFreeDiskRatio: number): Promise<boolean> {
  if (bytes > maxBytes) return false
  let probe = root
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe)
  const disk = await statfs(probe)
  return disk.bavail * disk.bsize - bytes >= disk.blocks * disk.bsize * minFreeDiskRatio
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
