/** Build and launch the unpackaged Electron shell against the current workspace. */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pnpmInvocation } from '../../../scripts/pnpm-invocation.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import type { DesktopRelease } from '../src/release.ts'
import { resolveAvnHome } from '@aeven/home-paths'
import { prepareDevelopmentApp } from './development-app.ts'
import { prepareDevelopmentProject } from './development-project.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')
const BUILD_ROOT = join(APP_ROOT, '.desktop-build')
const DEVELOPMENT_ROOT = join(BUILD_ROOT, 'development')

interface PackageManifest {
  readonly version?: string
}

function packageVersion(path: string, subject: string): string {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
  if (typeof manifest.version !== 'string') throw new Error(`desktop development: ${subject} has no version`)
  return manifest.version
}

function debugPort(name: string, fallback: number): number {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`desktop development: ${name} must be an integer from 1 through 65535`)
  }
  return port
}

async function run(command: string, args: readonly string[], cwd: string, environment = process.env): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`desktop development: ${args.join(' ')} exited with ${String(code ?? signal)}`))
    })
  })
}

async function runPackageScript(script: string, cwd: string): Promise<void> {
  const invocation = pnpmInvocation(['run', script])
  await run(invocation.command, invocation.args, cwd)
}

async function launchElectron(projectDir: string): Promise<void> {
  const require = createRequire(import.meta.url)
  const electron: unknown = require('electron')
  if (typeof electron !== 'string') throw new Error('desktop development: electron executable is unavailable')
  const mainPort = debugPort('AVN_DESKTOP_MAIN_INSPECT_PORT', 9229)
  const rendererPort = debugPort('AVN_DESKTOP_RENDERER_DEBUG_PORT', 9222)
  const hostPort = debugPort('AVN_DESKTOP_HOST_INSPECT_PORT', 9230)
  // The repository `.env` holds the deployment settings the profile's identity
  // and provider rows read (the API and OAuth URLs). A shell that
  // exported them already wins, since `loadEnvFile` does not overwrite.
  try {
    process.loadEnvFile(join(REPOSITORY_ROOT, '.env'))
  } catch (error) {
    // ENOENT is the ordinary case: a checkout without a `.env` relies on the
    // ambient environment, and every other read failure is worth naming.
    if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') {
      console.warn(`desktop development: failed to load .env: ${String(error)}`)
    }
  }
  // A private home starts signed out and empty, so development defaults to the
  // home the reader already uses; `AVN_HOME` still selects a throwaway one.
  const home = resolveAvnHome()
  const userData = join(DEVELOPMENT_ROOT, 'electron-user-data')
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    // Electron runs as plain Node when this is set, which rejects every
    // Chromium flag below. Tooling that spawns Node through Electron leaves it
    // in the environment, so the shell clears it rather than inheriting it.
    ELECTRON_RUN_AS_NODE: undefined,
    AVN_HOME: home,
    AVN_DESKTOP_DEV_PROJECT_DIR: projectDir,
    AVN_DESKTOP_HOST_INSPECT_PORT: String(hostPort),
    AVN_DESKTOP_NODE_BINARY: process.execPath,
    AVN_DESKTOP_OPEN_DEVTOOLS: process.env.AVN_DESKTOP_OPEN_DEVTOOLS ?? '1',
    ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? '1',
  }
  console.log(`desktop development: AVN_HOME=${home}`)
  console.log(`desktop development: inspectors main=${String(mainPort)}, renderer=${String(rendererPort)}, host=${String(hostPort)}`)
  // The macOS Electron executable rejects `--remote-debugging-port` and
  // `--user-data-dir` as command-line arguments, so darwin launches a
  // generated bundle that carries them in its own launcher instead.
  if (process.platform === 'darwin') {
    const executable = prepareDevelopmentApp({
      electron,
      appRoot: APP_ROOT,
      directory: DEVELOPMENT_ROOT,
      home,
      userData,
      projectDir,
      nodeBinary: process.execPath,
      mainPort,
      rendererPort,
      hostPort,
      openDevtools: environment.AVN_DESKTOP_OPEN_DEVTOOLS ?? '1',
    })
    await run(executable, [], APP_ROOT, environment)
    return
  }
  await run(electron, [
    `--inspect=127.0.0.1:${String(mainPort)}`,
    `--remote-debugging-port=${String(rendererPort)}`,
    `--user-data-dir=${userData}`,
    APP_ROOT,
  ], APP_ROOT, environment)
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'skip-build': { type: 'boolean', default: false } } })
  if (!values['skip-build']) {
    await runPackageScript('build', REPOSITORY_ROOT)
    await runPackageScript('build', APP_ROOT)
  }
  for (const path of [
    join(APP_ROOT, 'lib', 'main.js'),
    join(REPOSITORY_ROOT, 'apps', 'desktop-host', 'lib', 'index.js'),
  ]) {
    if (!existsSync(path)) throw new Error(`desktop development: missing built artifact ${path}`)
  }
  const version = packageVersion(join(APP_ROOT, 'package.json'), 'desktop package')
  const pnpmVersion = packageVersion(join(APP_ROOT, 'node_modules', 'pnpm', 'package.json'), 'pnpm package')
  const release: DesktopRelease = {
    schemaVersion: 1,
    version,
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: process.versions.node,
    pnpmVersion,
  }
  const projectDir = prepareDevelopmentProject({
    projectDir: join(DEVELOPMENT_ROOT, 'project'),
    cliDir: join(REPOSITORY_ROOT, 'apps', 'cli'),
    hostDir: join(REPOSITORY_ROOT, 'apps', 'desktop-host'),
    dependencyDir: join(REPOSITORY_ROOT, 'node_modules', '.pnpm', 'node_modules'),
    workspacePackageRoots: [join(REPOSITORY_ROOT, 'vendor'), join(REPOSITORY_ROOT, 'packages')],
    release,
  })
  await launchElectron(projectDir)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
