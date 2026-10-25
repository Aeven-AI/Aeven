/**
 * Download and verify the upstream Node.js runtime with its bundled npm and the Cua Driver computer-use executable,
 * and copy the pinned pnpm CLI.
 */

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { chmod, readdir, readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { unzipSync } from 'fflate'
import { extract } from 'tar'
import { resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'

const NODE_VERSION = '24.17.0'
/** Upstream Cua Driver release shipped beside Node.js; its tag is `cua-driver-rs-v<version>`. */
const CUA_DRIVER_VERSION = '0.35.4'
/** Attempts per upstream file, so one DNS lapse or dropped connection does not fail a release build. */
const DOWNLOAD_ATTEMPTS = 4
/** Delay before the second attempt; each later attempt doubles it. */
const DOWNLOAD_BACKOFF_MS = 2_000
/** Ceiling for the doubling delay. */
const DOWNLOAD_BACKOFF_CAP_MS = 30_000
/** Per-attempt ceiling, so a socket that stops answering fails and retries instead of holding the release job. */
const DOWNLOAD_ATTEMPT_TIMEOUT_MS = 300_000
const BUILD_PATHS = resolveDesktopTargetBuildPaths()
const RUNTIME_ROOT = BUILD_PATHS.runtime
const DOWNLOAD_ROOT = BUILD_PATHS.downloads

type RuntimePlatform = 'darwin' | 'linux' | 'win'
type RuntimeArch = 'arm64' | 'x64'

function target(): { platform: RuntimePlatform; arch: RuntimeArch } {
  const rawPlatform = process.env.AVN_DESKTOP_TARGET_PLATFORM ?? process.env.npm_config_platform ?? process.platform
  const rawArch = process.env.AVN_DESKTOP_TARGET_ARCH ?? process.env.npm_config_arch ?? process.arch
  const platform = rawPlatform === 'win32' ? 'win' : rawPlatform
  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win') {
    throw new Error(`desktop runtime: unsupported platform ${rawPlatform}`)
  }
  if (rawArch !== 'arm64' && rawArch !== 'x64') throw new Error(`desktop runtime: unsupported architecture ${rawArch}`)
  return { platform, arch: rawArch }
}

/** One upstream file and the cache path it is stored at. */
interface UpstreamFile {
  readonly url: string
  readonly path: string
}

/** An upstream answer no later attempt can change: the file is not published at that address. */
class MissingUpstreamFileError extends Error {}

/**
 * @param milliseconds - How long to wait.
 * @returns Resolves after the delay.
 */
async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds)
  })
}

/**
 * @param error - Failure raised by one download attempt.
 * @returns Its message, following Node's fetch error chain to the network fault it wraps.
 */
function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message
}

/**
 * @param path - File to hash.
 * @returns The file's hex-encoded SHA-256 digest.
 */
async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

/**
 * Download one upstream file into the cache, retrying the failures a later attempt can clear.
 * The bytes land in a sibling `.part` file and are renamed into place, so an interrupted transfer never leaves a
 * file that a later build mistakes for a complete cached download.
 * @param file - Upstream address and cache path.
 * @param attempt - Attempt number, which bounds the retries and scales the backoff.
 */
async function downloadFile(file: UpstreamFile, attempt = 1): Promise<void> {
  const partial = `${file.path}.part`
  try {
    const response = await fetch(file.url, { signal: AbortSignal.timeout(DOWNLOAD_ATTEMPT_TIMEOUT_MS) })
    if (!response.ok) {
      const message = `desktop runtime: ${file.url} returned HTTP ${String(response.status)}`
      // Only server faults and rate limiting are worth another attempt; a 4xx answer says the file is not there.
      if (response.status < 500 && response.status !== 429) throw new MissingUpstreamFileError(message)
      throw new Error(message)
    }
    writeFileSync(partial, new Uint8Array(await response.arrayBuffer()), { mode: 0o600 })
    renameSync(partial, file.path)
  } catch (error) {
    rmSync(partial, { force: true })
    if (error instanceof MissingUpstreamFileError || attempt === DOWNLOAD_ATTEMPTS) throw error
    const backoff = Math.min(DOWNLOAD_BACKOFF_MS * 2 ** (attempt - 1), DOWNLOAD_BACKOFF_CAP_MS)
    console.warn(`desktop runtime: ${file.url} attempt ${String(attempt)} failed (${describeFailure(error)}); retrying in ${String(backoff)}ms`)
    await delay(backoff)
    await downloadFile(file, attempt + 1)
  }
}

