/** Build one release target with matching Electron, Node.js, and seed architecture. */

import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { join, resolve } from 'node:path'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { desktopPackageProblems } from './desktop-package-preflight.ts'
import { loadDesktopPackagingEnvironment } from './desktop-environment-file.ts'
import { DESKTOP_UNSIGNED_ENV, resolveDesktopAppId, resolveMacOSSigningEnvironment } from './desktop-release-environment.mjs'
import { signMacOSSeedCode, verifyMacOSSeedCode } from './verify-macos-signature.mjs'
import { WINDOWS_SIGNING_ENV_NAMES } from './windows-azure-signing.mjs'
import { pnpmInvocation } from '../../../scripts/pnpm-invocation.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')

/** Fixed platform and architecture identifiers exposed by package scripts. */
export type DesktopPackageTargetName = 'mac-arm64' | 'win-arm64' | 'win-x64' | 'linux-arm64' | 'linux-x64'

/** One supported release target and its electron-builder selectors. */
export interface DesktopPackageTarget {
  readonly name: DesktopPackageTargetName
  readonly platform: 'darwin' | 'win32' | 'linux'
  readonly arch: 'arm64' | 'x64'
  readonly builderPlatform: '--mac' | '--win' | '--linux'
  readonly builderArch: '--arm64' | '--x64'
}

const TARGETS: Record<DesktopPackageTargetName, DesktopPackageTarget> = {
  'mac-arm64': {
    name: 'mac-arm64',
    platform: 'darwin',
    arch: 'arm64',
    builderPlatform: '--mac',
    builderArch: '--arm64',
  },
  'win-arm64': {
    name: 'win-arm64',
    platform: 'win32',
    arch: 'arm64',
    builderPlatform: '--win',
    builderArch: '--arm64',
  },
  'win-x64': {
    name: 'win-x64',
    platform: 'win32',
    arch: 'x64',
    builderPlatform: '--win',
    builderArch: '--x64',
  },
  'linux-arm64': {
    name: 'linux-arm64',
    platform: 'linux',
    arch: 'arm64',
    builderPlatform: '--linux',
    builderArch: '--arm64',
  },
  'linux-x64': {
    name: 'linux-x64',
    platform: 'linux',
    arch: 'x64',
    builderPlatform: '--linux',
    builderArch: '--x64',
  },
}

/**
 * Remove the Windows signing credentials from package preparation subprocesses;
 * only electron-builder, which signs, receives them.
 * @param environment - Packaging command environment.
 * @returns A copy without Windows signing fields.
 */
export function withoutWindowsSigningEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(environment)
    .filter(([name]) => !WINDOWS_SIGNING_ENV_NAMES.includes(name)))
}

function isTargetName(value: string): value is DesktopPackageTargetName {
  return Object.hasOwn(TARGETS, value)
}

/**
 * Resolve a named release target and reject hosts that cannot execute its packaged runtime.
 * @param name - One of the fixed Desktop release target names.
 * @param hostPlatform - Build-host Node.js platform.
 * @param hostArch - Build-host Node.js architecture.
 * @returns The target selectors shared by runtime preparation and electron-builder.
 */
export function resolveDesktopPackageTarget(
  name: string,
  hostPlatform: NodeJS.Platform = process.platform,
  hostArch: string = process.arch,
): DesktopPackageTarget {
  if (!isTargetName(name)) {
    throw new Error(`desktop package: unsupported target ${JSON.stringify(name)}; expected ${Object.keys(TARGETS).join(', ')}`)
  }
  const target = TARGETS[name]
  // Windows on ARM runs x64 programs under emulation, so it builds the x64 target too: the target's Node.js runs
  // the seed install, and its install scripts fetch or compile x64 binaries. An x64 host cannot run arm64 code.
  const windowsHostRunsTarget = hostArch === target.arch || (hostArch === 'arm64' && target.arch === 'x64')
  if (target.platform === 'win32' && (hostPlatform !== 'win32' || !windowsHostRunsTarget)) {
    throw new Error(`desktop package: ${name} requires a Windows ${target.arch} build host running ${target.arch} Node.js${target.arch === 'x64' ? ', or Windows on ARM' : ''}`)
  }
  if (target.platform === 'linux' && (hostPlatform !== 'linux' || hostArch !== target.arch)) {
    throw new Error(`desktop package: ${name} requires a Linux ${target.arch} build host; use the ${name} Docker package command elsewhere`)
  }
  if (target.platform === 'darwin' && hostPlatform !== 'darwin') {
    throw new Error(`desktop package: ${name} requires a macOS build host`)
  }
  if (name === 'mac-arm64' && hostArch !== 'arm64') {
    throw new Error('desktop package: mac-arm64 requires an Apple Silicon build host')
  }
  return target
}

