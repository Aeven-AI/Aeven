/**
 * Build the private speech worker for one platform package from the pinned whisper.cpp source.
 *
 * The source archive named by `source.json` is downloaded once into `.cache/`, verified against its
 * SHA-256, and extracted; CMake then links `src/worker.cpp` statically against whisper.cpp and the
 * binary lands in `packages/<platform>-<arch>/bin/` (git-ignored, packed into that package's tarball).
 * The default target is the host; macOS hosts may also build `darwin-x64` and `darwin-arm64` for each
 * other. Every other target builds on its own native runner, so no cross toolchain is involved.
 *
 * Run: `pnpm run build:native [--target <platform>-<arch>]` (CMake 3.21+ and a C++17 compiler; Xcode on macOS,
 * Visual Studio Build Tools on Windows, plus its "C++ Clang tools" and "MSBuild support for LLVM" components on
 * Windows ARM64).
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { x as extractTar } from 'tar'

const ROOT = resolve(import.meta.dirname, '..')
const CACHE = join(ROOT, '.cache')
const TARGETS = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64'] as const
type Target = typeof TARGETS[number]
/** Oldest macOS the worker runs on; matches the Electron shell's floor. */
const MACOS_DEPLOYMENT_TARGET = '12.0'

interface Source { readonly version: string; readonly url: string; readonly sha256: string }

function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`build: ${command} ${args.join(' ')} failed (${result.error?.message ?? `exit ${String(result.status)}`})`)
  }
}

async function sourceTree(source: Source): Promise<string> {
  const tree = join(CACHE, `whisper.cpp-${source.version}`)
  if (existsSync(join(tree, 'include', 'whisper.h'))) return tree
  mkdirSync(CACHE, { recursive: true })
  const archive = join(CACHE, `whisper.cpp-${source.version}.tar.gz`)
  if (!existsSync(archive)) {
    const response = await fetch(source.url)
    if (!response.ok) throw new Error(`build: ${source.url} returned HTTP ${String(response.status)}`)
    writeFileSync(archive, new Uint8Array(await response.arrayBuffer()))
  }
  const digest = createHash('sha256').update(readFileSync(archive)).digest('hex')
  if (digest !== source.sha256) {
    rmSync(archive, { force: true })
    throw new Error(`build: whisper.cpp ${source.version} archive checksum mismatch (${digest})`)
  }
  rmSync(tree, { recursive: true, force: true })
  await extractTar({ file: archive, cwd: CACHE })
  if (!existsSync(join(tree, 'include', 'whisper.h'))) throw new Error(`build: archive did not extract to ${tree}`)
  return tree
}

function hostTarget(): Target {
  const target = `${process.platform}-${process.arch}`
  if (!(TARGETS as readonly string[]).includes(target)) throw new Error(`build: unsupported host ${target}`)
  return target as Target
}

function assertBuildable(target: Target): void {
  const host = hostTarget()
  const macosPair = host.startsWith('darwin-') && target.startsWith('darwin-')
  if (target !== host && !macosPair) {
    throw new Error(`build: ${target} builds on its own native runner; this host is ${host}`)
  }
}

/** Platform CMake options: static linking everywhere, Metal on macOS, an AVX2 baseline on x64. */
export function cmakeOptions(target: Target): string[] {
  const options = [
    '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF', '-DWHISPER_BUILD_TESTS=OFF',
    '-DWHISPER_BUILD_EXAMPLES=OFF', '-DWHISPER_BUILD_SERVER=OFF', '-DWHISPER_SDL2=OFF',
    '-DGGML_NATIVE=OFF', '-DGGML_OPENMP=OFF',
  ]
  if (target.startsWith('darwin-')) {
    options.push('-DGGML_METAL=ON', '-DGGML_METAL_EMBED_LIBRARY=ON',
      `-DCMAKE_OSX_ARCHITECTURES=${target === 'darwin-arm64' ? 'arm64' : 'x86_64'}`,
      `-DCMAKE_OSX_DEPLOYMENT_TARGET=${MACOS_DEPLOYMENT_TARGET}`)
  }
  if (target.endsWith('-x64')) options.push('-DGGML_AVX=ON', '-DGGML_AVX2=ON', '-DGGML_FMA=ON', '-DGGML_F16C=ON')
  if (target.startsWith('linux-')) options.push('-DCMAKE_EXE_LINKER_FLAGS=-static-libstdc++ -static-libgcc')
  if (target.startsWith('win32-')) options.push('-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded')
  // ggml's ARM CPU backend rejects MSVC's cl.exe; the Visual Studio ClangCL toolset compiles it.
  if (target === 'win32-arm64') options.push('-A', 'ARM64', '-T', 'ClangCL')
  return options
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { target: { type: 'string' } } })
  const target = (values.target ?? hostTarget()) as Target
  if (!(TARGETS as readonly string[]).includes(target)) throw new Error(`build: unknown target ${target}; expected ${TARGETS.join(', ')}`)
  assertBuildable(target)
  const source = JSON.parse(readFileSync(join(ROOT, 'source.json'), 'utf8')) as Source
  const tree = await sourceTree(source)
  const buildDir = join(CACHE, `build-${target}`)
  run('cmake', ['-S', ROOT, '-B', buildDir, `-DWHISPER_SOURCE_DIR=${tree}`, ...cmakeOptions(target)])
  run('cmake', ['--build', buildDir, '--config', 'Release', '--target', 'avn-whisper-worker', '--parallel'])
  const windows = target.startsWith('win32-')
  const name = windows ? 'avn-whisper-worker.exe' : 'avn-whisper-worker'
  const built = [join(buildDir, name), join(buildDir, 'Release', name)].find(path => existsSync(path))
  if (built === undefined) throw new Error(`build: ${name} was not produced under ${buildDir}`)
  const destination = join(ROOT, 'packages', target, 'bin', name)
  mkdirSync(join(ROOT, 'packages', target, 'bin'), { recursive: true })
  copyFileSync(built, destination)
  console.log(`build: whisper.cpp ${source.version} worker for ${target} -> ${destination}`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) await main()