/**
 * Resolve the checksum an upstream archive must match, fetching the checksum file when it is not cached.
 * @param sums - Checksum file's upstream address and cache path.
 * @param archiveName - Archive file name to find in the checksum file.
 * @param absent - Message for a checksum file that does not list the archive.
 * @returns The expected hex-encoded SHA-256 digest.
 */
async function expectedChecksum(sums: UpstreamFile, archiveName: string, absent: string): Promise<string> {
  const listed = async (): Promise<string | undefined> => {
    if (!existsSync(sums.path)) await downloadFile(sums)
    const line = (await readFile(sums.path, 'utf8')).split(/\r?\n/u)
      .find(candidate => candidate.endsWith(`  ${archiveName}`))
    return line?.split(/\s+/u)[0]
  }
  const checksum = await listed()
  if (checksum !== undefined) return checksum
  // A checksum file cached by an interrupted download lists nothing: fetch it again before failing.
  rmSync(sums.path, { force: true })
  const refreshed = await listed()
  if (refreshed === undefined) throw new Error(absent)
  return refreshed
}

/**
 * Resolve an upstream archive into the cache and verify it against its checksum file.
 * A cached archive that fails verification is fetched again, so a truncated download left by an interrupted run
 * cannot fail every later build.
 * @param archive - Archive's upstream address and cache path.
 * @param sums - Checksum file's upstream address and cache path.
 * @param absent - Message for a checksum file that does not list the archive.
 * @returns The verified archive's cache path.
 */
async function verifiedArchive(archive: UpstreamFile, sums: UpstreamFile, absent: string): Promise<string> {
  const archiveName = basename(archive.path)
  const checksum = await expectedChecksum(sums, archiveName, absent)
  if (existsSync(archive.path) && await sha256(archive.path) === checksum) return archive.path
  rmSync(archive.path, { force: true })
  await downloadFile(archive)
  if (await sha256(archive.path) !== checksum) throw new Error(`desktop runtime: checksum mismatch for ${archiveName}`)
  return archive.path
}

/**
 * Launchers beside the bundled `node` that run the archive's npm CLIs with it, so a Host spawn of a bare `npm` or
 * `npx` resolves on a machine with no Node.js installed.
 */
function writeNpmLaunchers(platform: RuntimePlatform, nodeRoot: string): void {
  for (const cli of ['npm', 'npx']) {
    if (platform === 'win') {
      writeFileSync(join(nodeRoot, `${cli}.cmd`), `@"%~dp0node.exe" "%~dp0..\\npm\\bin\\${cli}-cli.js" %*\r\n`)
    } else {
      const launcher = join(nodeRoot, cli)
      writeFileSync(launcher, [
        '#!/bin/sh',
        'dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)',
        `exec "$dir/node" "$dir/../npm/bin/${cli}-cli.js" "$@"`,
        '',
      ].join('\n'), { mode: 0o755 })
    }
  }
}

/**
 * Download, verify, and install Node.js and its bundled npm into the runtime directory.
 * @returns the bundled npm version.
 */
