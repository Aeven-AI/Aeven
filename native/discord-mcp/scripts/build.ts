/**
 * Compile the Aeven-owned server into `dist/`.
 *
 * The connector spawns `dist/main.js` with the runtime that hosts Aeven, so the
 * build must complete before the package is packed into a Desktop package set.
 * Run: `pnpm --dir native/discord-mcp run build`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const ENTRY = join(ROOT, 'dist', 'main.js')
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')

const result = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { cwd: ROOT, stdio: 'inherit' })
if (result.error !== undefined || result.status !== 0) {
  throw new Error(`discord-mcp build: tsc failed (${result.error?.message ?? `exit ${String(result.status)}`})`)
}
if (!existsSync(ENTRY)) throw new Error(`discord-mcp build: tsc emitted no entry at ${ENTRY}`)
console.log(`discord-mcp build: entry -> ${ENTRY}`)
