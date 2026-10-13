/**
 * Build the WhatsApp MCP daemon for one platform package from the vendored Go source in `source/`.
 *
 * The daemon uses a pure-Go SQLite driver, so `CGO_ENABLED=0` cross-compiles every target from any host;
 * the binary lands in `packages/<platform>-<arch>/bin/` (git-ignored, packed into that package's tarball).
 * Go fetches module dependencies on first build and, through `GOTOOLCHAIN=auto`, the toolchain `source/go.mod` pins.
 *
 * Run: `pnpm run build:native [--target <platform>-<arch>]` (Go 1.21+ on PATH; the default target is the host).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const ROOT = resolve(import.meta.dirname, '..')
const TARGETS = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64'] as const
type Target = typeof TARGETS[number]
/** Upstream commit the vendored source was taken from; reported by `whatsapp-mcp -version`. */
const UPSTREAM = 'ee039b67234a5216bda4e9a88c4e2fe1a2beae6f'

function goTarget(target: Target): { GOOS: string; GOARCH: string } {
  const [platform, arch] = target.split('-') as [string, string]
  return { GOOS: platform === 'win32' ? 'windows' : platform, GOARCH: arch === 'x64' ? 'amd64' : arch }
}

/**
 * Go on PATH, else (Windows) the standard install, so a shell started before Go joined PATH
 * (an editor's integrated terminal) still builds.
 */
function goCommand(): string {
  if (process.platform !== 'win32' || spawnSync('go', ['version'], { stdio: 'ignore' }).error === undefined) return 'go'
  const installed = join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Go', 'bin', 'go.exe')
  if (!existsSync(installed)) throw new Error(`build: go is not on PATH and was not found at ${installed}`)
  return installed
}

function main(): void {
  const { values } = parseArgs({ options: { target: { type: 'string' } } })
  const target = (values.target ?? `${process.platform}-${process.arch}`) as Target
  if (!(TARGETS as readonly string[]).includes(target)) throw new Error(`build: unknown target ${target}; expected ${TARGETS.join(', ')}`)
  const name = target.startsWith('win32-') ? 'whatsapp-mcp.exe' : 'whatsapp-mcp'
  const destination = join(ROOT, 'packages', target, 'bin', name)
  mkdirSync(join(ROOT, 'packages', target, 'bin'), { recursive: true })
  const result = spawnSync(goCommand(), [
    'build', '-trimpath', '-ldflags', `-s -w -X main.Version=aeven-${UPSTREAM.slice(0, 12)}`, '-o', destination, './cmd/whatsapp-mcp',
  ], { cwd: join(ROOT, 'source'), stdio: 'inherit', env: { ...process.env, ...goTarget(target), CGO_ENABLED: '0', GOTOOLCHAIN: process.env.GOTOOLCHAIN ?? 'auto' } })
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`build: go build for ${target} failed (${result.error?.message ?? `exit ${String(result.status)}`})`)
  }
  console.log(`build: whatsapp-mcp for ${target} -> ${destination}`)
}

main()
