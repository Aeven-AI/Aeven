/** Build one Linux Desktop target inside a Docker container and copy its artifacts back to the host. */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')
const DOCKERFILE = join(APP_ROOT, 'linux-builder.Dockerfile')
const PNPM_STORE_VOLUME = 'dsh-desktop-linux-pnpm-store'
const DOCKER_PLATFORMS = {
  'linux-arm64': 'linux/arm64',
  'linux-x64': 'linux/amd64',
} as const
const FORWARDED_ENV_NAMES = ['DSH_DESKTOP_APP_ID', 'DSH_DESKTOP_AUTO_UPDATE_ENV', 'DOWNLOAD_TEST_ORIGIN'] as const

type LinuxTargetName = keyof typeof DOCKER_PLATFORMS

function isLinuxTarget(value: string): value is LinuxTargetName {
  return Object.hasOwn(DOCKER_PLATFORMS, value)
}

function pnpmVersion(): string {
  const manifest = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'package.json'), 'utf8')) as { packageManager?: unknown }
  const match = typeof manifest.packageManager === 'string' ? /^pnpm@(.+)$/u.exec(manifest.packageManager) : null
  if (match?.[1] === undefined) throw new Error('desktop linux container: root packageManager must name a pnpm version')
  return match[1]
}

function waitForExit(label: string, child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`desktop linux container: ${label} exited with ${String(code ?? signal)}`))
    })
  })
}

/** Working-tree files git would commit, plus the repository metadata the official build reads. */
async function sourceFiles(): Promise<string[]> {
  const git = spawn('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: REPOSITORY_ROOT,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const chunks: Buffer[] = []
  git.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
  await waitForExit('git ls-files', git)
  const listed = Buffer.concat(chunks).toString('utf8').split('\0').filter(path => path !== '')
  // A tracked file deleted in the working tree is still listed, and tar would fail on it.
  return ['.git', ...new Set(listed)].filter(path => existsSync(join(REPOSITORY_ROOT, path)))
}

async function buildImage(platform: string, tag: string): Promise<void> {
  const docker = spawn('docker', [
    'build',
    '--platform', platform,
    '--build-arg', `PNPM_VERSION=${pnpmVersion()}`,
    '--tag', tag,
    '-',
  ], { stdio: ['pipe', 'inherit', 'inherit'] })
  docker.stdin.end(readFileSync(DOCKERFILE))
  await waitForExit('docker build', docker)
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: { dir: { type: 'boolean', default: false } },
  })
  const target = positionals[0]
  if (target === undefined || positionals.length !== 1 || !isLinuxTarget(target)) {
    throw new Error(`desktop linux container: expected one target from ${Object.keys(DOCKER_PLATFORMS).join(', ')}`)
  }
  const platform = DOCKER_PLATFORMS[target]
  const tag = `dsh-desktop-linux-builder:${target}`
  const artifacts = desktopTargetBuildPaths(target).artifacts
  await buildImage(platform, tag)
  rmSync(artifacts, { recursive: true, force: true })
  mkdirSync(artifacts, { recursive: true })

  const containerArtifacts = `apps/desktop/.desktop-build/targets/${target}/artifacts`
  // package-target.ts reruns pnpm through npm_execpath, which only `pnpm run` provides.
  const packageScript = `package:${target.replace('-', ':')}${values.dir ? ':dir' : ''}`
  const script = [
    // Copy whatever electron-builder finished, even when a later target in the same run fails.
    `trap 'find /work/${containerArtifacts} -maxdepth 1 -type f -exec cp {} /out/ \\; 2>/dev/null || true' EXIT`,
    'mkdir -p /work',
    // Root owns the extracted tree so git accepts /work instead of rejecting the host owner's uid.
    'tar -x --no-same-owner -C /work',
    'cd /work',
    'pnpm install --frozen-lockfile',
    `pnpm --dir apps/desktop run ${packageScript}`,
  ].join(' && ')
  const forwarded = FORWARDED_ENV_NAMES.flatMap(name => process.env[name] === undefined ? [] : ['--env', name])
  const docker = spawn('docker', [
    'run', '--rm', '--interactive',
    '--platform', platform,
    '--volume', `${artifacts}:/out`,
    '--volume', `${PNPM_STORE_VOLUME}:/pnpm-store`,
    '--env', 'npm_config_store_dir=/pnpm-store',
    '--env', 'CI=true',
    ...forwarded,
    tag,
    'bash', '-euo', 'pipefail', '-c', script,
  ], { stdio: ['pipe', 'inherit', 'inherit'] })
  // COPYFILE_DISABLE and --no-xattrs keep macOS tar from adding AppleDouble `._*` entries and xattr headers.
  const tar = spawn('tar', ['-c', '-f', '-', '--no-xattrs', '--null', '-T', '-'], {
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, COPYFILE_DISABLE: '1' },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  tar.stdout.pipe(docker.stdin)
  tar.stdin.end(`${(await sourceFiles()).join('\0')}\0`)
  await Promise.all([waitForExit('tar', tar), waitForExit('docker run', docker)])
  process.stdout.write(`desktop linux container: ${target} artifacts in ${artifacts}\n`)
}

await main()
