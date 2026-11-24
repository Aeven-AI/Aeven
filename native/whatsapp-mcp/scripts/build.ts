/**
 * Build the WhatsApp MCP daemon for one platform package from the vendored Go source in `source/`.
 *
 * The daemon uses a pure-Go SQLite driver, so `CGO_ENABLED=0` cross-compiles every target from any host;
 * the binary lands in `packages/<platform>-<arch>/bin/` (git-ignored, packed into that package's tarball).
 * Go fetches module dependencies on first build and, through `GOTOOLCHAIN=auto`, the toolchain `source/go.mod` pins.
 * Modules are downloaded before the build, retried, and fetched from their origin when the module proxy fails, because one
 * dropped proxy stream otherwise fails a whole release build.
 *
 * Run: `pnpm run build:native [--target <platform>-<arch>]` (Go 1.21+ on PATH; the default target is the host).
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { goCommand } from '../../../scripts/build-tools.ts'

const ROOT = resolve(import.meta.dirname, '..')
const TARGETS = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64'] as const
type Target = typeof TARGETS[number]
/** Upstream commit the vendored source was taken from; reported by `whatsapp-mcp -version`. */
const UPSTREAM = 'ee039b67234a5216bda4e9a88c4e2fe1a2beae6f'

function goTarget(target: Target): { GOOS: string; GOARCH: string } {
  const [platform, arch] = target.split('-') as [string, string]
  return { GOOS: platform === 'win32' ? 'windows' : platform, GOARCH: arch === 'x64' ? 'amd64' : arch }
}

/** Module download attempts before the build gives up; each failure is a network error, not a source error. */
const DOWNLOAD_ATTEMPTS = 4

/**
 * Download every module `source/go.mod` requires into the module cache, retrying a failed attempt.
 * @param env - the build's environment.
 */
function downloadModules(env: NodeJS.ProcessEnv): void {
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    const result = spawnSync(goCommand(), ['mod', 'download', '-x'], { cwd: join(ROOT, 'source'), stdio: 'inherit', env })
    if (result.error === undefined && result.status === 0) return
    console.warn(`build: go mod download attempt ${String(attempt)} of ${String(DOWNLOAD_ATTEMPTS)} failed (${result.error?.message ?? `exit ${String(result.status)}`})`)
  }
  throw new Error(`build: go mod download failed ${String(DOWNLOAD_ATTEMPTS)} times`)
}

function main(): void {
  const { values } = parseArgs({ options: { target: { type: 'string' } } })
  const target = (values.target ?? `${process.platform}-${process.arch}`) as Target
  if (!(TARGETS as readonly string[]).includes(target)) throw new Error(`build: unknown target ${target}; expected ${TARGETS.join(', ')}`)
  const name = target.startsWith('win32-') ? 'whatsapp-mcp.exe' : 'whatsapp-mcp'
  const destination = join(ROOT, 'packages', target, 'bin', name)
  mkdirSync(join(ROOT, 'packages', target, 'bin'), { recursive: true })
  // `|` makes Go fetch a module from its origin after any proxy error, where `,` would only do so after a 404 or 410.
  const env = {
    ...process.env, ...goTarget(target), CGO_ENABLED: '0', GOTOOLCHAIN: process.env.GOTOOLCHAIN ?? 'auto',
    GOPROXY: process.env.GOPROXY ?? 'https://proxy.golang.org|direct',
  }
  downloadModules(env)
  const result = spawnSync(goCommand(), [
    'build', '-trimpath', '-ldflags', `-s -w -X main.Version=aeven-${UPSTREAM.slice(0, 12)}`, '-o', destination, './cmd/whatsapp-mcp',
  ], { cwd: join(ROOT, 'source'), stdio: 'inherit', env })
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`build: go build for ${target} failed (${result.error?.message ?? `exit ${String(result.status)}`})`)
  }
  console.log(`build: whatsapp-mcp for ${target} -> ${destination}`)
}

main()
