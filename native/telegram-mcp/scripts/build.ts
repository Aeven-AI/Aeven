/**
 * Compile the pinned upstream source and the Aeven daemon entry into `dist/`.
 *
 * The connector spawns `dist/aeven/main.js` with the runtime that hosts Aeven,
 * so the build must complete before the package is packed into a Desktop
 * package set. Run: `pnpm --dir native/telegram-mcp run build`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const ENTRY = join(ROOT, 'dist', 'aeven', 'main.js')
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')

const result = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { cwd: ROOT, stdio: 'inherit' })
if (result.error !== undefined || result.status !== 0) {
  throw new Error(`telegram-mcp build: tsc failed (${result.error?.message ?? `exit ${String(result.status)}`})`)
}
if (!existsSync(ENTRY)) throw new Error(`telegram-mcp build: tsc emitted no entry at ${ENTRY}`)
console.log(`telegram-mcp build: entry -> ${ENTRY}`)
