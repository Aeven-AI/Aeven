/** Transactional owner of the reserved desktop profile and its private pnpm state. */

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  DESKTOP_PACKAGES_DIR,
  DESKTOP_PACKAGE_SET_FILE,
  DESKTOP_HOST_PACKAGE,
  desktopCorePackageOverrides,
  desktopAvnPackageSpec,
  readDesktopCorePackageSet,
  verifyDesktopCorePackageSet,
} from './core-package-set.ts'
import type { DesktopPaths } from './paths.ts'
import { parseDesktopRelease, parseInstalledDesktopReleaseVersion, type DesktopRelease } from './release.ts'
import { renameRetryingWindowsLocks } from './rename-retry.ts'
import { extractPnpmStoreArchives, mergePnpmStore } from './seed-store.ts'
import { installSeedProfileLayout, SEED_PROFILE_LAYOUT } from './seed-profile.ts'

/** Files the package transaction copies between active and staging projects. */
const DESKTOP_PROJECT_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'desktop-release.json',
  DESKTOP_PACKAGE_SET_FILE,
] as const

/** Desktop plugin record derived from the installed profile. */
export interface DesktopPluginRecord {
  readonly name: string
  readonly version: string
}

/** Installed desktop project manifest slice. */
interface DesktopProjectManifest {
  readonly name: string
  readonly private: true
  readonly version: string
  readonly dependencies: Record<string, string>
  readonly avn: {
    readonly profile: {
      readonly bundles: string[]
    }
  }
}

/** Journaled activation step used for crash recovery. */
interface DesktopPendingTransaction {
  readonly schemaVersion: 1
  readonly id: string
  readonly stagingProfile: string
  readonly step: 'prepared' | 'active-moved' | 'staging-activated'
}

/** Exact executables the desktop shell bundles. */
export interface DesktopRuntimeExecutables {
  readonly node: string
  readonly pnpm: string
}

/**
 * The long-running step a release replacement is in: unpacking the seed's pnpm store, installing the profile from
 * it, or proving the installed profile boots. Verifying the seed and the fast path that finds the profile current
 * report no step.
 */
export type DesktopReleaseStep = 'unpacking' | 'installing' | 'checking'

/** Hooks that bind project replacement to backend lifecycle and health. */
export interface DesktopProjectHooks {
  /** Prove the staged dependency graph while the active backend is stopped. */
  healthCheck(projectDir: string): Promise<void>
  /** Stop the active backend and await process exit before directory moves. */
  beforeActivate(): Promise<void>
  /** Start the selected active project after commit or rollback. */
  afterActivate(): Promise<void>
  /**
   * Observe each step of a replacement that has work to do.
   * @param step - the step that starts now.
   */
  progress(step: DesktopReleaseStep): void
}

