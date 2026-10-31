/**
 * Install the `gws` binary the Google connectors spawn through `GWS_BIN`.
 *
 * `@googleworkspace/cli` publishes one build per target triple and its own installer refuses a host it has no
 * build for, which is every Windows on ARM machine; Windows on ARM runs the x64 build under emulation. Aeven
 * runs this script instead of that installer — the workspace and the packaged Desktop seed both deny the
 * package's own build script — so one code path covers every platform, including the emulated case.
 */

import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { x as untar } from 'tar'

/** Rust target triple of the build this host runs, matching the package's `supportedPlatforms` keys. */
const TRIPLE = targetTriple()

await installBuild()

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
  const releaseUrl = `https://github.com/googleworkspace/cli/releases/download/v${manifest.version}/${build.artifact}`
  const archive = await download(releaseUrl)
  await verifyChecksum(releaseUrl, archive)
  mkdirSync(dirname(binary), { recursive: true })
  writeFileSync(binary, await extract(archive, build.artifact, build.binary))
  chmodSync(binary, 0o755)
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
 * @param url - Release asset to fetch.
 * @returns the path of the downloaded asset in the operating system's temporary directory.
 */
async function download(url) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  const path = join(tmpdir(), `gws-${process.pid}-${url.slice(url.lastIndexOf('/') + 1)}`)
  writeFileSync(path, new Uint8Array(await response.arrayBuffer()))
  return path
}

/**
 * @param url - Release asset the archive came from; its `.sha256` sibling carries the expected digest.
 * @param archive - Path of the downloaded archive to check.
 * @returns nothing; a digest mismatch throws.
 */
async function verifyChecksum(url, archive) {
  const response = await fetch(`${url}.sha256`, { redirect: 'follow' })
  if (!response.ok) throw new Error(`${url}.sha256 answered ${response.status}`)
  const expected = (await response.text()).trim().split(/\s+/u)[0].toLowerCase()
  const actual = createHash('sha256').update(readFileSync(archive)).digest('hex')
  if (actual !== expected) throw new Error(`${url} checksum ${actual} does not match ${expected}`)
}