interface DesktopPackageInvocation {
  readonly target: DesktopPackageTarget
  readonly directory: boolean
  readonly prepareOnly: boolean
  /** Run the configuration and tool checks every build starts with, then stop. */
  readonly check: boolean
  /** Skip code signing and notarization. */
  readonly unsigned: boolean
}

function hostTargetName(platform: NodeJS.Platform, arch: string): DesktopPackageTargetName {
  const name = `${platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform}-${arch}`
  if (!isTargetName(name)) throw new Error(`desktop package: unsupported build host ${platform}-${arch}`)
  return name
}

/**
 * Parse the fixed-target packaging command line.
 * @param argv - Arguments after the script entry point.
 * @param hostPlatform - Build-host Node.js platform.
 * @param hostArch - Build-host Node.js architecture.
 * @returns The validated target and whether to emit an unpacked directory.
 */
export function parseDesktopPackageInvocation(
  argv: readonly string[],
  hostPlatform: NodeJS.Platform = process.platform,
  hostArch: string = process.arch,
): DesktopPackageInvocation {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      dir: { type: 'boolean', default: false },
      'prepare-only': { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      unsigned: { type: 'boolean', default: false },
    },
  })
  if (positionals.length > 1) throw new Error('desktop package: expected at most one target')
  const name = positionals[0] ?? hostTargetName(hostPlatform, hostArch)
  return {
    target: resolveDesktopPackageTarget(name, hostPlatform, hostArch),
    directory: values.dir,
    prepareOnly: values['prepare-only'],
    check: values.check,
    unsigned: values.unsigned,
  }
}

/**
 * Build the electron-builder command arguments for one validated target.
 * @param target - Supported release target.
 * @param directory - Whether to stop at an unpacked application directory.
 * @returns Arguments that keep publishing under the separate validated upload command.
 */
export function desktopElectronBuilderArguments(
  target: DesktopPackageTarget,
  directory: boolean,
): readonly string[] {
  return [
    'exec',
    'electron-builder',
    '--config',
    'electron-builder.config.mjs',
    target.builderPlatform,
    target.builderArch,
    '--publish',
    'never',
    ...(directory ? ['--dir'] : []),
  ]
}

/**
 * Developer ID sign every executable in a native platform package's `bin` directory before it is packed.
 * The seed carries these packages as tarballs, which seed-store signing never rewrites, and Apple's notary
 * service rejects an executable inside them that lacks a Developer ID signature, a secure timestamp, or
 * hardened runtime.
 * @param packageDirectory - Native platform package directory, such as `native/whisper-cpp/packages/darwin-arm64`.
 * @param environment - Packaging environment that names the application ID and the macOS release identity.
 * @returns Resolves after every executable is signed and verified.
 */
export async function signMacOSPackageExecutables(
  packageDirectory: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const appId = resolveDesktopAppId(environment)
  const expected = resolveMacOSSigningEnvironment(environment)
  const binDirectory = join(packageDirectory, 'bin')
  for (const name of readdirSync(binDirectory)) {
    const path = join(binDirectory, name)
    await signMacOSSeedCode(path, `${appId}.${name}`, expected, undefined)
    verifyMacOSSeedCode(path, expected)
  }
}

function runPnpm(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = APP_ROOT,
): Promise<void> {
  const invocation = pnpmInvocation(args)
  return new Promise((resolvePromise, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`desktop package: pnpm ${args.join(' ')} exited with ${String(code ?? signal)}`))
    })
  })
}

function runNpm(args: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    // npm is a .cmd shim on Windows, which Node only spawns through a shell.
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
      cwd: REPOSITORY_ROOT,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`desktop package: npm ${args.join(' ')} exited with ${String(code ?? signal)}`))
    })
  })
}