async function prepareNode(platform: RuntimePlatform, arch: RuntimeArch): Promise<string> {
  const extension = platform === 'win' ? 'zip' : 'tar.gz'
  const folder = `node-v${NODE_VERSION}-${platform}-${arch}`
  const archiveName = `${folder}.${extension}`
  const releaseRoot = `https://nodejs.org/download/release/v${NODE_VERSION}`
  const archive = await verifiedArchive(
    { url: `${releaseRoot}/${archiveName}`, path: join(DOWNLOAD_ROOT, archiveName) },
    { url: `${releaseRoot}/SHASUMS256.txt`, path: join(DOWNLOAD_ROOT, `node-v${NODE_VERSION}-SHASUMS256.txt`) },
    `desktop runtime: ${archiveName} is absent from Node.js SHASUMS256.txt`,
  )

  const extraction = BUILD_PATHS.nodeExtract
  rmSync(extraction, { recursive: true, force: true })
  mkdirSync(extraction, { recursive: true })
  const npmEntry = platform === 'win' ? `${folder}/node_modules/npm/` : `${folder}/lib/node_modules/npm/`
  if (platform === 'win') {
    // Only node.exe and npm are shipped; extract-zip 2.0.1 stalls mid-archive on Node 26 and leaves this await unsettled.
    const entry = `${folder}/node.exe`
    const files = unzipSync(await readFile(archive), {
      filter: file => file.name === entry || (file.name.startsWith(npmEntry) && !file.name.endsWith('/')),
    })
    if (files[entry] === undefined) throw new Error(`desktop runtime: ${archiveName} has no ${entry}`)
    for (const [name, bytes] of Object.entries(files)) {
      const path = join(extraction, name)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, bytes)
    }
  } else await extract({ cwd: extraction, file: archive })
  const source = join(extraction, folder, platform === 'win' ? 'node.exe' : 'bin/node')
  const npmSource = join(extraction, npmEntry)
  const npmManifest = JSON.parse(readFileSync(join(npmSource, 'package.json'), 'utf8')) as { version?: unknown }
  if (typeof npmManifest.version !== 'string') throw new Error(`desktop runtime: ${archiveName} carries no npm version`)
  const npmDestination = join(RUNTIME_ROOT, 'npm')
  rmSync(npmDestination, { recursive: true, force: true })
  cpSync(npmSource, npmDestination, { recursive: true })
  const destinationRoot = join(RUNTIME_ROOT, 'node')
  const destination = join(destinationRoot, platform === 'win' ? 'node.exe' : 'node')
  rmSync(destinationRoot, { recursive: true, force: true })
  mkdirSync(destinationRoot, { recursive: true })
  // A fresh write prevents macOS from retaining invalid code-signature vnode state from a tar-extracted Mach-O clone.
  await pipeline(createReadStream(source), createWriteStream(destination, { flags: 'wx' }))
  if (platform !== 'win') await chmod(destination, 0o755)
  writeNpmLaunchers(platform, destinationRoot)
  const hostPlatform = process.platform === 'win32' ? 'win' : process.platform
  // Windows on ARM runs the x64 build under emulation.
  const hostCanExecute = platform === hostPlatform
    && (arch === process.arch || (platform === 'win' && process.arch === 'arm64' && arch === 'x64'))
  if (hostCanExecute) {
    const result = spawnSync(destination, ['--version'], { encoding: 'utf8' })
    if (result.error !== undefined || result.status !== 0 || result.stdout.trim() !== `v${NODE_VERSION}`) {
      const detail = result.error?.message ?? result.signal ?? result.stderr.trim()
      const outcome = detail === '' ? `exit ${String(result.status)}` : detail
      throw new Error(`desktop runtime: prepared Node.js ${NODE_VERSION} failed executable verification: ${outcome}`)
    }
    // Windows cannot spawn the `.cmd` launcher without a shell, so it verifies the CLI the launcher runs.
    const npx = platform === 'win'
      ? spawnSync(destination, [join(npmDestination, 'bin', 'npx-cli.js'), '--version'], { encoding: 'utf8' })
      : spawnSync(join(destinationRoot, 'npx'), ['--version'], { encoding: 'utf8' })
    if (npx.error !== undefined || npx.status !== 0 || npx.stdout.trim() !== npmManifest.version) {
      const detail = npx.error?.message ?? npx.signal ?? npx.stderr.trim()
      const outcome = detail === '' ? `exit ${String(npx.status)}` : detail
      throw new Error(`desktop runtime: bundled npx ${npmManifest.version} failed verification: ${outcome}`)
    }
  }
  rmSync(extraction, { recursive: true, force: true })
  return npmManifest.version
}

/**
 * The release archive carrying the bare driver executables for one target. Every macOS archive holds the same
 * universal binary, so both macOS targets take the universal one.
 */
function cuaDriverArchive(platform: RuntimePlatform, arch: RuntimeArch): string {
  const upstreamArch = arch === 'x64' ? 'x86_64' : 'arm64'
  const asset = platform === 'darwin'
    ? 'darwin-universal-binary.tar.gz'
    : platform === 'linux' ? `linux-${upstreamArch}-binary.tar.gz` : `windows-${upstreamArch}-binary.zip`
  return `cua-driver-rs-${CUA_DRIVER_VERSION}-${asset}`
}

