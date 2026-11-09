/**
 * Install the `gws` binary the Google connectors spawn through `GWS_BIN`.
 *
 * `@googleworkspace/cli` publishes one build per target triple and its own installer refuses a host it has no
 * build for, which is every Windows on ARM machine; Windows on ARM runs the x64 build under emulation. Aeven
 * runs this script instead of that installer — the workspace and the packaged Desktop seed both deny the
 * package's own build script — so one code path covers every platform, including the emulated case.
 *
 * `--optional` (the package's postinstall) reports a failed install on stderr and exits 0, so a GitHub outage
 * cannot fail a workspace install or a Desktop update; the Google connector runs this script without it before
 * spawning a missing binary, and a failure there fails only that connection.
 */

import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { unzipSync } from 'fflate'
import { x as untar } from 'tar'

/** Rust target triple of the build this host runs, matching the package's `supportedPlatforms` keys. */
const TRIPLE = targetTriple()

/** GitHub repository that publishes the `gws` release assets. */
const REPOSITORY = 'googleworkspace/cli'

/** Rounds of download attempts per asset; GitHub's release 5xx answers change from one request to the next. */
const ATTEMPTS = 3

try {
  await installBuild()
} catch (error) {
  if (!process.argv.includes('--optional')) throw error
  console.warn(`gws was not installed; the Google connectors install it when they first connect: ${error instanceof Error ? error.message : String(error)}`)
}

/** @returns the target triple for this host, or the closest build it can run under emulation. */
function targetTriple() {
  const os = process.platform === 'win32'
    ? 'pc-windows-msvc'
    : process.platform === 'darwin' ? 'apple-darwin' : 'unknown-linux-gnu'
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (process.platform === 'linux' && usesMusl()) return `${arch}-unknown-linux-musl`
  // Windows on ARM has no native build; the x64 one runs under emulation.
  if (process.platform === 'win32' && process.arch === 'arm64') return 'x86_64-pc-windows-msvc'
  return `${arch}-${os}`
}

/** @returns whether this Linux host links musl rather than glibc, read from `ldd`'s own version banner. */
function usesMusl() {
  const result = spawnSync('ldd', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.toLowerCase().includes('musl')
}

/** @returns nothing; the package's `bin/` holds an executable `gws` once this settles. */
async function installBuild() {
  const manifestPath = fileURLToPath(import.meta.resolve('@googleworkspace/cli/package.json'))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const build = manifest.supportedPlatforms[TRIPLE]
  if (build === undefined) throw new Error(`@googleworkspace/cli publishes no ${TRIPLE} build`)
  const binary = join(dirname(manifestPath), 'bin', build.binary)
  if (existsSync(binary)) return
  const archive = join(tmpdir(), `gws-${process.pid}-${build.artifact}`)
  writeFileSync(archive, await fetchAsset(manifest.version, build.artifact))
  await verifyChecksum(manifest.version, build.artifact, archive)
  mkdirSync(dirname(binary), { recursive: true })
  // The binary's presence marks the install complete, so it appears only once fully written.
  const partial = `${binary}.${process.pid}.partial`
  writeFileSync(partial, await extract(archive, build.artifact, build.binary))
  chmodSync(partial, 0o755)
  renameSync(partial, binary)
  rmSync(archive, { force: true })
}

/**
 * @param archive - Path of the downloaded release archive.
 * @param artifact - Archive file name, whose extension selects the container format.
 * @param binary - File name of the `gws` executable inside it.
 * @returns the executable's bytes.
 */
async function extract(archive, artifact, binary) {
  if (artifact.endsWith('.zip')) {
    const entries = unzipSync(new Uint8Array(readFileSync(archive)))
    const entry = Object.keys(entries).find(name => name === binary || name.endsWith(`/${binary}`))
    if (entry === undefined) throw new Error(`${artifact} holds no ${binary}`)
    return entries[entry]
  }
  const directory = join(tmpdir(), `gws-${process.pid}`)
  mkdirSync(directory, { recursive: true })
  await untar({ file: archive, cwd: directory })
  const path = find(directory, binary)
  if (path === undefined) throw new Error(`${artifact} holds no ${binary}`)
  const bytes = readFileSync(path)
  rmSync(directory, { recursive: true, force: true })
  return bytes
}

/**
 * @param directory - Extracted tree to search; release tarballs nest their payload in a versioned directory.
 * @param name - File name to find.
 * @returns the first match's path, or `undefined` when the tree holds none.
 */
function find(directory, name) {
  for (const entry of readdirSync(directory, { recursive: true, encoding: 'utf8' })) {
    if (entry === name || entry.endsWith(`/${name}`)) return join(directory, entry)
  }
  return undefined
}

/**
 * GitHub's browser download route can answer 5xx for an asset while the REST asset route serves the same bytes, so
 * each attempt tries both before the next one waits and retries.
 * @param version - Release version without the `v` prefix.
 * @param name - Release asset file name.
 * @returns the asset's bytes.
 */
async function fetchAsset(version, name) {
  const failures = []
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (attempt > 1) await delay(attempt * 1000)
    for (const source of [browserDownload, apiDownload]) {
      try {
        return await source(version, name)
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }
  }
  throw new Error(`${name} could not be downloaded: ${failures.join('; ')}`)
}

/**
 * @param version - Release version without the `v` prefix.
 * @param name - Release asset file name.
 * @returns the asset's bytes from the browser download route.
 */
async function browserDownload(version, name) {
  const url = `https://github.com/${REPOSITORY}/releases/download/v${version}/${name}`
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * @param version - Release version without the `v` prefix.
 * @param name - Release asset file name.
 * @returns the asset's bytes from the REST asset route.
 */
async function apiDownload(version, name) {
  const releaseUrl = `https://api.github.com/repos/${REPOSITORY}/releases/tags/v${version}`
  const release = await fetch(releaseUrl, { headers: { accept: 'application/vnd.github+json' } })
  if (!release.ok) throw new Error(`${releaseUrl} answered ${release.status}`)
  const asset = (await release.json()).assets.find(entry => entry.name === name)
  if (asset === undefined) throw new Error(`release v${version} lists no ${name}`)
  const response = await fetch(asset.url, { headers: { accept: 'application/octet-stream' }, redirect: 'follow' })
  if (!response.ok) throw new Error(`${asset.url} answered ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * @param version - Release version the archive came from.
 * @param artifact - Archive asset name; its `.sha256` sibling carries the expected digest.
 * @param archive - Path of the downloaded archive to check.
 * @returns nothing; a digest mismatch throws.
 */
async function verifyChecksum(version, artifact, archive) {
  const expected = new TextDecoder().decode(await fetchAsset(version, `${artifact}.sha256`)).trim().split(/\s+/u)[0].toLowerCase()
  const actual = createHash('sha256').update(readFileSync(archive)).digest('hex')
  if (actual !== expected) throw new Error(`${artifact} checksum ${actual} does not match ${expected}`)
}
