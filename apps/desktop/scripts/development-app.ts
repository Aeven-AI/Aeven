/** macOS development bundle that loads the current workspace through Electron. */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { MACOS_USAGE_DESCRIPTIONS } from './macos-usage-descriptions.mjs'

/**
 * Workspace and runtime settings captured for Launch Services cold starts.
 *
 * The macOS Electron executable refuses `--remote-debugging-port` and
 * `--user-data-dir` on its command line, so every value a development launch
 * needs is baked into the generated bundle instead of passed as an argument.
 */
export interface DevelopmentAppOptions {
  /** Installed Electron executable inside the packaged `Electron.app`. */
  readonly electron: string
  /** Desktop application root passed to Electron as the application path. */
  readonly appRoot: string
  /** Directory that holds the generated bundle. */
  readonly directory: string
  /** Aeven home the launched shell serves. */
  readonly home: string
  /** Chromium user-data directory for this development launch. */
  readonly userData: string
  /** Prepared development project directory the shell adopts. */
  readonly projectDir: string
  /** Node executable the shell starts its Host with. */
  readonly nodeBinary: string
  /** Main-process inspector port. */
  readonly mainPort: number
  /** Renderer remote-debugging port. */
  readonly rendererPort: number
  /** Host inspector port. */
  readonly hostPort: number
  /** Whether the shell opens developer tools on launch. */
  readonly openDevtools: string
}

function quote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'` }

/**
 * Prepare and register a disposable .app without changing the installed Electron package.
 *
 * The bundle is rebuilt only when its inputs change, so repeated launches reuse
 * it. The bundle identifier derives from the workspace root, letting parallel
 * checkouts register distinct applications with Launch Services.
 * @param options - Current workspace, Electron binary, and private development locations.
 * @returns executable used by the supported desktop development launcher.
 */
export function prepareDevelopmentApp(options: DevelopmentAppOptions): string {
  const source = dirname(dirname(dirname(options.electron)))
  const bundle = join(options.directory, 'Aeven Dev.app')
  const executable = join(bundle, 'Contents', 'MacOS', 'AevenDev')
  const stamp = join(bundle, 'Contents', 'Resources', 'avn-development.json')
  const launcher = developmentLauncher(options, bundle)
  const values = {
    CFBundleIdentifier: `ai.aeven.dev.${createHash('sha256').update(options.appRoot).digest('hex').slice(0, 12)}`,
    CFBundleName: 'Aeven Dev',
    CFBundleDisplayName: 'Aeven Dev',
    CFBundleExecutable: 'AevenDev',
    ...MACOS_USAGE_DESCRIPTIONS,
  }
  const identity = JSON.stringify({ ...options, launcher, values, plist: readFileSync(join(source, 'Contents', 'Info.plist'), 'utf8') })
  if (!existsSync(stamp) || readFileSync(stamp, 'utf8') !== identity) {
    rmSync(bundle, { recursive: true, force: true })
    execFileSync('/usr/bin/ditto', [source, bundle])
    const plist = join(bundle, 'Contents', 'Info.plist')
    for (const [key, value] of Object.entries(values)) {
      execFileSync('/usr/bin/plutil', ['-replace', key, '-json', JSON.stringify(value), plist])
    }
    writeFileSync(executable, launcher, { mode: 0o755 })
    writeFileSync(stamp, identity, { mode: 0o600 })
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'pipe' })
  }
  execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', bundle])
  return executable
}

/**
 * Create the development executable used by both the CLI and Launch Services.
 *
 * Launch Services starts the bundle without the environment or arguments a
 * shell launch provides, so the script carries both as literals.
 * @param options - Persisted development locations and debugging settings.
 * @param bundle - Generated application bundle.
 * @returns shell program with literal arguments and environment values.
 */
export function developmentLauncher(options: DevelopmentAppOptions, bundle: string): string {
  const environment = {
    AVN_HOME: options.home,
    AVN_DESKTOP_DEV_APP: '1',
    AVN_DESKTOP_DEV_PROJECT_DIR: options.projectDir,
    AVN_DESKTOP_HOST_INSPECT_PORT: String(options.hostPort),
    AVN_DESKTOP_NODE_BINARY: options.nodeBinary,
    AVN_DESKTOP_OPEN_DEVTOOLS: options.openDevtools,
    ELECTRON_ENABLE_LOGGING: '1',
  }
  const args = [
    join(bundle, 'Contents', 'MacOS', 'Electron'),
    `--inspect=127.0.0.1:${String(options.mainPort)}`,
    `--remote-debugging-port=${String(options.rendererPort)}`,
    `--user-data-dir=${options.userData}`,
    options.appRoot,
  ]
  return [
    '#!/bin/sh',
    ...Object.entries(environment).map(([key, value]) => `export ${key}=${quote(value)}`),
    `cd ${quote(options.appRoot)}`,
    `exec ${args.map(quote).join(' ')} "$@"`,
    '',
  ].join('\n')
}
