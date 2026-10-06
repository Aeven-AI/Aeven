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
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
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
import { parseDesktopRelease, type DesktopRelease } from './release.ts'
import { extractPnpmStoreArchives, mergePnpmStore } from './seed-store.ts'

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

/** Hooks that bind project replacement to backend lifecycle and health. */
export interface DesktopProjectHooks {
  /** Prove the staged dependency graph while the active backend is stopped. */
  healthCheck(projectDir: string): Promise<void>
  /** Stop the active backend and await process exit before directory moves. */
  beforeActivate(): Promise<void>
  /** Start the selected active project after commit or rollback. */
  afterActivate(): Promise<void>
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
 * attachment reader's `sharp` release instead of carrying a second libvips.
 */
export const DESKTOP_DEPENDENCY_OVERRIDES: Readonly<Record<string, string>> = Object.fromEntries<string>([
  ...BROWSER_LIBRARY_DEPENDENCIES.map((name): [string, string] => [`@aeven/client-ui-primitives>${name}`, '-']),
  ...['lexical', '@lexical/history', '@lexical/plain-text', '@lexical/text', '@lexical/utils']
    .map((name): [string, string] => [`@aeven/client-ui-conversation>${name}`, '-']),
  ...['@xterm/xterm', '@xterm/addon-fit']
    .map((name): [string, string] => [`@aeven/client-ui-sidebar-terminal>${name}`, '-']),
  ['@huggingface/transformers>sharp', '^0.35.3'],
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
  // The Google connectors spawn the platform CLI this package's install script downloads into its own `bin/`; denying
  // the script leaves `bin/gws` missing and the connector tools unusable.
  return `packages:\n  - .\n\n${overrideSection}${WORKSPACE_SETTINGS}allowBuilds:\n  '@googleworkspace/cli': true\n  node-pty: true\n  koffi: true\n  fs-ext: true\n  esbuild: true\n  better-sqlite3: true\n  onnxruntime-node: false\n  sharp: true\n  ${JSON.stringify(coreBuildKey)}: true\n  '@google/genai': false\n  protobufjs: false\n  node-addon-require-builtin: false\n  tesseract.js: false\n`
}

function releaseFile(projectDir: string): DesktopRelease {
  return parseDesktopRelease(readJson(join(projectDir, 'desktop-release.json')))
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
  rmSync(path, { recursive: true })
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

function seedFiles(root: string): readonly DesktopSeedIntegrityRecord[] {
  const files: DesktopSeedIntegrityRecord[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const relativePath = path.slice(root.length + 1).split(sep).join('/')
      if (relativePath === 'integrity.json') continue
      if (entry.isSymbolicLink()) throw new Error(`desktop seed: symbolic link is not allowed: ${relativePath}`)
      if (entry.isDirectory()) {
        visit(path)
        continue
      }
      if (!entry.isFile()) throw new Error(`desktop seed: unsupported file type: ${relativePath}`)
      const body = readFileSync(path)
      files.push({
        path: relativePath,
        bytes: body.byteLength,
        sha256: createHash('sha256').update(body).digest('hex'),
      })
    }
  }
  visit(root)
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

/** Verify the packaged offline seed before any content enters writable desktop state. */
export function verifySeedIntegrity(seedDir: string): void {
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
  const actual = seedFiles(seedDir)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('desktop seed: integrity verification failed')
  }
}

function projectManifest(projectDir: string): DesktopProjectManifest {
  const path = join(projectDir, 'package.json')
  const value = readJson(path)
  const avn = isRecord(value) && isRecord(value.avn) ? value.avn : undefined
  const profile = isRecord(avn?.profile) ? avn.profile : undefined
  if (!isRecord(value) || value.name !== PROJECT_NAME || value.private !== true
    || typeof value.version !== 'string' || !isRecord(value.dependencies)
    || !Array.isArray(profile?.bundles) || !profile.bundles.every(bundle => typeof bundle === 'string')) {
    throw new Error(`desktop project: invalid desktop profile manifest ${path}`)
  }
  const manifest = value as unknown as DesktopProjectManifest
  const packageSet = readDesktopCorePackageSet(projectDir, releaseFile(projectDir).version)
  const expectedOverrides = desktopCorePackageOverrides(packageSet)
  if (manifest.dependencies[AVN_PACKAGE] !== desktopAvnPackageSpec(packageSet)
    || Object.entries(expectedOverrides).some(([name, spec]) => manifest.dependencies[name] !== spec)
    || readFileSync(join(projectDir, 'pnpm-workspace.yaml'), 'utf8') !== workspaceFile(expectedOverrides)) {
    throw new Error(`desktop project: core package mapping does not match ${DESKTOP_PACKAGE_SET_FILE}`)
  }
  return manifest
}

function profilePluginNames(projectDir: string): readonly string[] {
  const bundles = projectManifest(projectDir).avn.profile.bundles
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
  recover(): void {
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
      renameSync(this.paths.rollback, this.paths.profile)
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
    return releaseFile(this.paths.profile).version
  }

  /** Install or reconcile the active project to the Electron package's exact release. */
  async applyRelease(seedDir: string, electronVersion: string, hooks: DesktopProjectHooks): Promise<boolean> {
    return this.withLock(async () => {
      this.recover()
      verifySeedIntegrity(seedDir)
      const target = releaseFile(seedDir)
      verifyDesktopCorePackageSet(seedDir, target.version)
      if (target.version !== electronVersion) {
        throw new Error(`desktop project: seed ${target.version} does not match Electron ${electronVersion}`)
      }
      if (existsSync(this.paths.profile) && this.releaseVersion() === target.version
        && this.avnVersion() === target.version
        && this.installedPackageVersion(DESKTOP_HOST_PACKAGE) === target.version) {
        verifyDesktopCorePackageSet(this.paths.profile, target.version)
        return false
      }
      this.mergeSeedPnpmState(seedDir)
      const stagingProfile = this.newStagingProfile()
      try {
        if (existsSync(this.paths.profile)) {
          const plugins = pluginRecords(this.paths.profile)
          copyMetadata(seedDir, stagingProfile)
          await this.runPnpm(stagingProfile, ['install', '--offline', '--frozen-lockfile', '--trust-lockfile'])
          if (plugins.length > 0) {
            await this.runPnpm(stagingProfile, [
              'add',
              ...plugins.map(plugin => `${plugin.name}@${plugin.version}`),
              '--save-exact',
              '--offline',
            ])
            writeProfilePlugins(stagingProfile, plugins)
          }
        } else {
          copyMetadata(seedDir, stagingProfile)
          await this.runPnpm(stagingProfile, ['install', '--offline', '--frozen-lockfile', '--trust-lockfile'])
        }
        await hooks.healthCheck(stagingProfile)
        await this.activate(stagingProfile, hooks)
        return true
      } catch (error) {
        removeOwnedDirectory(stagingProfile)
        throw error
      }
    })
  }

  private newStagingProfile(): string {
    const path = join(this.paths.staging, randomUUID(), 'profile')
    mkdirSync(path, { recursive: true, mode: 0o700 })
    return path
  }

  private mergeSeedPnpmState(seedDir: string): void {
    const transactionRoot = join(this.paths.staging, randomUUID())
    const extractedStore = join(transactionRoot, 'store')
    try {
      extractPnpmStoreArchives(seedDir, extractedStore)
      mergePnpmStore(extractedStore, this.paths.pnpm.store)
    } finally {
      removeOwnedDirectory(transactionRoot)
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
    try {
      removeOwnedDirectory(this.paths.rollback)
      mkdirSync(dirname(this.paths.rollback), { recursive: true, mode: 0o700 })
      writeJson(this.paths.pending, { ...pending, step: 'active-moved' } satisfies DesktopPendingTransaction)
      if (existsSync(this.paths.profile)) {
        renameSync(this.paths.profile, this.paths.rollback)
        activeMoved = true
      }
      mkdirSync(dirname(this.paths.profile), { recursive: true, mode: 0o700 })
      writeJson(this.paths.pending, { ...pending, step: 'staging-activated' } satisfies DesktopPendingTransaction)
      renameSync(stagingProfile, this.paths.profile)
      await hooks.afterActivate()
      unlinkSync(this.paths.pending)
    } catch (error) {
      if (existsSync(this.paths.profile)) removeOwnedDirectory(this.paths.profile)
      if (activeMoved && existsSync(this.paths.rollback)) renameSync(this.paths.rollback, this.paths.profile)
      if (existsSync(this.paths.pending)) unlinkSync(this.paths.pending)
      await hooks.afterActivate().catch(() => undefined)
      throw error
    }
  }

  private async runPnpm(projectDir: string, args: readonly string[]): Promise<void> {
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
      const child = spawn(this.runtime.node, [
        this.runtime.pnpm,
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
          PATH: `${dirname(this.runtime.node)}${delimiter}${process.env.PATH ?? ''}`,
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