async function main(): Promise<void> {
  loadDesktopPackagingEnvironment(join(REPOSITORY_ROOT, '.env'))
  const invocation = parseDesktopPackageInvocation(process.argv.slice(2))
  const { target } = invocation
  const buildPaths = desktopTargetBuildPaths(target.name)
  const buildEnv = withoutWindowsSigningEnvironment(process.env)
  const targetEnv: NodeJS.ProcessEnv = {
    ...buildEnv,
    AVN_DESKTOP_TARGET_PLATFORM: target.platform,
    AVN_DESKTOP_TARGET_ARCH: target.arch,
  }
  delete targetEnv[DESKTOP_UNSIGNED_ENV]
  if (invocation.unsigned) targetEnv[DESKTOP_UNSIGNED_ENV] = '1'
  const electronBuilderEnv = { ...targetEnv }
  for (const name of WINDOWS_SIGNING_ENV_NAMES) {
    if (process.env[name] !== undefined) electronBuilderEnv[name] = process.env[name]
  }
  // A preparation-only run never reaches electron-builder, so it needs no signing configuration.
  const problems = desktopPackageProblems(
    invocation.prepareOnly ? { ...electronBuilderEnv, [DESKTOP_UNSIGNED_ENV]: '1' } : electronBuilderEnv,
  )
  if (problems.length > 0) {
    throw new Error(`desktop package: ${target.name} cannot start:\n${problems.map(problem => `  - ${problem}`).join('\n')}`)
  }
  if (invocation.check) {
    console.log(`desktop package: ${target.name}${invocation.unsigned ? ' (unsigned)' : ''} checks passed`)
    return
  }
  await runPnpm(['run', 'build:official'], buildEnv, REPOSITORY_ROOT)
  await runPnpm(['run', 'release:pack', '--family', 'avn', '--out', buildPaths.packedAvn], buildEnv, REPOSITORY_ROOT)
  await runPnpm([
    '--dir',
    'apps/desktop-host',
    'pack',
    '--pack-destination',
    buildPaths.packedAvn,
  ], buildEnv, REPOSITORY_ROOT)
  await runPnpm(['run', 'release:pack', '--family', 'vendor', '--out', buildPaths.packedVendor], buildEnv, REPOSITORY_ROOT)
  // The speech worker is native code built for this target, then packed as the one platform package the
  // Whisper provider resolves from its optional dependencies.
  const whisperPlatform = `${target.platform}-${target.arch}`
  rmSync(buildPaths.packedWhisper, { recursive: true, force: true })
  mkdirSync(buildPaths.packedWhisper, { recursive: true })
  await runPnpm(['--dir', 'native/whisper-cpp', 'run', 'build:native', '--target', whisperPlatform], buildEnv, REPOSITORY_ROOT)
  const signsMacOS = target.platform === 'darwin' && !invocation.unsigned
  if (signsMacOS) await signMacOSPackageExecutables(join(REPOSITORY_ROOT, 'native/whisper-cpp/packages', whisperPlatform), targetEnv)
  // npm, not pnpm: pnpm pack strips the executable bit, which would ship a worker no Host can spawn.
  await runNpm(['pack', `./native/whisper-cpp/packages/${whisperPlatform}`, '--pack-destination', buildPaths.packedWhisper], buildEnv)
  // The WhatsApp connector daemon is pure Go, so it cross-compiles for this target from any build host.
  rmSync(buildPaths.packedWhatsApp, { recursive: true, force: true })
  mkdirSync(buildPaths.packedWhatsApp, { recursive: true })
  await runPnpm(['--dir', 'native/whatsapp-mcp', 'run', 'build:native', '--target', whisperPlatform], buildEnv, REPOSITORY_ROOT)
  if (signsMacOS) await signMacOSPackageExecutables(join(REPOSITORY_ROOT, 'native/whatsapp-mcp/packages', whisperPlatform), targetEnv)
  await runNpm(['pack', `./native/whatsapp-mcp/packages/${whisperPlatform}`, '--pack-destination', buildPaths.packedWhatsApp], buildEnv)
  // The Telegram connector daemon is plain JavaScript, so one build and one tarball serve every target.
  rmSync(buildPaths.packedTelegram, { recursive: true, force: true })
  mkdirSync(buildPaths.packedTelegram, { recursive: true })
  await runPnpm(['--dir', 'native/telegram-mcp', 'run', 'build'], buildEnv, REPOSITORY_ROOT)
  await runPnpm(['--dir', 'native/telegram-mcp', 'pack', '--pack-destination', buildPaths.packedTelegram], buildEnv, REPOSITORY_ROOT)
  // The Discord connector server is plain JavaScript too, so one build and one tarball serve every target.
  rmSync(buildPaths.packedDiscord, { recursive: true, force: true })
  mkdirSync(buildPaths.packedDiscord, { recursive: true })
  await runPnpm(['--dir', 'native/discord-mcp', 'run', 'build'], buildEnv, REPOSITORY_ROOT)
  await runPnpm(['--dir', 'native/discord-mcp', 'pack', '--pack-destination', buildPaths.packedDiscord], buildEnv, REPOSITORY_ROOT)
  rmSync(buildPaths.packedLandlock, { recursive: true, force: true })
  mkdirSync(buildPaths.packedLandlock, { recursive: true })
  await runPnpm(['--dir', 'native/landlock-run', 'run', 'build:ts'], buildEnv, REPOSITORY_ROOT)
  await runPnpm([
    '--dir',
    'native/landlock-run/packages/entry',
    'pack',
    '--pack-destination',
    buildPaths.packedLandlock,
  ], buildEnv, REPOSITORY_ROOT)
  await runPnpm(['run', 'prepare:runtime'], targetEnv)
  await runPnpm(['run', 'prepare:packages'], targetEnv)
  await runPnpm(['run', 'prepare:seed'], targetEnv)
  if (invocation.prepareOnly) return
  await runPnpm(desktopElectronBuilderArguments(target, invocation.directory), electronBuilderEnv)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) await main()