interface DesktopSeedIntegrityRecord {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

const PROJECT_NAME = '@aeven/desktop-runtime'
const AVN_PACKAGE = '@aeven/cli'
const CORE_BUILD_PACKAGE = '@aeven/subprocess-local'
const DESKTOP_PROFILE_BUNDLES = ['@aeven/base', '@aeven/web-app'] as const
const WORKSPACE_SETTINGS = 'nodeLinker: hoisted\nautoInstallPeers: false\nstrictDepBuilds: true\n'
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/u
const MAX_PNPM_DIAGNOSTIC_BYTES = 64 * 1024
const DESKTOP_REGISTRY = 'https://registry.npmjs.org/'

/** Dependencies of `@aeven/client-ui-primitives`, a browser library the web frontend build compiles in. */
const BROWSER_LIBRARY_DEPENDENCIES = [
  '@types/mdast', 'anser', 'clsx', 'highlight.js', 'katex', 'mdast-util-from-markdown', 'mdast-util-gfm', 'mermaid',
  'micromark-core-commonmark', 'micromark-extension-gfm', 'micromark-util-character', 'micromark-util-classify-character',
  'micromark-util-symbol', 'micromark-util-types', 'react', 'react-dom', 'rehype-highlight', 'rehype-katex',
  'remark-cjk-friendly', 'remark-math', 'tippy.js',
] as const

/**
 * Third-party dependency edges the Desktop graph rewrites; pnpm keeps a package any other edge still reaches.
 *
 * `-` removes an edge the Host never loads. The web frontend `dist` contains `@aeven/client-ui-primitives` and its
 * dependencies, and each plugin's `lib/client.js` contains its Lexical copy or resolves xterm from that `dist`.
 * Transformers.js imports `sharp` at load but never decodes images for text embeddings, so it shares the
 * attachment reader's `sharp` release instead of carrying a second libvips. The Microsoft 365 Graph bridge loads its
 * optional Azure Identity and Key Vault packages only when `MS365_MCP_KEYVAULT_URL` is set, which the account
 * connector never sets; removing them also removes the second MSAL Node release and the browser MSAL build.
 * MemOS embeddings run through Transformers.js, which pins `onnxruntime-node` to a release that ships no Intel
 * macOS binding; 1.23.2 is the newest release that ships one, so the graph substitutes it for the pinned release.
 */
export const DESKTOP_DEPENDENCY_OVERRIDES: Readonly<Record<string, string>> = Object.fromEntries<string>([
  ...BROWSER_LIBRARY_DEPENDENCIES.map((name): [string, string] => [`@aeven/client-ui-primitives>${name}`, '-']),
  ...['lexical', '@lexical/history', '@lexical/plain-text', '@lexical/text', '@lexical/utils']
    .map((name): [string, string] => [`@aeven/client-ui-conversation>${name}`, '-']),
  ...['@xterm/xterm', '@xterm/addon-fit']
    .map((name): [string, string] => [`@aeven/client-ui-sidebar-terminal>${name}`, '-']),
  ['@huggingface/transformers>sharp', '^0.35.3'],
  ['@huggingface/transformers>onnxruntime-node', '1.23.2'],
  ...['@azure/identity', '@azure/keyvault-secrets']
    .map((name): [string, string] => [`@softeria/ms-365-mcp-server>${name}`, '-']),
])

function errorOf(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback)
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, undefined, 2)}\n`, { mode: 0o600 })
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function workspaceFile(corePackages: Readonly<Record<string, string>> = {}): string {
  const entries = Object.entries({ ...DESKTOP_DEPENDENCY_OVERRIDES, ...corePackages })
    .sort(([left], [right]) => left.localeCompare(right))
  const overrideSection = `overrides:\n${entries.map(([name, spec]) => `  ${JSON.stringify(name)}: ${JSON.stringify(spec)}`).join('\n')}\n`
  const coreBuildSpec = corePackages[CORE_BUILD_PACKAGE]
  const coreBuildKey = coreBuildSpec === undefined
    ? CORE_BUILD_PACKAGE
    : `${CORE_BUILD_PACKAGE}@${coreBuildSpec.replace('file:./', 'file:')}`
  // onnxruntime-node's install script only downloads CUDA execution providers (Linux x64); MemOS embeds on the
  // CPU runtime the package ships, so allowing it would put about 300 MB of GPU libraries into every install.
  // The Google connectors spawn the platform CLI the Host installs into the package's own `bin/` from its
  // postinstall, which also covers Windows on ARM; the package's own installer refuses that host.
  return `packages:\n  - .\n\n${overrideSection}${WORKSPACE_SETTINGS}allowBuilds:\n  '@googleworkspace/cli': false\n  '@aeven/host-account-integrations': true\n  node-pty: true\n  koffi: true\n  keytar: true\n  fs-ext: true\n  esbuild: true\n  better-sqlite3: true\n  onnxruntime-node: false\n  sharp: true\n  ${JSON.stringify(coreBuildKey)}: true\n  '@google/genai': false\n  protobufjs: false\n  node-addon-require-builtin: false\n  tesseract.js: false\n`
}

function releaseFile(projectDir: string): DesktopRelease {
  return parseDesktopRelease(readJson(join(projectDir, 'desktop-release.json')))
}

function installedReleaseVersion(projectDir: string): string {
  return parseInstalledDesktopReleaseVersion(readJson(join(projectDir, 'desktop-release.json')))
}

/**
 * Pre-release builds reuse one version across rebuilds and Host protocol changes, so the profile matches the seed
 * only when it holds the seed's exact release record and the same package tarball digests.
 */
function profileMatchesSeed(projectDir: string, seedDir: string): boolean {
  return ['desktop-release.json', DESKTOP_PACKAGE_SET_FILE].every(file => (
    existsSync(join(projectDir, file)) && readFileSync(join(projectDir, file)).equals(readFileSync(join(seedDir, file)))
  ))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isDescendant(root: string, target: string): boolean {
  const child = relative(root, target)
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

function assertPackageName(name: string): void {
  if (!PACKAGE_NAME_PATTERN.test(name)) throw new Error(`desktop project: invalid npm package name ${JSON.stringify(name)}`)
}

function assertVersion(version: string): void {
  if (!VERSION_PATTERN.test(version)) throw new Error(`desktop project: invalid exact version ${JSON.stringify(version)}`)
}

function removeOwnedDirectory(path: string): void {
  if (!existsSync(path)) return
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) {
    unlinkSync(path)
    return
  }
  if (!stat.isDirectory()) throw new Error(`desktop project: owned directory path is not a directory: ${path}`)
  // Windows reports EBUSY or EPERM while a scanner still holds a file in the tree; Node retries those itself.
  rmSync(path, { recursive: true, maxRetries: 10, retryDelay: 200 })
}

/** Remove a failed step's leftover directory without letting a held file replace the error that step threw. */
function discardOwnedDirectory(path: string): void {
  try {
    removeOwnedDirectory(path)
  } catch (error) {
    console.warn(`desktop project: could not remove ${path}`, error)
  }
}

function copyMetadata(source: string, target: string): void {
  mkdirSync(target, { recursive: true, mode: 0o700 })
  for (const filename of DESKTOP_PROJECT_FILES) {
    const from = join(source, filename)
    if (existsSync(from)) copyFileSync(from, join(target, filename), constants.COPYFILE_EXCL)
  }
  cpSync(join(source, DESKTOP_PACKAGES_DIR), join(target, DESKTOP_PACKAGES_DIR), {
    recursive: true,
    force: false,
    errorOnExist: true,
  })
}

async function seedFiles(root: string): Promise<readonly DesktopSeedIntegrityRecord[]> {
  const files: DesktopSeedIntegrityRecord[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const relativePath = path.slice(root.length + 1).split(sep).join('/')
      if (relativePath === 'integrity.json') continue
      if (entry.isSymbolicLink()) throw new Error(`desktop seed: symbolic link is not allowed: ${relativePath}`)
      if (entry.isDirectory()) {
        await visit(path)
        continue
      }
      if (!entry.isFile()) throw new Error(`desktop seed: unsupported file type: ${relativePath}`)
      const body = await readFile(path)
      files.push({
        path: relativePath,
        bytes: body.byteLength,
        sha256: createHash('sha256').update(body).digest('hex'),
      })
    }
  }
  await visit(root)
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

/**
 * Verify the packaged offline seed before any content enters writable desktop state. Files are read and hashed one
 * at a time between event-loop turns, so the Electron main process stays responsive across the whole seed.
 * @param seedDir - packaged seed directory.
 */
export async function verifySeedIntegrity(seedDir: string): Promise<void> {
  const integrityPath = join(seedDir, 'integrity.json')
  const integrity = readJson(integrityPath)
  if (!isRecord(integrity) || integrity.schemaVersion !== 2 || !Array.isArray(integrity.files)) {
    throw new Error(`desktop seed: invalid integrity inventory ${integrityPath}`)
  }
  const expected: DesktopSeedIntegrityRecord[] = integrity.files.map((record) => {
    if (!isRecord(record) || typeof record.path !== 'string' || record.path === '' || record.path.startsWith('/')
      || record.path.split('/').includes('..') || typeof record.bytes !== 'number'
      || !Number.isSafeInteger(record.bytes) || record.bytes < 0
      || typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(record.sha256)) {
      throw new Error(`desktop seed: invalid integrity record in ${integrityPath}`)
    }
    return { path: record.path, bytes: record.bytes, sha256: record.sha256 }
  }).sort((left, right) => left.path.localeCompare(right.path))
  const actual = await seedFiles(seedDir)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('desktop seed: integrity verification failed')
  }
}

/** Read a profile manifest's fields; an upgrade reads an older profile's plugins through this alone. */
function profileManifest(projectDir: string): DesktopProjectManifest {
  const path = join(projectDir, 'package.json')
  const value = readJson(path)
  const avn = isRecord(value) && isRecord(value.avn) ? value.avn : undefined
  const profile = isRecord(avn?.profile) ? avn.profile : undefined
  if (!isRecord(value) || value.name !== PROJECT_NAME || value.private !== true
    || typeof value.version !== 'string' || !isRecord(value.dependencies)
    || !Array.isArray(profile?.bundles) || !profile.bundles.every(bundle => typeof bundle === 'string')) {
    throw new Error(`desktop project: invalid desktop profile manifest ${path}`)
  }
  return value as unknown as DesktopProjectManifest
}

/** Read a profile manifest whose core packages must resolve to this release's local tarballs. */
function projectManifest(projectDir: string): DesktopProjectManifest {
  const manifest = profileManifest(projectDir)
  const packageSet = readDesktopCorePackageSet(projectDir, installedReleaseVersion(projectDir))
  const expectedOverrides = desktopCorePackageOverrides(packageSet)
  if (manifest.dependencies[AVN_PACKAGE] !== desktopAvnPackageSpec(packageSet)
    || Object.entries(expectedOverrides).some(([name, spec]) => manifest.dependencies[name] !== spec)
    || readFileSync(join(projectDir, 'pnpm-workspace.yaml'), 'utf8')
      !== workspaceFile(expectedOverrides)) {
    throw new Error(`desktop project: core package mapping does not match ${DESKTOP_PACKAGE_SET_FILE}`)
  }
  return manifest
}

function profilePluginNames(projectDir: string): readonly string[] {
  const bundles = profileManifest(projectDir).avn.profile.bundles
  if (!DESKTOP_PROFILE_BUNDLES.every((bundle, index) => bundles[index] === bundle)) {
    throw new Error('desktop project: profile must begin with the built-in desktop bundle list')
  }
  const plugins = bundles.slice(DESKTOP_PROFILE_BUNDLES.length)
  if (new Set(bundles).size !== bundles.length) {
    throw new Error('desktop project: profile bundle list contains a duplicate package')
  }
  for (const plugin of plugins) assertPackageName(plugin)
  return plugins
}

function pluginRecords(projectDir: string): readonly DesktopPluginRecord[] {
  return profilePluginNames(projectDir).map(name => inspectPlugin(projectDir, name))
}

function writeProfilePlugins(projectDir: string, plugins: readonly DesktopPluginRecord[]): void {
  const manifest = projectManifest(projectDir)
  writeJson(join(projectDir, 'package.json'), {
    ...manifest,
    avn: {
      ...manifest.avn,
      profile: {
        ...manifest.avn.profile,
        bundles: [...DESKTOP_PROFILE_BUNDLES, ...plugins.map(plugin => plugin.name)],
      },
    },
  } satisfies DesktopProjectManifest)
}

function inspectPlugin(projectDir: string, requestedName: string): DesktopPluginRecord {
  const manifestPath = join(projectDir, 'node_modules', ...requestedName.split('/'), 'package.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`desktop project: installed package ${JSON.stringify(requestedName)} has no manifest`)
  }
  const manifest = readJson(manifestPath)
  if (!isRecord(manifest) || manifest.name !== requestedName || typeof manifest.version !== 'string') {
    throw new Error(`desktop project: installed package ${JSON.stringify(requestedName)} has inconsistent name or version`)
  }
  const avn = manifest.avn
  const bundle = isRecord(avn) ? avn.bundle : undefined
  const patch = isRecord(bundle) ? bundle.patch : undefined
  if (typeof patch !== 'string' || patch === '') {
    throw new Error(`desktop project: ${requestedName}@${manifest.version} does not declare avn.bundle.patch`)
  }
  const packageDir = dirname(manifestPath)
  const patchPath = resolve(packageDir, patch)
  if ((patchPath !== packageDir && !patchPath.startsWith(packageDir + sep)) || !existsSync(patchPath)) {
    throw new Error(`desktop project: ${requestedName}@${manifest.version} declares an invalid bundle patch`)
  }
  return { name: requestedName, version: manifest.version }
}

/** Transactional desktop npm project manager. */
export class DesktopProjectManager {
  private lockDescriptor: number | undefined

  /**
   * @param paths - Electron-owned package state and reserved desktop profile paths.
   * @param runtime - absolute bundled Node.js and pnpm entry paths.
   */
  constructor(
    readonly paths: DesktopPaths,
    readonly runtime: DesktopRuntimeExecutables,
  ) {}

  /** Recover an interrupted directory replacement before reading the active project. */
  async recover(): Promise<void> {
    if (!existsSync(this.paths.pending)) return
    const value = readJson(this.paths.pending)
    if (!isRecord(value) || value.schemaVersion !== 1
      || typeof value.id !== 'string' || typeof value.stagingProfile !== 'string'
      || !isDescendant(this.paths.staging, value.stagingProfile)
      || (value.step !== 'prepared' && value.step !== 'active-moved' && value.step !== 'staging-activated')) {
      throw new Error(`desktop project: invalid activation journal ${this.paths.pending}`)
    }
    const pending: DesktopPendingTransaction = {
      schemaVersion: 1,
      id: value.id,
      stagingProfile: value.stagingProfile,
      step: value.step,
    }
    if (!existsSync(this.paths.profile) && existsSync(this.paths.rollback)) {
      mkdirSync(dirname(this.paths.profile), { recursive: true })
      await renameRetryingWindowsLocks(this.paths.rollback, this.paths.profile)
    }
    removeOwnedDirectory(pending.stagingProfile)
    unlinkSync(this.paths.pending)
  }

  /** Read the exact avn version installed in the active desktop project. */
  avnVersion(): string {
    if (!existsSync(this.paths.profile)) throw new Error('desktop project: active profile is not installed')
    return this.installedPackageVersion(AVN_PACKAGE)
  }

  private installedPackageVersion(packageName: string): string {
    const manifestPath = join(this.paths.profile, 'node_modules', ...packageName.split('/'), 'package.json')
    const manifest = readJson(manifestPath)
    if (!isRecord(manifest) || typeof manifest.version !== 'string') {
      throw new Error(`desktop project: installed ${packageName} package has no version`)
    }
    assertVersion(manifest.version)
    return manifest.version
  }

  /** Read the release version applied to the active desktop project. */
  releaseVersion(): string {
    if (!existsSync(this.paths.profile)) throw new Error('desktop project: active profile is not installed')
    return installedReleaseVersion(this.paths.profile)
  }

  /**
   * Install or reconcile the active project to the Electron package's exact release. A profile `prepareRelease`
   * already installed from this exact seed, with the active profile's plugins, is adopted instead of installing
   * again, which leaves the health check and the directory swap.
   * @param seedDir - this application's packaged seed.
   * @param electronVersion - version of the running Electron application.
   * @param hooks - backend lifecycle, health check, and step observer.
   * @returns whether the active profile changed.
   */
  async applyRelease(seedDir: string, electronVersion: string, hooks: DesktopProjectHooks): Promise<boolean> {
    return this.withLock(async () => {
      await this.recover()
      const target = releaseFile(seedDir)
      readDesktopCorePackageSet(seedDir, target.version)
      if (target.version !== electronVersion) {
        throw new Error(`desktop project: seed ${target.version} does not match Electron ${electronVersion}`)
      }
      if (existsSync(this.paths.profile) && profileMatchesSeed(this.paths.profile, seedDir)
        && this.avnVersion() === target.version
        && this.installedPackageVersion(DESKTOP_HOST_PACKAGE) === target.version) {
        return false
      }
      // Hashing the seed and its tarballs costs seconds on the main process, so it runs only once seed content is
      // about to enter writable state; a current profile runs from its `node_modules` and never reads a tarball again.
      await verifySeedIntegrity(seedDir)
      verifyDesktopCorePackageSet(seedDir, target.version)
      const prepared = await this.adoptPreparedProfile(seedDir)
      let extracted: ReadonlySet<string> = new Set()
      if (prepared === undefined) {
        hooks.progress('unpacking')
        extracted = await this.mergeSeedPnpmState(seedDir)
      }
      const stagingProfile = prepared ?? this.newStagingProfile()
      try {
        if (prepared === undefined) {
          hooks.progress('installing')
          await this.installProfile(seedDir, stagingProfile, this.runtime, extracted)
        }
        hooks.progress('checking')
        await hooks.healthCheck(stagingProfile)
        await this.activate(stagingProfile, hooks)
        return true
      } catch (error) {
        discardOwnedDirectory(stagingProfile)
        throw error
      }
    })
  }

  /**
   * Install a downloaded release's profile while the running release keeps serving, so that release's first launch
   * adopts it through `applyRelease` instead of unpacking and installing behind its start screen. The active
   * profile and backend are untouched; the prepared profile replaces any earlier one.
   * @param seedDir - the downloaded release's packaged seed.
   * @param version - the release version the seed must carry.
   * @param runtime - the downloaded release's own Node.js and pnpm, which install its native dependencies.
   * @returns whether a profile was prepared; false when the active or prepared profile already matches the seed.
   */
  async prepareRelease(seedDir: string, version: string, runtime: DesktopRuntimeExecutables): Promise<boolean> {
    return this.withLock(async () => {
      await this.recover()
      const target = releaseFile(seedDir)
      readDesktopCorePackageSet(seedDir, target.version)
      if (target.version !== version) {
        throw new Error(`desktop project: seed ${target.version} does not match the downloaded release ${version}`)
      }
      if (existsSync(this.paths.profile) && profileMatchesSeed(this.paths.profile, seedDir)) return false
      if (existsSync(this.paths.prepared) && profileMatchesSeed(this.paths.prepared, seedDir)) return false
      // Every periodic check that finds the same downloaded release lands here, so hashing waits until seed content
      // is about to enter writable state, as in `applyRelease`.
      await verifySeedIntegrity(seedDir)
      verifyDesktopCorePackageSet(seedDir, target.version)
      removeOwnedDirectory(dirname(this.paths.prepared))
      const extracted = await this.mergeSeedPnpmState(seedDir)
      const stagingProfile = this.newStagingProfile()
      try {
        await this.installProfile(seedDir, stagingProfile, runtime, extracted)
        mkdirSync(dirname(this.paths.prepared), { recursive: true, mode: 0o700 })
        await renameRetryingWindowsLocks(stagingProfile, this.paths.prepared)
        return true
      } finally {
        discardOwnedDirectory(dirname(stagingProfile))
      }
    })
  }

  /**
   * Move a prepared profile into staging when it was installed from this exact seed with the active profile's
   * plugins, and discard it otherwise: a profile prepared for another release, or before the reader changed their
   * plugins, is not this launch's profile.
   */
  private async adoptPreparedProfile(seedDir: string): Promise<string | undefined> {
    const prepared = this.paths.prepared
    if (!existsSync(prepared)) return undefined
    let usable = false
    try {
      usable = profileMatchesSeed(prepared, seedDir) && JSON.stringify(pluginRecords(prepared))
        === JSON.stringify(existsSync(this.paths.profile) ? pluginRecords(this.paths.profile) : [])
    } catch (error) {
      // A prepared profile whose manifest or plugins no longer read is discarded and installed afresh.
      console.warn('desktop project: discarding an unreadable prepared profile', error)
    }
    if (!usable) {
      removeOwnedDirectory(dirname(prepared))
      return undefined
    }
    const stagingProfile = join(this.paths.staging, randomUUID(), 'profile')
    mkdirSync(dirname(stagingProfile), { recursive: true, mode: 0o700 })
    await renameRetryingWindowsLocks(prepared, stagingProfile)
    return stagingProfile
  }

  /**
   * Install one release's profile into an empty staging directory, carrying the active profile's plugins over.
   * @param seedDir - the release's packaged seed.
   * @param stagingProfile - empty staging profile directory.
   * @param runtime - the Node.js and pnpm that install the release.
   * @param extracted - Store objects extracted from this transaction's integrity-verified seed.
   */
  private async installProfile(
    seedDir: string,
    stagingProfile: string,
    runtime: DesktopRuntimeExecutables,
    extracted: ReadonlySet<string>,
  ): Promise<void> {
    const plugins = existsSync(this.paths.profile) ? pluginRecords(this.paths.profile) : []
    copyMetadata(seedDir, stagingProfile)
    if (existsSync(join(seedDir, SEED_PROFILE_LAYOUT))) {
      await installSeedProfileLayout(seedDir, this.paths.pnpm.store, stagingProfile, this.paths.profile, extracted)
    } else {
      await this.runPnpm(runtime, stagingProfile, ['install', '--offline', '--frozen-lockfile', '--trust-lockfile'])
    }
    if (plugins.length === 0) return
    await this.runPnpm(runtime, stagingProfile, [
      'add',
      ...plugins.map(plugin => `${plugin.name}@${plugin.version}`),
      '--save-exact',
      '--offline',
    ])
    writeProfilePlugins(stagingProfile, plugins)
  }

  private newStagingProfile(): string {
    const path = join(this.paths.staging, randomUUID(), 'profile')
    mkdirSync(path, { recursive: true, mode: 0o700 })
    return path
  }

  private async mergeSeedPnpmState(seedDir: string): Promise<ReadonlySet<string>> {
    const transactionRoot = join(this.paths.staging, randomUUID())
    const extractedStore = join(transactionRoot, 'store')
    try {
      const extracted = await extractPnpmStoreArchives(seedDir, extractedStore, this.paths.pnpm.store)
      await mergePnpmStore(extractedStore, this.paths.pnpm.store)
      return extracted
    } finally {
      discardOwnedDirectory(transactionRoot)
    }
  }

  private async activate(stagingProfile: string, hooks: DesktopProjectHooks): Promise<void> {
    const pending: DesktopPendingTransaction = {
      schemaVersion: 1,
      id: basename(dirname(stagingProfile)),
      stagingProfile,
      step: 'prepared',
    }
    writeJson(this.paths.pending, pending)
    await hooks.beforeActivate()
    let activeMoved = false
    let stagingMoved = false
    try {
      removeOwnedDirectory(this.paths.rollback)
      mkdirSync(dirname(this.paths.rollback), { recursive: true, mode: 0o700 })
      writeJson(this.paths.pending, { ...pending, step: 'active-moved' } satisfies DesktopPendingTransaction)
      if (existsSync(this.paths.profile)) {
        await renameRetryingWindowsLocks(this.paths.profile, this.paths.rollback)
        activeMoved = true
      }
      mkdirSync(dirname(this.paths.profile), { recursive: true, mode: 0o700 })
      writeJson(this.paths.pending, { ...pending, step: 'staging-activated' } satisfies DesktopPendingTransaction)
      await renameRetryingWindowsLocks(stagingProfile, this.paths.profile)
      stagingMoved = true
      await hooks.afterActivate()
      unlinkSync(this.paths.pending)
    } catch (error) {
      // Undo only the moves that happened, by rename, so a held file leaves the swap unfinished rather than deleting
      // the active profile. An undo that fails keeps the journal for the next launch's recover() and never replaces
      // the error that stopped the swap.
      try {
        if (stagingMoved) await renameRetryingWindowsLocks(this.paths.profile, stagingProfile)
        if (activeMoved) await renameRetryingWindowsLocks(this.paths.rollback, this.paths.profile)
        if (existsSync(this.paths.pending)) unlinkSync(this.paths.pending)
      } catch (undoError) {
        console.error('desktop project: could not undo the profile swap; the next launch recovers it', undoError)
      }
      await hooks.afterActivate().catch(() => undefined)
      throw error
    }
  }

  private async runPnpm(runtime: DesktopRuntimeExecutables, projectDir: string, args: readonly string[]): Promise<void> {
    const [command, ...commandArgs] = args
    if (command === undefined) throw new Error('desktop project: pnpm command is required')
    for (const path of [this.paths.root, this.paths.pnpm.store, this.paths.pnpm.cache,
      this.paths.pnpm.state, this.paths.pnpm.config, this.paths.pnpm.home]) {
      mkdirSync(path, { recursive: true, mode: 0o700 })
    }
    const npmrc = join(this.paths.pnpm.config, 'npmrc')
    if (!existsSync(npmrc)) writeFileSync(npmrc, '', { mode: 0o600 })
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => (
      !/^AVN_DESKTOP_/u.test(name) && !/^(?:npm|pnpm|corepack)_/iu.test(name)
    )))
    await new Promise<void>((settle, reject) => {
      const child = spawn(runtime.node, [
        runtime.pnpm,
        `--config.registry=${DESKTOP_REGISTRY}`,
        `--config.store-dir=${this.paths.pnpm.store}`,
        '--config.enable-global-virtual-store=false',
        `--config.userconfig=${npmrc}`,
        command,
        ...commandArgs,
      ], {
        cwd: projectDir,
        env: {
          ...inherited,
          COREPACK_HOME: this.paths.pnpm.home,
          NPM_CONFIG_REGISTRY: DESKTOP_REGISTRY,
          NPM_CONFIG_STORE_DIR: this.paths.pnpm.store,
          NPM_CONFIG_USERCONFIG: npmrc,
          PATH: `${dirname(runtime.node)}${delimiter}${process.env.PATH ?? ''}`,
          PNPM_HOME: this.paths.pnpm.home,
          XDG_CACHE_HOME: this.paths.pnpm.cache,
          XDG_CONFIG_HOME: this.paths.pnpm.config,
          XDG_STATE_HOME: this.paths.pnpm.state,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const childPid = child.pid
      if (childPid === undefined) {
        child.kill('SIGKILL')
        reject(new Error('desktop project: pnpm did not report a process id'))
        return
      }
      try {
        this.writeLockOwner(childPid)
      } catch (error) {
        child.kill('SIGKILL')
        reject(errorOf(error, 'desktop project: failed to assign the package transaction lock to pnpm'))
        return
      }
      let diagnostics = ''
      let completed = false
      const appendDiagnostics = (chunk: string): void => {
        diagnostics = (diagnostics + chunk).slice(-MAX_PNPM_DIAGNOSTIC_BYTES)
      }
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', appendDiagnostics)
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', appendDiagnostics)
      const complete = (settleChild: () => void): void => {
        if (completed) return
        completed = true
        try {
          this.writeLockOwner(process.pid)
        } catch (error) {
          reject(errorOf(error, 'desktop project: failed to return the package transaction lock to Electron'))
          return
        }
        settleChild()
      }
      child.once('error', (error) => { complete(() => { reject(error) }) })
      child.once('close', (code, signal) => {
        complete(() => {
          if (code === 0) {
            settle()
            return
          }
          reject(new Error(
            `desktop project: pnpm exited with ${String(code ?? signal)}${diagnostics.trim() === '' ? '' : `: ${diagnostics.trim()}`}`,
          ))
        })
      })
    })
  }

  private writeLockOwner(pid: number): void {
    const descriptor = this.lockDescriptor
    if (descriptor === undefined) throw new Error('desktop project: package transaction lost its lock')
    const content = Buffer.from(`${String(pid)}\n`)
    ftruncateSync(descriptor, 0)
    writeSync(descriptor, content, 0, content.byteLength, 0)
    fsyncSync(descriptor)
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    mkdirSync(this.paths.root, { recursive: true, mode: 0o700 })
    let descriptor: number
    try {
      descriptor = openSync(this.paths.lock, 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const lock = lstatSync(this.paths.lock)
        if (lock.isSymbolicLink() || !lock.isFile()) {
          throw new Error('desktop project: package transaction lock is not a regular file')
        }
        const owner = Number.parseInt(readFileSync(this.paths.lock, 'utf8').trim(), 10)
        let active = !Number.isSafeInteger(owner) || owner <= 0
        if (!active) {
          try {
            process.kill(owner, 0)
            active = true
          } catch (signalError) {
            active = (signalError as NodeJS.ErrnoException).code !== 'ESRCH'
          }
        }
        if (active) throw new Error('desktop project: another package transaction is active')
        unlinkSync(this.paths.lock)
        descriptor = openSync(this.paths.lock, 'wx', 0o600)
      } else {
        throw error
      }
    }
    try {
      this.lockDescriptor = descriptor
      this.writeLockOwner(process.pid)
      return await operation()
    } finally {
      this.lockDescriptor = undefined
      closeSync(descriptor)
      unlinkSync(this.paths.lock)
    }
  }
}

/** Create seed metadata for one exact Electron and avn release. */
export function createSeedMetadata(seedDir: string, release: DesktopRelease): void {
  mkdirSync(seedDir, { recursive: true, mode: 0o700 })
  const packageSet = verifyDesktopCorePackageSet(seedDir, release.version)
  const manifest: DesktopProjectManifest = {
    name: PROJECT_NAME,
    private: true,
    version: '0.0.0',
    dependencies: desktopCorePackageOverrides(packageSet),
    avn: { profile: { bundles: [...DESKTOP_PROFILE_BUNDLES] } },
  }
  writeJson(join(seedDir, 'package.json'), manifest)
  writeFileSync(
    join(seedDir, 'pnpm-workspace.yaml'),
    workspaceFile(desktopCorePackageOverrides(packageSet)),
    { mode: 0o600 },
  )
  writeJson(join(seedDir, 'desktop-release.json'), release)
}

/**
 * Create metadata for the unpackaged development project that links the current workspace.
 * @param projectDir - Disposable development profile directory.
 * @param release - Release identity shared by the linked CLI package and Electron shell.
 */
export function createDevelopmentProjectMetadata(projectDir: string, release: DesktopRelease): void {
  mkdirSync(projectDir, { recursive: true, mode: 0o700 })
  const manifest = {
    name: PROJECT_NAME,
    private: true,
    version: '0.0.0',
    dependencies: {
      [AVN_PACKAGE]: release.version,
      [DESKTOP_HOST_PACKAGE]: release.version,
    },
    avn: { profile: { bundles: [...DESKTOP_PROFILE_BUNDLES] } },
  }
  writeJson(join(projectDir, 'package.json'), manifest)
  writeFileSync(join(projectDir, 'pnpm-workspace.yaml'), workspaceFile(), { mode: 0o600 })
  writeJson(join(projectDir, 'desktop-release.json'), release)
}
