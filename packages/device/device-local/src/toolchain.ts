/**
 * Pinned installs of the two npm tools device support is built on:
 * expo-device-hub streams simulator and emulator screens, and agent-device
 * drives them for the model.
 *
 * Each installs into `<toolsDir>/<name>/<version>` after its consent step and
 * runs from there with the Host's Node, never through `npx`: an ephemeral npx
 * cache would make the first open after a reboot depend on the registry, and
 * the pinned agent-device version is what `device_open`'s instructions
 * describe. An install stages into a sibling directory, writes a sentinel only
 * after npm exits 0, then renames into place, since npm extracts files before
 * it finishes.
 *
 * @module @aeven/device-local/toolchain
 */
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** One pinned npm tool. */
export interface ToolSpec {
  readonly name: string
  readonly version: string
  /** Entry script below the package directory. */
  readonly entry: readonly string[]
}

/** Where one pinned install lives. */
export interface ToolPaths {
  readonly installDir: string
  /** Absolute path of the entry script, run with the Host's Node. */
  readonly entryPath: string
  readonly sentinelPath: string
}

/**
 * The paths of one pinned install.
 * @param toolsDir - root of every install.
 * @param spec - the tool.
 * @returns its install, entry, and sentinel paths.
 */
export function toolPaths(toolsDir: string, spec: ToolSpec): ToolPaths {
  const installDir = join(toolsDir, spec.name, spec.version)
  return {
    installDir,
    entryPath: join(installDir, 'node_modules', spec.name, ...spec.entry),
    sentinelPath: join(installDir, '.install-complete'),
  }
}

/**
 * Whether the pinned version finished installing.
 * @param toolsDir - root of every install.
 * @param spec - the tool.
 * @returns true when the entry exists and the sentinel names the version.
 */
export async function isToolInstalled(toolsDir: string, spec: ToolSpec): Promise<boolean> {
  const paths = toolPaths(toolsDir, spec)
  const [entry, sentinel] = await Promise.all([
    access(paths.entryPath).then(() => true, () => false),
    readFile(paths.sentinelPath, 'utf8').catch(() => undefined),
  ])
  return entry && sentinel?.trim() === spec.version
}

/** Installs run one at a time, so two tools never race npm's cache. */
let installQueue: Promise<unknown> = Promise.resolve()

/**
 * Install the pinned version unless it is already complete.
 * @param toolsDir - root of every install.
 * @param spec - the tool.
 * @param npm - npm executable.
 * @param timeoutMs - install deadline.
 * @returns the install's paths.
 */
export function ensureTool(toolsDir: string, spec: ToolSpec, npm: string, timeoutMs: number): Promise<ToolPaths> {
  const run = async (): Promise<ToolPaths> => {
    const paths = toolPaths(toolsDir, spec)
    if (await isToolInstalled(toolsDir, spec)) return paths
    await rm(paths.installDir, { recursive: true, force: true })
    await mkdir(dirname(paths.installDir), { recursive: true })
    const staging = await mkdtemp(join(dirname(paths.installDir), '.staging-'))
    try {
      await runNpm(npm, ['install', '--prefix', staging, '--no-fund', '--no-audit', `${spec.name}@${spec.version}`], timeoutMs, spec.name)
      await access(join(staging, 'node_modules', spec.name, ...spec.entry)).catch(() => {
        throw new Error(`Installing ${spec.name} failed: the installed package has no ${spec.entry.join('/')}.`)
      })
      await writeFile(join(staging, '.install-complete'), `${spec.version}\n`)
      try {
        await rename(staging, paths.installDir)
      } catch (error) {
        // Another Host process may have published the same version first.
        if (!await isToolInstalled(toolsDir, spec)) throw error
      }
      return paths
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }
  const next = installQueue.then(run, run)
  installQueue = next.catch(() => undefined)
  return next
}

function runNpm(npm: string, args: readonly string[], timeoutMs: number, tool: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(npm, args, { stdio: ['ignore', 'ignore', 'pipe'], shell: process.platform === 'win32' })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4000) })
    const timer = setTimeout(() => { child.kill('SIGTERM') }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`Installing ${tool} failed: could not run ${npm} (${error.message}).`))
    })
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`Installing ${tool} failed: npm exited ${signal ?? String(code)}. ${stderr.trim().split('\n').at(-1) ?? ''}`.trim()))
    })
  })
}

/**
 * The pane's text for an install about to run.
 * @param label - what is installing, e.g. "device hub".
 * @param version - the pinned version.
 * @returns the phase detail.
 */
export function installMessage(label: string, version: string): string {
  return `Installing ${label} ${version}…`
}
