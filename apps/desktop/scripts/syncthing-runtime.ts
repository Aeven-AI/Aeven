/**
 * Download, verify, and install the pinned upstream Syncthing executable that workspace file sync runs. The packaged
 * runtime and the source launch install it the same way; only the destination differs.
 */

import { createHash } from 'node:crypto'
import { cpSync, createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { chmod, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { unzipSync } from 'fflate'
import { extract } from 'tar'

/** Upstream Syncthing release shipped for workspace file sync; its tag is `v<version>`. */
export const SYNCTHING_VERSION = '2.1.7'

/** Where {@link installSyncthing} reads and writes. */
export interface SyncthingInstall {
  /** Target operating system. */
  readonly platform: 'darwin' | 'linux' | 'win'
  /** Target architecture. */
  readonly arch: 'arm64' | 'x64'
  /** Cache of downloaded archives and checksum lists; a cached file is reused and verified again. */
  readonly downloads: string
  /** Scratch directory for extraction; it is replaced and removed. */
  readonly extraction: string
  /** Directory that receives the executable and `LICENSE.txt`; it is replaced. */
  readonly destination: string
}

async function download(url: string, path: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`syncthing runtime: ${url} returned HTTP ${String(response.status)}`)
  writeFileSync(path, new Uint8Array(await response.arrayBuffer()), { mode: 0o600 })
}

/** The Syncthing release archive for one target and the archive's top-level folder. */
function syncthingArchive(platform: SyncthingInstall['platform'], arch: SyncthingInstall['arch']): { name: string; folder: string } {
  const upstreamPlatform = platform === 'darwin' ? 'macos' : platform === 'win' ? 'windows' : 'linux'
  const upstreamArch = arch === 'x64' ? 'amd64' : 'arm64'
  const folder = `syncthing-${upstreamPlatform}-${upstreamArch}-v${SYNCTHING_VERSION}`
  return { name: `${folder}.${platform === 'linux' ? 'tar.gz' : 'zip'}`, folder }
}

/**
 * Download the release archive into the cache when absent, check it against the release's SHA-256 list, and install
 * the executable and its license into the destination.
 * @param install - target and directories.
 * @returns the installed executable's path.
 * @throws {Error} when a download fails, the checksum does not match, or the archive lacks the executable.
 */
export async function installSyncthing(install: SyncthingInstall): Promise<string> {
  const { platform, arch, downloads, extraction, destination } = install
  const { name: archiveName, folder } = syncthingArchive(platform, arch)
  const releaseRoot = `https://github.com/syncthing/syncthing/releases/download/v${SYNCTHING_VERSION}`
  mkdirSync(downloads, { recursive: true })
  const archive = join(downloads, archiveName)
  const sums = join(downloads, `syncthing-v${SYNCTHING_VERSION}-sha256sum.txt.asc`)
  if (!existsSync(archive)) await download(`${releaseRoot}/${archiveName}`, archive)
  if (!existsSync(sums)) await download(`${releaseRoot}/sha256sum.txt.asc`, sums)
  // The checksum list is clear-signed; its body lines are `<sha256>  <file>`.
  const line = (await readFile(sums, 'utf8')).split(/\r?\n/u)
    .find(candidate => candidate.endsWith(`  ${archiveName}`))
  if (line === undefined) throw new Error(`syncthing runtime: ${archiveName} is absent from the Syncthing checksums`)
  const expected = line.split(/\s+/u)[0]
  const actual = createHash('sha256').update(await readFile(archive)).digest('hex')
  if (actual !== expected) throw new Error(`syncthing runtime: checksum mismatch for ${archiveName}`)

  const executable = platform === 'win' ? 'syncthing.exe' : 'syncthing'
  const shipped = new Set([`${folder}/${executable}`, `${folder}/LICENSE.txt`])
  rmSync(extraction, { recursive: true, force: true })
  mkdirSync(extraction, { recursive: true })
  if (platform === 'linux') {
    await extract({ cwd: extraction, file: archive, filter: path => shipped.has(path.replace(/^\.\//u, '')) })
  } else {
    const files = unzipSync(await readFile(archive), { filter: file => shipped.has(file.name) })
    mkdirSync(join(extraction, folder), { recursive: true })
    for (const [name, bytes] of Object.entries(files)) writeFileSync(join(extraction, name), bytes)
  }
  const source = join(extraction, folder, executable)
  if (!existsSync(source)) throw new Error(`syncthing runtime: ${archiveName} has no ${executable}`)

  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  const installed = join(destination, executable)
  // A fresh write, so macOS validates the signature the packager applies.
  await pipeline(createReadStream(source), createWriteStream(installed, { flags: 'wx' }))
  if (platform !== 'win') await chmod(installed, 0o755)
  cpSync(join(extraction, folder, 'LICENSE.txt'), join(destination, 'LICENSE.txt'))
  rmSync(extraction, { recursive: true, force: true })
  return installed
}
