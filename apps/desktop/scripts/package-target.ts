/** Build one release target with matching Electron, Node.js, and seed architecture. */

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { join, resolve } from 'node:path'
import {
  desktopBuildRecordFilename,
  resolveDesktopAutoUpdateConfig,
} from './desktop-auto-update-environment.mjs'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { loadDesktopPackagingEnvironment } from './desktop-environment-file.ts'
import { DESKTOP_UNSIGNED_ENV } from './desktop-release-environment.mjs'
import { pnpmInvocation } from '../../../scripts/pnpm-invocation.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')
const WINDOWS_SIGNING_ENV_PREFIX = 'AVN_DESKTOP_WINDOWS_'
const WINDOWS_SIGNING_ENV_NAMES = [
  'AVN_DESKTOP_WINDOWS_CER_FILE',
  'AVN_DESKTOP_WINDOWS_KEY_CONTAINER',
  'AVN_DESKTOP_WINDOWS_SIGNTOOL',
  'AVN_DESKTOP_WINDOWS_TOKEN_PIN',
] as const
const DESKTOP_UPLOAD_CREDENTIAL_ENV_NAMES = new Set([
  'DOWNLOAD_TEST_COS_SECRET_ID',
  'DOWNLOAD_TEST_COS_SECRET_KEY',
  'DOWNLOAD_PROD_COS_SECRET_ID',
  'DOWNLOAD_PROD_COS_SECRET_KEY',
])

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
 * Remove Windows signing configuration from package preparation subprocesses.
 * @param environment - Packaging command environment.
 * @returns A copy without Windows signing fields.
 */
export function withoutWindowsSigningEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(environment)
    .filter(([name]) => !name.startsWith(WINDOWS_SIGNING_ENV_PREFIX)))
}

/**
 * Remove upload-only COS credentials from every packaging subprocess.
 * @param environment - Packaging command environment.
 * @returns A copy without Desktop upload credentials.
 */
export function withoutDesktopUploadCredentials(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(environment)
    .filter(([name]) => !DESKTOP_UPLOAD_CREDENTIAL_ENV_NAMES.has(name)))
}

function isTargetName(value: string): value is DesktopPackageTargetName {
  return Object.hasOwn(TARGETS, value)
}

function packageVersion(path: string, label: string): string {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error(`desktop package: ${label} has no version`)
  }
  return manifest.version
}

function writeReleaseRecord(
  target: DesktopPackageTarget,
  environment: NodeJS.ProcessEnv,
  artifactsRoot: string,
): void {
  const desktopVersion = packageVersion(join(APP_ROOT, 'package.json'), 'desktop package')
  const avnVersion = packageVersion(join(REPOSITORY_ROOT, 'package.json'), 'avn package')
  if (desktopVersion !== avnVersion) {
    throw new Error(`desktop package: desktop version ${desktopVersion} does not match avn version ${avnVersion}`)
  }
  const update = resolveDesktopAutoUpdateConfig(environment, target.platform, target.arch)
  const recordPath = join(artifactsRoot, desktopBuildRecordFilename(target.name))
  const temporaryPath = `${recordPath}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify({
    schemaVersion: 1,
    target: target.name,
    version: avnVersion,
    environment: update.environment,
    publicUrl: update.publicUrl,
  }, null, 2)}\n`)
  renameSync(temporaryPath, recordPath)
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
  if (target.platform === 'win32' && (hostPlatform !== 'win32' || hostArch !== target.arch)) {
    throw new Error(`desktop package: ${name} requires a Windows ${target.arch} build host running ${target.arch} Node.js`)
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
  /** Skip code signing, notarization, and the upload completion record. */
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
      unsigned: { type: 'boolean', default: false },
    },
  })
  if (positionals.length > 1) throw new Error('desktop package: expected at most one target')
  const name = positionals[0] ?? hostTargetName(hostPlatform, hostArch)
  return {
    target: resolveDesktopPackageTarget(name, hostPlatform, hostArch),
    directory: values.dir,
    prepareOnly: values['prepare-only'],
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
  const releaseRecordPath = join(buildPaths.artifacts, desktopBuildRecordFilename(target.name))
  if (!invocation.prepareOnly) {
    rmSync(releaseRecordPath, { force: true })
    rmSync(`${releaseRecordPath}.tmp`, { force: true })
  }
  const buildEnv = withoutWindowsSigningEnvironment(withoutDesktopUploadCredentials(process.env))
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
  // npm, not pnpm: pnpm pack strips the executable bit, which would ship a worker no Host can spawn.
  await runNpm(['pack', `./native/whisper-cpp/packages/${whisperPlatform}`, '--pack-destination', buildPaths.packedWhisper], buildEnv)
  // The WhatsApp connector daemon is pure Go, so it cross-compiles for this target from any build host.
  rmSync(buildPaths.packedWhatsApp, { recursive: true, force: true })
  mkdirSync(buildPaths.packedWhatsApp, { recursive: true })
  await runPnpm(['--dir', 'native/whatsapp-mcp', 'run', 'build:native', '--target', whisperPlatform], buildEnv, REPOSITORY_ROOT)
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
  if (!invocation.directory && !invocation.unsigned) writeReleaseRecord(target, electronBuilderEnv, buildPaths.artifacts)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) await main()
