/**
 * Build the bundled ffmpeg executable for one platform package from the pinned upstream release source.
 *
 * `source.json` pins the ffmpeg release and the libopus release linked statically into the executable. Each
 * names archives from independent hosts with their own SHA-256: ffmpeg's GitHub tag archive is a `git archive`
 * whose bytes differ from the ffmpeg.org tarball. The first archive that downloads and verifies is cached in
 * `.cache/`, and every host is retried in rounds before the build fails. The configure line is LGPL-only: no `--enable-gpl`, no `--enable-nonfree`, and
 * `--disable-autodetect` keeps every external codec library out, so the executable ships beside the
 * Apache-2.0 application under an LGPL notice. H.264 encoding therefore comes from the platform encoder
 * (VideoToolbox or VAAPI) instead of libx264, which is GPL.
 *
 * The executable lands in `packages/<platform>-<arch>/bin/` (git-ignored, packed into that package's
 * tarball). The default target is the host; a macOS host may also build the other macOS architecture.
 * Every other target builds on its own native runner, because this build wires no cross toolchain.
 *
 * Run: `pnpm run build:native [--target <platform>-<arch>] [--clean]`. Needs a C compiler, make, and a
 * zlib development package. x86_64 targets want nasm on PATH for the assembly kernels and build without
 * it otherwise, at a documented decode-speed cost. Windows builds through MSYS2's bash, which supplies the
 * POSIX shell `configure` needs plus the mingw64 or clangarm64 toolchain the target uses.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { x as extractTar } from 'tar'

const ROOT = resolve(import.meta.dirname, '..')
const CACHE = join(ROOT, '.cache')
const TARGETS = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64'] as const
type Target = typeof TARGETS[number]

/** One downloadable copy of a pinned release. */
interface PinnedArchive {
  readonly url: string
  readonly sha256: string
}

/** Pinned upstream release identity: one version and the archives that carry its source tree. */
interface PinnedSource {
  readonly version: string
  readonly archives: readonly PinnedArchive[]
}

/** Everything this build pins: ffmpeg and the one external library it links. */
interface Source extends PinnedSource {
  readonly opus: PinnedSource
}

/** Passes over every archive host before a download failure ends the build; pass `n` first waits `(n - 1) * 15` s. */
const DOWNLOAD_ROUNDS = 3

/**
 * Run one build command, inheriting stdio so compiler diagnostics reach the caller.
 * @param command - executable to run.
 * @param args - arguments passed verbatim, never through a shell.
 * @param cwd - working directory for the command.
 * @param env - environment for the command; the caller's by default.
 * @throws When the command cannot start or exits non-zero.
 */
function run(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync(command, [...args], { cwd, env, stdio: 'inherit' })
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`build: ${command} ${args.join(' ')} failed (${result.error?.message ?? `exit ${String(result.status)}`})`)
  }
}

/**
 * SHA-256 of one file.
 * @param file - absolute path to hash.
 * @returns lowercase hex digest.
 */
function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/**
 * Download one archive and keep it only when it matches its pinned digest.
 * @param archive - pinned URL and SHA-256.
 * @param file - cache path the verified archive is written to.
 * @throws When the request fails, answers non-2xx, or the bytes do not match the digest.
 */
async function download(archive: PinnedArchive, file: string): Promise<void> {
  const response = await fetch(archive.url)
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== archive.sha256) throw new Error(`checksum mismatch (${digest})`)
  writeFileSync(file, bytes)
}

/**
 * Find or download one verified archive of a pinned release.
 * @param name - archive name without the version, used for cache file names.
 * @param source - pinned release identity.
 * @returns absolute path of a cached archive that matches its pinned digest.
 * @throws When every archive host fails in every round.
 */
