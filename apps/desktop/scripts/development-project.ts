/** Prepare the disposable npm-project view used by an unpackaged Electron shell. */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { createDevelopmentProjectMetadata } from '../src/project-manager.ts'
import type { DesktopRelease } from '../src/release.ts'

interface PackageManifest {
  readonly name?: string
  readonly version?: string
}

/** Inputs whose locations differ between the launcher and isolated tests. */
export interface DevelopmentProjectOptions {
  /** Directory replaced with the generated development project. */
  readonly projectDir: string
  /** Current workspace's `apps/cli` package directory. */
  readonly cliDir: string
  /** Current workspace's private Desktop Host application directory. */
  readonly hostDir: string
  /** pnpm's workspace-wide virtual-hoist directory. */
  readonly dependencyDir: string
  /**
   * Workspace directories holding packages one or two levels down
   * (`vendor/<pkg>`, `packages/<group>/<pkg>`). Each package is linked under
   * its own name over the hoist, which pnpm leaves stale for a package added
   * or renamed after its last full install.
   */
  readonly workspacePackageRoots: readonly string[]
  /** Release identity written into the disposable project metadata. */
  readonly release: DesktopRelease
}

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

function removeOwnedPath(path: string): void {
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (stat.isSymbolicLink()) {
    unlinkSync(path)
    return
  }
  if (stat.isDirectory()) {
    rmSync(path, { recursive: true })
    return
  }
  unlinkSync(path)
}

function linkDirectory(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true })
  symlinkSync(realpathSync(source), destination, process.platform === 'win32' ? 'junction' : 'dir')
}

/** Link one hoisted entry; a link pnpm left behind for a moved or removed package is skipped. */
function mirrorDependencyLink(source: string, destination: string): void {
  if (!existsSync(source)) return
  linkDirectory(source, destination)
}

function mirrorDependencyLinks(sourceRoot: string, destinationRoot: string): void {
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.name === '.bin') continue
    const source = join(sourceRoot, entry.name)
    if (entry.name.startsWith('@') && (entry.isDirectory() || entry.isSymbolicLink())) {
      mkdirSync(join(destinationRoot, entry.name), { recursive: true })
      for (const scoped of readdirSync(source, { withFileTypes: true })) {
        if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue
        mirrorDependencyLink(join(source, scoped.name), join(destinationRoot, entry.name, scoped.name))
      }
      continue
    }
    if (entry.isDirectory() || entry.isSymbolicLink()) mirrorDependencyLink(source, join(destinationRoot, entry.name))
  }
}

function linkWorkspacePackage(dir: string, destinationRoot: string): boolean {
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) return false
  const name = readManifest(manifestPath).name
  if (name === undefined) return true
  const destination = join(destinationRoot, name)
  removeOwnedPath(destination)
  linkDirectory(dir, destination)
  return true
}

function linkWorkspacePackages(roots: readonly string[], destinationRoot: string): void {
  for (const root of roots) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(root, entry.name)
      if (linkWorkspacePackage(dir, destinationRoot)) continue
      for (const nested of readdirSync(dir, { withFileTypes: true })) {
        if (nested.isDirectory()) linkWorkspacePackage(join(dir, nested.name), destinationRoot)
      }
    }
  }
}

/**
 * Replace one disposable project with links to the current built workspace.
 * @param options - Project destination, CLI package, workspace package roots, and release identity.
 * @returns the absolute project directory supplied by the caller.
 */
export function prepareDevelopmentProject(options: DevelopmentProjectOptions): string {
  const cliManifest = readManifest(join(options.cliDir, 'package.json'))
  if (cliManifest.name !== '@aeven/cli' || cliManifest.version !== options.release.version) {
    throw new Error(
      `desktop development: apps/cli must be @aeven/cli@${options.release.version}, found `
      + `${String(cliManifest.name)}@${String(cliManifest.version)}`,
    )
  }
  if (!existsSync(options.dependencyDir)) {
    throw new Error('desktop development: workspace dependency links are missing; run pnpm install')
  }
  const hostManifest = readManifest(join(options.hostDir, 'package.json'))
  if (hostManifest.name !== '@aeven/desktop-host' || hostManifest.version !== options.release.version) {
    throw new Error(
      `desktop development: apps/desktop-host must be @aeven/desktop-host@${options.release.version}, found `
      + `${String(hostManifest.name)}@${String(hostManifest.version)}`,
    )
  }
  if (!existsSync(join(options.hostDir, 'lib', 'index.js'))) {
    throw new Error('desktop development: apps/desktop-host/lib/index.js is missing; run pnpm run build')
  }

  removeOwnedPath(options.projectDir)
  createDevelopmentProjectMetadata(options.projectDir, options.release)
  const destinationModules = join(options.projectDir, 'node_modules')
  mkdirSync(destinationModules, { recursive: true })
  mirrorDependencyLinks(options.dependencyDir, destinationModules)
  linkWorkspacePackages(options.workspacePackageRoots, destinationModules)
  const avnLink = join(destinationModules, '@aeven', 'cli')
  removeOwnedPath(avnLink)
  linkDirectory(options.cliDir, avnLink)
  const hostLink = join(destinationModules, '@aeven', 'desktop-host')
  removeOwnedPath(hostLink)
  linkDirectory(options.hostDir, hostLink)
  return options.projectDir
}
