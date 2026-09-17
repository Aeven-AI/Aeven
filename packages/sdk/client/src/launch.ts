/**
 * Resolve the public SDK launch configuration to one avn subprocess.
 * @module @aeven/sdk-client/launch
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HarnessClientOptions } from './types.ts'

/** Default bound for a profile to answer the SDK initialize handshake. */
export const DEFAULT_INITIALIZE_TIMEOUT_MS = 10_000

/** Internal generic process launch used by the transport and fake-runtime tests. */
export interface RuntimeProcessOptions {
  command: string
  args: string[]
  cwd?: string
  /** Materialize the complete child environment when the client starts its subprocess. */
  environment: () => NodeJS.ProcessEnv
  description: string
  initializeTimeoutMs: number
  requestTimeoutMs?: number
  shutdownTimeoutMs?: number
  disposeEofGraceMs?: number
  disposeGraceMs?: number
}

/** Node argv plus internal profile patches required by one resolved avn entry. */
export interface AvnNodeLaunch {
  /** Arguments before the profile selector. */
  nodeArgs: string[]
  /** Internal patches applied below caller-supplied patches. */
  patches: string[]
  /** Environment values required by the resolved entry mode. */
  environment: NodeJS.ProcessEnv
}

interface PackageManifest {
  version?: unknown
  bin?: unknown
}

/** Read a package manifest from one resolved package.json URL. */
function manifest(url: string): PackageManifest {
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as PackageManifest
}

/**
 * Resolve and version-check a avn executable from package manifests.
 * @param avnManifestUrl - resolved URL of the avn package manifest.
 * @param clientManifestUrl - resolved URL of the SDK client manifest.
 * @returns the absolute avn executable path.
 */
export function resolveAvnBinFromManifests(avnManifestUrl: string, clientManifestUrl: string): string {
  const avnManifest = manifest(avnManifestUrl)
  const clientManifest = manifest(clientManifestUrl)
  if (typeof avnManifest.version !== 'string' || avnManifest.version !== clientManifest.version) {
    throw new Error(`avn SDK client ${String(clientManifest.version)} requires the same avn version, got ${String(avnManifest.version)}`)
  }
  const bin = typeof avnManifest.bin === 'object' && avnManifest.bin !== null
    ? (avnManifest.bin as Record<string, unknown>).avn
    : avnManifest.bin
  if (typeof bin !== 'string' || bin === '') throw new Error('@aeven/cli declares no avn executable')
  return resolve(dirname(fileURLToPath(avnManifestUrl)), bin)
}

/**
 * Resolve and version-check the built avn executable installed with this SDK.
 * @returns the absolute built executable path, whether or not it exists in a source checkout.
 */
export function installedAvnBin(): string {
  return resolveAvnBinFromManifests(
    import.meta.resolve('@aeven/cli/package.json'),
    new URL('../package.json', import.meta.url).href,
  )
}

/**
 * Resolve the Node launch for one same-version avn package.
 * @param avnManifestUrl - resolved URL of the avn package manifest.
 * @param clientManifestUrl - resolved URL of the SDK client manifest.
 * @param sourceLoaderUrl - optional absolute tsx loader URL for deterministic tests.
 * @returns built output, or the source entry plus its compatibility patch and tsx environment.
 */
export function resolveAvnNodeLaunchFromManifests(
  avnManifestUrl: string,
  clientManifestUrl: string,
  sourceLoaderUrl?: string,
): AvnNodeLaunch {
  const bin = resolveAvnBinFromManifests(avnManifestUrl, clientManifestUrl)
  if (existsSync(bin)) return { nodeArgs: [bin], patches: [], environment: {} }

  const packageDir = dirname(fileURLToPath(avnManifestUrl))
  const sourceBin = resolve(packageDir, 'src/bin.ts')
  const sourcePatch = resolve(packageDir, 'src/sdk-source.cordis.patch.yml')
  const sourceTsconfig = resolve(packageDir, 'tsconfig.json')
  if (!existsSync(sourceBin) || !existsSync(sourcePatch) || !existsSync(sourceTsconfig)) {
    throw new Error(
      `@aeven/cli is missing its built executable ${bin} and complete source launch files ${sourceBin}, ${sourcePatch}, ${sourceTsconfig}`,
    )
  }
  const loader = sourceLoaderUrl ?? import.meta.resolve('tsx/esm')
  return {
    nodeArgs: ['--import', loader, sourceBin],
    patches: [sourcePatch],
    environment: { TSX_TSCONFIG_PATH: sourceTsconfig },
  }
}

/**
 * Resolve the installed avn package to a built or source Node launch.
 * @returns the launch descriptor for the current checkout or installed package.
 */
function installedAvnNodeLaunch(): AvnNodeLaunch {
  return resolveAvnNodeLaunchFromManifests(
    import.meta.resolve('@aeven/cli/package.json'),
    new URL('../package.json', import.meta.url).href,
  )
}

/**
 * Resolve caller-relative filesystem inputs and construct canonical avn argv.
 * @param options - public SDK launch options.
 * @param callerCwd - parent-process directory used for lexical resolution.
 * @returns one generic subprocess spec for the JSON-RPC transport.
 */
export function resolveAvnLaunch(
  options: HarnessClientOptions = {},
  callerCwd: string = process.cwd(),
): RuntimeProcessOptions {
  const profile = options.profile ?? 'sdk'
  const avnLaunch = options.avnBin === undefined
    ? installedAvnNodeLaunch()
    : { nodeArgs: [resolve(callerCwd, options.avnBin)], patches: [], environment: {} }
  const patches = [
    ...avnLaunch.patches,
    ...(options.patches ?? []).map(path => resolve(callerCwd, path)),
  ]
  const avnHome = options.avnHome === undefined ? undefined : resolve(callerCwd, options.avnHome)
  return {
    command: process.execPath,
    args: [...avnLaunch.nodeArgs, '--profile', profile, ...patches.flatMap(path => ['--patch', path])],
    ...options.processCwd === undefined ? {} : { cwd: resolve(callerCwd, options.processCwd) },
    environment: () => ({
      ...(options.env ?? process.env),
      ...avnLaunch.environment,
      ...avnHome === undefined ? {} : { AVN_HOME: avnHome },
    }),
    description: `avn profile ${JSON.stringify(profile)}`,
    initializeTimeoutMs: options.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT_MS,
    ...options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs },
    ...options.shutdownTimeoutMs === undefined ? {} : { shutdownTimeoutMs: options.shutdownTimeoutMs },
    ...options.disposeEofGraceMs === undefined ? {} : { disposeEofGraceMs: options.disposeEofGraceMs },
    ...options.disposeGraceMs === undefined ? {} : { disposeGraceMs: options.disposeGraceMs },
  }
}