async function verifiedArchive(name: string, source: PinnedSource): Promise<string> {
  const candidates = source.archives.map(archive => ({
    archive,
    file: join(CACHE, `${name}-${source.version}-${archive.sha256.slice(0, 16)}.tar.gz`),
  }))
  const cached = candidates.find(({ archive, file }) => existsSync(file) && sha256(file) === archive.sha256)
  if (cached !== undefined) return cached.file
  const failures: string[] = []
  for (let round = 1; round <= DOWNLOAD_ROUNDS; round++) {
    if (round > 1) await sleep((round - 1) * 15_000)
    for (const { archive, file } of candidates) {
      try {
        await download(archive, file)
        return file
      } catch (error) {
        const reason = error instanceof Error ? `${error.message}${error.cause instanceof Error ? `: ${error.cause.message}` : ''}` : String(error)
        failures.push(`round ${String(round)} ${archive.url}: ${reason}`)
        console.warn(`build: ${archive.url} failed (${reason})`)
      }
    }
  }
  throw new Error(`build: no ${name} ${source.version} archive could be downloaded\n${failures.join('\n')}`)
}

/**
 * Download, verify, and extract one pinned source release into the cache.
 * @param name - archive name without the version, used for the cached directory.
 * @param source - pinned release identity.
 * @param marker - file, relative to the extracted tree, that proves extraction finished.
 * @returns absolute path of the extracted source directory.
 * @throws When no archive downloads and verifies, or the archive lacks the marker.
 */
async function sourceTree(name: string, source: PinnedSource, marker: string): Promise<string> {
  const tree = join(CACHE, `${name}-${source.version}`)
  if (existsSync(join(tree, marker))) return tree
  mkdirSync(CACHE, { recursive: true })
  const archive = await verifiedArchive(name, source)
  rmSync(tree, { recursive: true, force: true })
  mkdirSync(tree)
  // Hosts name the top-level directory differently (ffmpeg-9.0.2, FFmpeg-n9.0.2), so it is replaced by `tree`.
  await extractTar({ file: archive, cwd: tree, strip: 1 })
  if (!existsSync(join(tree, marker))) throw new Error(`build: ${archive} did not extract ${marker}`)
  return tree
}

/**
 * Read the pinned release identities shipped beside this script.
 * @returns the ffmpeg and libopus versions with each archive's URL and SHA-256 digest.
 */
function readSource(): Source {
  const source = JSON.parse(readFileSync(join(ROOT, 'source.json'), 'utf8')) as Source
  const pinned = [source, source.opus]
  const incomplete = (entry: PinnedSource): boolean => entry.version === '' || entry.archives.length === 0
    || entry.archives.some(archive => archive.url === '' || archive.sha256 === '')
  if (pinned.some(incomplete)) {
    throw new Error('build: source.json is missing a version, an archive, or an archive url or sha256')
  }
  return source
}

/**
 * Resolve the target this host builds without a cross toolchain.
 * @returns `${process.platform}-${process.arch}` when it is a supported target.
 * @throws When the host platform and architecture are unsupported.
 */
function hostTarget(): Target {
  const target = `${process.platform}-${process.arch}`
  if (!(TARGETS as readonly string[]).includes(target)) throw new Error(`build: unsupported host ${target}`)
  return target as Target
}

/**
 * Whether `nasm` can run here, which the x86_64 assembly kernels need.
 * @returns true when the assembler answers `-v`.
 */
function hasNasm(): boolean {
  return spawnSync('nasm', ['-v'], { stdio: 'ignore' }).status === 0
}

/**
 * MSYS2's installation root; the runner may hold it outside `C:\msys64`, and the setup action reports where.
 * @returns absolute path of the MSYS2 root.
 */
function msysRoot(): string {
  const configured = process.env.MSYS2_ROOT
  // An unset or empty variable both mean the runner's default installation; the setup action's output is empty
  // whenever its step was skipped for the other Windows target.
  return configured === undefined || configured === '' ? 'C:\\msys64' : configured
}

/**
 * The MSYS2 environment directory holding one target's toolchain and packages.
 * @param target - Windows platform package being built.
 * @returns absolute Windows path of the ucrt64 or clangarm64 environment.
 */
function msysEnvironment(target: Target): string {
  return join(msysRoot(), target === 'win32-arm64' ? 'clangarm64' : 'clang64')
}

/**
 * MSYS2's bash, which is the POSIX shell `configure` needs on Windows.
 * @returns absolute path of `bash.exe`.
 * @throws When MSYS2 is absent, naming the packages this build needs from it.
 */
function msysBash(): string {
  const root = msysRoot()
  const shell = join(root, 'usr', 'bin', 'bash.exe')
  if (!existsSync(shell)) {
    throw new Error(`build: Windows needs MSYS2 at ${root} (set MSYS2_ROOT) with gcc, make, nasm, and a zlib package`)
  }
  return shell
}