/**
 * Whether an archive entry belongs in the shipped driver directory: the driver, its cursor-theme tool, the
 * Windows UI Automation helper, and the GNOME Shell extension a Linux Wayland session needs. The SDK library,
 * Node addon, and C header serve embedding through the SDK, which Aeven does not use.
 */
function shipsCuaDriverEntry(name: string): boolean {
  return /^(?:cua-driver|cua-cursor-theme|cua-driver-uia)(?:\.exe)?$/u.test(name) || name.startsWith('wayland-helper/')
}

/**
 * Download, verify, and install the Cua Driver executables into `runtime/cua-driver`, where the shell points the
 * Host's computer-use row at them.
 */
async function prepareCuaDriver(platform: RuntimePlatform, arch: RuntimeArch): Promise<void> {
  const archiveName = cuaDriverArchive(platform, arch)
  const releaseRoot = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${CUA_DRIVER_VERSION}`
  const archive = await verifiedArchive(
    { url: `${releaseRoot}/${archiveName}`, path: join(DOWNLOAD_ROOT, archiveName) },
    {
      url: `${releaseRoot}/checksums.txt`,
      path: join(DOWNLOAD_ROOT, `cua-driver-rs-${CUA_DRIVER_VERSION}-checksums.txt`),
    },
    `desktop runtime: ${archiveName} is absent from the Cua Driver checksums`,
  )

  const extraction = BUILD_PATHS.cuaDriverExtract
  rmSync(extraction, { recursive: true, force: true })
  mkdirSync(extraction, { recursive: true })
  if (platform === 'win') {
    const files = unzipSync(await readFile(archive), {
      filter: file => !file.name.endsWith('/') && shipsCuaDriverEntry(file.name),
    })
    for (const [name, bytes] of Object.entries(files)) writeFileSync(join(extraction, name), bytes)
  } else {
    await extract({ cwd: extraction, file: archive, filter: path => shipsCuaDriverEntry(path.replace(/^\.\//u, '')) })
  }
  const executable = platform === 'win' ? 'cua-driver.exe' : 'cua-driver'
  if (!existsSync(join(extraction, executable))) throw new Error(`desktop runtime: ${archiveName} has no ${executable}`)

  const destination = join(RUNTIME_ROOT, 'cua-driver')
  rmSync(destination, { recursive: true, force: true })
  for (const entry of await readdir(extraction, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const source = join(entry.parentPath, entry.name)
    const target = join(destination, source.slice(extraction.length + 1))
    mkdirSync(dirname(target), { recursive: true })
    // A fresh write, as for Node.js above, so macOS validates the signature the packager applies.
    await pipeline(createReadStream(source), createWriteStream(target, { flags: 'wx' }))
    if (platform !== 'win') await chmod(target, (await stat(source)).mode & 0o777)
  }
  rmSync(extraction, { recursive: true, force: true })
}

function preparePnpm(): string {
  const require = createRequire(import.meta.url)
  const manifestPath = require.resolve('pnpm')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error('desktop runtime: pnpm manifest has no version')
  const packageDir = dirname(manifestPath)
  const destination = join(RUNTIME_ROOT, 'pnpm')
  rmSync(destination, { recursive: true, force: true })
  cpSync(packageDir, destination, { recursive: true })
  return manifest.version
}

async function main(): Promise<void> {
  const { platform, arch } = target()
  mkdirSync(DOWNLOAD_ROOT, { recursive: true })
  mkdirSync(RUNTIME_ROOT, { recursive: true })
  const npmVersion = await prepareNode(platform, arch)
  await prepareCuaDriver(platform, arch)
  const pnpmVersion = preparePnpm()
  writeFileSync(join(RUNTIME_ROOT, 'versions.json'), `${JSON.stringify({
    schemaVersion: 1,
    node: NODE_VERSION,
    npm: npmVersion,
    pnpm: pnpmVersion,
    cuaDriver: CUA_DRIVER_VERSION,
  }, undefined, 2)}\n`)
}

await main()
