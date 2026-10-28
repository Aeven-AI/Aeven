/**
 * Regenerate every generated documentation reference in place, then re-record
 * the translation pairs whose files the generators rewrote. Generated output
 * is derived from source, so it is fixed by rerunning its generator rather
 * than by hand. `doc-sync` and `test:docs` run only this and always exit 0:
 * documentation checks never block a change. `doc-check` runs the full
 * documentation gate list on request.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pnpmInvocation } from './pnpm-invocation.ts'

/** Generators whose outputs feed the other generators' TypeScript programs; they run first, in order. */
const FIRST = ['gen-tsconfig-paths', 'gen-scoped-events']

/** Generators with independent outputs; they run in parallel. */
const PARALLEL = [
  'gen-client-catalog',
  'gen-config-catalog',
  'gen-cordis-catalog',
  'gen-cordis-inspect-catalog',
  'gen-doc-graphs',
  'gen-module-graph',
  'gen-persistence-catalog',
  'gen-tool-catalog',
]

const root = resolve(import.meta.dirname, '..')

if (import.meta.main) {
  process.exitCode = await main()
}

async function main(): Promise<number> {
  const before = dirtyFileHashes()
  const failures: string[] = []
  for (const script of FIRST) {
    if (await runScript(script) !== 0) failures.push(script)
  }
  const exits = await Promise.all(PARALLEL.map(async script => [script, await runScript(script)] as const))
  for (const [script, code] of exits) if (code !== 0) failures.push(script)

  const rewritten = [...dirtyFileHashes()]
    .filter(([path, hash]) => before.get(path) !== hash)
    .map(([path]) => path)
  const pairs = rewritten.filter(path => path.endsWith('.md') && existsSync(resolve(root, sidecarOf(path))))
  if (pairs.length > 0 && await runScript('verify-translation-pairing', ['--write', ...pairs]) !== 0) {
    failures.push('verify-translation-pairing --write')
  }

  console.log(`doc-fix: ${rewritten.length} file(s) regenerated, ${pairs.length} translation pair file(s) re-recorded.`)
  if (failures.length > 0) console.warn(`doc-fix: advisory, not blocking: ${failures.join(', ')} reported problems.`)
  return 0
}

/**
 * The sidecar that records a document's translation pair.
 * @param path - repository-relative English or Chinese Markdown path.
 * @returns the pair's `.i18n.yaml` path.
 */
function sidecarOf(path: string): string {
  return path.replace(/(?:\.zh)?\.md$/u, '.i18n.yaml')
}

/**
 * Hash every modified or untracked file, so a generator rewrite of an already
 * dirty file is still detected.
 * @returns repository-relative path to content hash.
 */
function dirtyFileHashes(): Map<string, string> {
  const listed = spawnSync('git', ['ls-files', '-m', '-o', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
  if (listed.status !== 0) throw new Error(`doc-fix: git ls-files failed: ${listed.stderr}`)
  const hashes = new Map<string, string>()
  for (const path of listed.stdout.split('\0')) {
    if (path === '' || !existsSync(resolve(root, path))) continue
    hashes.set(path, createHash('sha1').update(readFileSync(resolve(root, path))).digest('hex'))
  }
  return hashes
}

/**
 * Run one package script with inherited output.
 * @param script - package script name.
 * @param args - extra arguments passed to the script.
 * @returns the child's exit code, or 1 when it ended by signal.
 */
function runScript(script: string, args: string[] = []): Promise<number> {
  const invocation = pnpmInvocation(['run', '--silent', script, ...args])
  return new Promise((settle) => {
    const child = spawn(invocation.command, invocation.args, { cwd: root, stdio: 'inherit' })
    child.on('error', () => settle(1))
    child.on('close', code => settle(code ?? 1))
  })
}