/**
 * Translate a Windows path to the `/c/...` form MSYS2 tools accept.
 * @param path - absolute Windows path.
 * @returns the same path with a slash-prefixed drive.
 */
function msysPath(path: string): string {
  const [drive, ...rest] = path.split(':')
  return `/${drive.toLowerCase()}${rest.join(':').replaceAll('\\', '/')}`
}

/**
 * Rewrite Windows drive paths inside one configure argument into the `/c/...` form MSYS2 tools accept.
 * @param argument - configure argument, possibly carrying a path after `--prefix=`, `-I`, or `-L`.
 * @returns the same argument with every drive path translated.
 */
function msysArgument(argument: string): string {
  return argument.replace(/[A-Za-z]:[\\/][^\s]*/gu, match => msysPath(match))
}

/**
 * Quote one word for a POSIX shell command line.
 * @param word - literal argument.
 * @returns the word in single quotes, with embedded quotes escaped.
 */
function shellQuote(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`
}

/**
 * Run configure then make, through MSYS2 bash on Windows and directly elsewhere.
 * @param target - platform package being built, which selects the Windows toolchain.
 * @param cwd - build directory.
 * @param configure - absolute path of the tree's `configure` script.
 * @param args - configure arguments.
 * @param makeTarget - make goal, including the target platform's executable suffix, or `install`.
 * @param env - extra environment for both steps.
 */
function configureAndMake(target: Target, cwd: string, configure: string, args: readonly string[], makeTarget: string,
  env: NodeJS.ProcessEnv = process.env): void {
  const jobs = `-j${String(availableParallelism())}`
  if (process.platform !== 'win32') {
    run(configure, args, cwd, env)
    run('make', [jobs, makeTarget], cwd, env)
    return
  }
  // The setup action may install MSYS2 outside C:\msys64, and its login profile only assembles PATH for the
  // environment it was told about. Naming the target's own tree here keeps the compiler and pkg-config search
  // path deterministic instead of dependent on what the shell happened to inherit.
  const prefix = msysPath(msysEnvironment(target))
  const script = join(cwd, 'build.sh')
  const exports = Object.entries(env)
    .filter(([key]) => key !== 'PATH')
    .map(([key, value]) => `export ${key}=${shellQuote(String(value))}`)
  writeFileSync(script, [
    '#!/bin/sh',
    'set -e',
    // MSYS2's login shell starts in $HOME, so the build directory is entered explicitly rather than inferred
    // from the spawn's working directory.
    `cd ${shellQuote(msysPath(cwd))}`,
    `export MSYSTEM=${target === 'win32-arm64' ? 'CLANGARM64' : 'CLANG64'}`,
    `export PATH=${prefix}/bin:/usr/bin:/bin`,
    `export PKG_CONFIG_PATH=${prefix}/lib/pkgconfig:${prefix}/share/pkgconfig`,
    ...exports,
    `command -v clang >/dev/null || { echo "build: no clang on PATH=$PATH"; exit 1; }`,
    // configure records every probe in ffbuild/config.log; on failure that log is the only evidence a botched
    // library detection leaves behind, since configure prints one summary line and exits.
    `pkg-config --exists opus && pkg-config --cflags --libs --static opus || echo "build: pkg-config cannot resolve opus"`,
    `${shellQuote(msysPath(configure))} ${args.map(argument => shellQuote(msysArgument(argument))).join(' ')} || { tail -n 120 ffbuild/config.log 2>/dev/null || true; exit 1; }`,
    `make ${jobs} ${makeTarget} || { echo '--- configure summary ---'; grep -aE '^(CONFIG_FFMPEG|CONFIG_PROGRAMS|HAVE_THREADS|HAVE_W32THREADS|HAVE_PTHREADS)=' config.mak 2>/dev/null; tail -n 80 ffbuild/config.log 2>/dev/null; exit 1; }`,
    '',
  ].join('\n'), { mode: 0o755 })
  run(msysBash(), ['-lc', shellQuote(msysPath(script))], cwd)
}

/**
 * Build the pinned libopus as a static library for one target.
 * @param dependency - pinned libopus release identity.
 * @param tree - extracted libopus source directory.
 * @param target - platform package being built.
 * @returns the install prefix holding `include/opus.h` and `lib/libopus.a`.
 */
function buildOpus(dependency: PinnedSource, tree: string, target: Target): string {
  const prefix = join(CACHE, `opus-${target}`)
  if (existsSync(join(prefix, 'lib', 'libopus.a')) && existsSync(join(prefix, 'include', 'opus.h'))) return prefix
  const [platform, arch] = target.split('-') as [string, 'arm64' | 'x64']
  const buildDir = join(CACHE, `opus-build-${target}`)
  rmSync(buildDir, { recursive: true, force: true })
  rmSync(prefix, { recursive: true, force: true })
  mkdirSync(buildDir, { recursive: true })
  const args = ['--disable-shared', '--enable-static', '--disable-doc', '--disable-extra-programs', `--prefix=${prefix}`]
  const env: NodeJS.ProcessEnv = { ...process.env }
  // A macOS host builds the other macOS architecture, and both slices must match the shell's deployment floor
  // rather than the SDK ffmpeg links against.
  const flags: string[] = []
  if (platform === 'darwin') {
    env.MACOSX_DEPLOYMENT_TARGET = '12.0'
    flags.push('-mmacosx-version-min=12.0')
    if (arch !== process.arch) {
      const slice = arch === 'x64' ? 'x86_64' : 'arm64'
      args.push(`--host=${slice}-apple-darwin`)
      flags.push(`-arch ${slice}`)
    }
  }
  if (flags.length > 0) {
    env.CFLAGS = flags.join(' ')
    env.LDFLAGS = env.CFLAGS
  }
  console.log(`build: configure opus ${dependency.version} for ${target}`)
  configureAndMake(target, buildDir, join(tree, 'configure'), args, 'install', env)
  return prefix
}

/**
 * Build the configure arguments for one target and architecture pair.
 * @param target - platform package being built.
 * @param source - pinned release identities, used for the temporary prefix.
 * @param opusPrefix - install prefix of the statically built libopus.
 * @returns configure arguments in the order ffmpeg expects.
 */
function configureArgs(target: Target, source: Source, opusPrefix: string): string[] {
  const [platform, arch] = target.split('-') as [string, 'arm64' | 'x64']
  const args = [
    `--prefix=${join(CACHE, `install-${target}`)}`,
    '--disable-gpl',
    '--disable-nonfree',
    '--disable-version3',
    '--disable-doc',
    '--disable-debug',
    '--disable-network',
    '--disable-autodetect',
    '--disable-programs',
    '--enable-ffmpeg',
    '--disable-avdevice',
    // zlib is permissively licensed and the PNG encoder, which posters prefer over JPEG, depends on it.
    '--enable-zlib',
    // libopus is BSD-licensed and the one external codec kept: the WhatsApp bridge names it explicitly with
    // libopus-only options, and native Opus cannot answer `-c:a libopus -compression_level`.
    '--enable-libopus',
    // Static libopus needs its `Libs.private` entries, which is where Linux gets `-lm` from.
    '--pkg-config-flags=--static',
  ]
  // Windows follows the MSYS2 ffmpeg package recipe: name the target OS and architecture, pass the compiler
  // explicitly, and let the environment's pkg-config find the toolchain's own static libopus. Addressable
  // prefixed tools are not needed, because no cross prefix is declared.
  if (platform === 'win32') {
    args.push('--target-os=mingw32', `--arch=${arch === 'x64' ? 'x86_64' : 'aarch64'}`,
      '--cc=clang', '--extra-libs=-static')
  } else {
    args.push(`--extra-cflags=-I${join(opusPrefix, 'include')}`, `--extra-ldflags=-L${join(opusPrefix, 'lib')}`)
  }
  // Hardware H.264 keeps software GPL encoders out of the build; each host exposes its own.
  if (platform === 'darwin') args.push('--enable-videotoolbox', '--enable-audiotoolbox')
  // Windows Media Foundation stays off: its static MFPlat dependency stops ffmpeg.exe from starting on
  // Windows N editions, which ship without the Media Feature Pack. Software encoders cover posters and audio.
  if (platform === 'linux') args.push('--enable-vaapi')
  if (arch === 'x64' && !hasNasm()) {
    args.push('--disable-x86asm')
    console.warn('build: nasm is absent, so x86 assembly kernels are disabled and decode runs slower')
  }
  if (platform === 'darwin') args.push('--extra-cflags=-mmacosx-version-min=12.0', '--extra-ldflags=-mmacosx-version-min=12.0')
  if (platform === 'darwin' && arch !== process.arch) {
    const slice = arch === 'x64' ? 'x86_64' : 'arm64'
    args.push(`--arch=${slice}`, `--extra-cflags=-arch ${slice}`, `--extra-ldflags=-arch ${slice}`)
  }
  console.log(`build: configure ${source.version} for ${target}`)
  return args
}

/**
 * Strip debug symbols from a built executable, tolerating hosts without a strip binary.
 * @param path - executable to strip in place.
 */
function stripExecutable(path: string): void {
  const candidates = path.endsWith('.exe') ? ['strip.exe', 'strip'] : ['strip']
  for (const strip of candidates) {
    const result = spawnSync(strip, ['-x', path], { stdio: 'inherit' })
    if (result.error === undefined && result.status === 0) return
  }
  console.warn(`build: no strip binary worked for ${path}; shipping unstripped`)
}

/**
 * Configure, compile, and stage one target's executable into its platform package.
 * @param tree - extracted ffmpeg source directory.
 * @param target - platform package being built.
 * @param source - pinned release identities.
 * @param opusPrefix - install prefix of the statically built libopus.
 * @returns the staged executable path.
 */
function build(tree: string, target: Target, source: Source, opusPrefix: string): string {
  const buildDir = join(CACHE, `build-${target}`)
  rmSync(buildDir, { recursive: true, force: true })
  mkdirSync(buildDir, { recursive: true })
  // configure discovers the statically built libopus through pkg-config. On macOS and Linux that is the prefix
  // this script built; on Windows it is the toolchain's own package, which the MSYS2 environment already names.
  const metadata = join(opusPrefix, 'lib', 'pkgconfig')
  const env: NodeJS.ProcessEnv = process.platform === 'win32'
    ? {}
    : { ...process.env, PKG_CONFIG_PATH: metadata }
  const name = target.startsWith('win32-') ? 'ffmpeg.exe' : 'ffmpeg'
  configureAndMake(target, buildDir, join(tree, 'configure'), configureArgs(target, source, opusPrefix), name, env)
  const built = join(buildDir, name)
  if (!existsSync(built)) throw new Error(`build: ${target} produced no ${built}`)
  stripExecutable(built)
  const destination = join(ROOT, 'packages', target, 'bin', name)
  mkdirSync(join(ROOT, 'packages', target, 'bin'), { recursive: true })
  copyFileSync(built, destination)
  chmodSync(destination, 0o755)
  return destination
}

/** Parse arguments, build the requested target, and report the staged size. */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { target: { type: 'string' }, clean: { type: 'boolean' } } })
  const target = (values.target ?? hostTarget()) as Target
  if (!(TARGETS as readonly string[]).includes(target)) {
    throw new Error(`build: unknown target ${target}; expected ${TARGETS.join(', ')}`)
  }
  if (values.clean === true) {
    rmSync(join(CACHE, `build-${target}`), { recursive: true, force: true })
    rmSync(join(CACHE, `opus-build-${target}`), { recursive: true, force: true })
  }
  const source = readSource()
  const tree = await sourceTree('ffmpeg', source, 'configure')
  // A GitHub tag archive has no VERSION file, and without one ffbuild/version.sh reports `git describe` of the
  // enclosing Aeven checkout as ffmpeg's version.
  if (!existsSync(join(tree, 'VERSION'))) writeFileSync(join(tree, 'VERSION'), `${source.version}\n`)
  // MSYS2 ships a static libopus and its pkg-config metadata for each Windows toolchain, so only macOS and Linux
  // build the pinned copy.
  const opusPrefix = process.platform === 'win32'
    ? msysEnvironment(target)
    : buildOpus(source.opus, await sourceTree('opus', source.opus, 'include/opus.h'), target)
  const destination = build(tree, target, source, opusPrefix)
  const megabytes = statSync(destination).size / (1024 * 1024)
  console.log(`build: ffmpeg ${source.version} for ${target} -> ${destination} (${megabytes.toFixed(1)} MB)`)
}

await main()
