/**
 * LibreOffice runtime discovery, verified download, and private installation.
 * @module @aeven/document-extract-office/runtime
 */

import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, readFileSync } from 'node:fs'
import { access, constants, mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { SubprocessSpawnSpec } from '@aeven/subprocess'

/** Release-pinned installer for one platform. */
export interface OfficeAsset {
  readonly name: string
  readonly url: string
  readonly sha256: string
  readonly bytes: number
}

interface AssetLock {
  readonly version: string
  readonly platforms: Readonly<Record<string, OfficeAsset>>
}

/** The pinned lock shipped beside the package. */
export const ASSET_LOCK = JSON.parse(
  readFileSync(new URL('../runtime/assets.json', import.meta.url), 'utf8'),
) as AssetLock

/**
 * Installer for this host, when one is published.
 * @returns the pinned asset, or undefined when LibreOffice publishes no build for this platform.
 */
export function hostAsset(): OfficeAsset | undefined {
  return ASSET_LOCK.platforms[`${process.platform}-${process.arch}`]
}

/** Runs one child process to completion and reports its exit. */
export type RunProcess = (spec: Pick<SubprocessSpawnSpec, 'argv' | 'cwd' | 'signal'>) => Promise<{ exitCode: number | null; stderr: string }>

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return (await stat(path)).isFile()
  } catch {
    // Missing or not executable: this candidate is not a usable install.
    return false
  }
}

/** Directory holding the privately installed runtime. */
export function managedRoot(dataRoot: string): string {
  return join(dataRoot, 'runtime', ASSET_LOCK.version)
}

async function managedCandidates(dataRoot: string): Promise<string[]> {
  const root = managedRoot(dataRoot)
  if (process.platform === 'darwin') return [join(root, 'LibreOffice.app', 'Contents', 'MacOS', 'soffice')]
  if (process.platform !== 'win32') return []
  // An administrative MSI extract nests the tree under a vendor directory whose name varies by release.
  const found: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 4) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      // Unreadable or absent directory: nothing below it to consider.
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const child = join(dir, entry.name)
      if (entry.name.toLowerCase() === 'program') found.push(join(child, 'soffice.com'), join(child, 'soffice.exe'))
      else await walk(child, depth + 1)
    }
  }
  await walk(root, 0)
  return found
}

function systemCandidates(): string[] {
  switch (process.platform) {
    case 'darwin':
      return [
        '/Applications/LibreOffice.app/Contents/MacOS/soffice',
        join(homedir(), 'Applications', 'LibreOffice.app', 'Contents', 'MacOS', 'soffice'),
      ]
    case 'win32': {
      const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter((root): root is string => root !== undefined)
      return roots.flatMap(root => [join(root, 'LibreOffice', 'program', 'soffice.com'), join(root, 'LibreOffice', 'program', 'soffice.exe')])
    }
    default:
      return [
        '/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/lib/libreoffice/program/soffice',
        '/opt/libreoffice/program/soffice', '/snap/bin/libreoffice',
        ...(process.env.PATH ?? '').split(delimiter).filter(dir => dir !== '').map(dir => join(dir, 'soffice')),
      ]
  }
}

/**
 * Locate a usable `soffice`: the configured path, then the managed runtime,
 * then a system installation when allowed.
 * @param options - explicit path, data root, and system-install policy.
 * @returns the executable path, or undefined when none is present.
 */
export async function locateOffice(options: {
  readonly sofficePath?: string | undefined
  readonly dataRoot: string
  readonly useSystemInstall: boolean
}): Promise<string | undefined> {
  if (options.sofficePath !== undefined) return await executable(options.sofficePath) ? options.sofficePath : undefined
  const candidates = [
    ...await managedCandidates(options.dataRoot),
    ...options.useSystemInstall ? systemCandidates() : [],
  ]
  for (const candidate of candidates) if (await executable(candidate)) return candidate
  return undefined
}

/**
 * Download the pinned installer into a partial file, verify length and
 * digest, then publish it atomically.
 * @param asset - pinned installer.
 * @param directory - download directory.
 * @param signal - preparation cancellation.
 * @param progress - byte progress callback.
 * @returns the verified installer path.
 */
export async function downloadInstaller(
  asset: OfficeAsset,
  directory: string,
  signal: AbortSignal,
  progress: (receivedBytes: number) => void,
): Promise<string> {
  await mkdir(directory, { recursive: true })
  const destination = join(directory, asset.name)
  const partial = `${destination}.${randomUUID()}.part`
  try {
    const response = await fetch(asset.url, { signal })
    if (!response.ok || response.body === null) {
      await response.body?.cancel()
      throw new Error(`LibreOffice download failed with HTTP ${response.status}`)
    }
    const digest = createHash('sha256')
    let received = 0
    const hashing = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        if (received > asset.bytes) {
          callback(new Error('LibreOffice download is larger than the pinned installer'))
          return
        }
        digest.update(chunk)
        progress(received)
        callback(null, chunk)
      },
    })
    await pipeline(response.body, hashing, createWriteStream(partial, { flags: 'wx', mode: 0o600 }), { signal })
    if (received !== asset.bytes || digest.digest('hex') !== asset.sha256) {
      throw new Error('LibreOffice download failed integrity verification')
    }
    await rename(partial, destination)
    return destination
  } finally {
    await rm(partial, { force: true })
  }
}

async function requireExit(run: RunProcess, spec: Pick<SubprocessSpawnSpec, 'argv' | 'cwd' | 'signal'>, action: string): Promise<void> {
  const { exitCode, stderr } = await run(spec)
  if (exitCode !== 0) throw new Error(`${action} failed (exit ${String(exitCode)}): ${stderr.trim().slice(0, 500)}`)
}

/**
 * Install a verified installer into the managed runtime directory without
 * touching the system: the macOS disk image is mounted read-only and its
 * application copied; the Windows package is extracted administratively.
 * @param installer - verified installer path.
 * @param dataRoot - provider data root.
 * @param run - subprocess runner.
 * @param signal - preparation cancellation.
 */
export async function installRuntime(installer: string, dataRoot: string, run: RunProcess, signal: AbortSignal): Promise<void> {
  const target = managedRoot(dataRoot)
  const staging = `${target}.${randomUUID()}.staging`
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  try {
    if (process.platform === 'darwin') {
      const mount = await mkdtemp(join(tmpdir(), 'avn-office-mount-'))
      await requireExit(run, { argv: ['hdiutil', 'attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, installer], cwd: dataRoot, signal }, 'Mounting the LibreOffice disk image')
      try {
        await requireExit(run, { argv: ['ditto', join(mount, 'LibreOffice.app'), join(staging, 'LibreOffice.app')], cwd: dataRoot, signal }, 'Copying LibreOffice')
      } finally {
        await run({ argv: ['hdiutil', 'detach', mount, '-force'], cwd: dataRoot })
        await rm(mount, { recursive: true, force: true })
      }
    } else if (process.platform === 'win32') {
      await requireExit(run, { argv: ['msiexec', '/a', installer, '/qn', `TARGETDIR=${staging}`], cwd: dataRoot, signal }, 'Extracting the LibreOffice package')
    } else {
      throw new Error('LibreOffice is installed through the system package manager on this platform')
    }
    await rm(target, { recursive: true, force: true })
    await rename(staging, target)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
