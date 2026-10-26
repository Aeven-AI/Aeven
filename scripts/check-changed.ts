/**
 * Run the checks the working tree actually needs, scoped to the packages its
 * changes touch: `pnpm run check:changed [types|tests|docs]`.
 *
 * `tsc -b` over the whole solution rebuilds every project from scratch whenever
 * its incremental state is gone — a fresh `pnpm install` alone discards it — so
 * the inner loop pays minutes for a one-line edit. This driver maps changed
 * files to their owning package and asks TypeScript, vitest, and the pairing
 * check about exactly those packages instead. It is a convenience, not a gate:
 * `pnpm run typecheck`, `pnpm run test`, and `pnpm run test:docs` keep their
 * corpus-wide meaning, and a change outside any package (root configs,
 * `scripts/`, `docs/`) still falls back to the corpus-wide command.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')

/** What a run may include; the default is all three. */
type Step = 'types' | 'tests' | 'docs'

/** Run one command from the repository root, inheriting stdio, and fail the run on error. */
function run(command: string, args: string[], label: string): void {
  console.log(`\ncheck-changed: ${label}\n  ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`check-changed: ${label} failed.`)
    process.exit(result.status ?? 1)
  }
}

/** Repository-relative, `/`-separated paths of every changed file: staged,
 * unstaged, and untracked, so the mapping sees work in progress. */
function changedFiles(): string[] {
  const queries = [
    ['diff', '--name-only', 'HEAD'],
    ['ls-files', '--others', '--exclude-standard'],
  ]
  const files = new Set<string>()
  for (const query of queries) {
    const result = spawnSync('git', query, { cwd: root, encoding: 'utf8' })
    if (result.status !== 0) {
      console.error(`check-changed: \`git ${query.join(' ')}\` failed:\n${result.stderr}`)
      process.exit(result.status ?? 1)
    }
    for (const line of result.stdout.split('\n')) {
      const path = line.trim()
      if (path !== '') files.add(path)
    }
  }
  return [...files].sort()
}

/** The package directory owning a file, or null when the file is outside every package. */
function packageDirOf(file: string): string | null {
  let dir = dirname(join(root, file))
  while (dir.startsWith(root) && dir !== root) {
    if (existsSync(join(dir, 'package.json'))) return relative(root, dir)
    dir = dirname(dir)
  }
  return null
}

/** Whether a repository-relative path is a directory holding the named entry. */
function hasEntry(dir: string, entry: string): boolean {
  const path = join(root, dir, entry)
  return existsSync(path) && statSync(path).isDirectory()
}

/** Group changed files by owning package, keeping files outside packages separately. */
function groupByPackage(files: string[]): { packages: Map<string, string[]>; outside: string[] } {
  const packages = new Map<string, string[]>()
  const outside: string[] = []
  for (const file of files) {
    const dir = packageDirOf(file)
    if (dir === null) {
      outside.push(file)
      continue
    }
    const owned = packages.get(dir)
    if (owned === undefined) packages.set(dir, [file])
    else owned.push(file)
  }
  return { packages, outside }
}

/** The project files to hand `tsc -b`: each changed package's own solution, or
 * both compiler faces when the change is outside every package. */
function typecheckProjects(packages: string[], outside: string[]): string[] {
  const projects = packages
    .filter(dir => existsSync(join(root, dir, 'tsconfig.json')))
    .map(dir => join(dir, 'tsconfig.json'))
  if (outside.length > 0 || projects.length === 0) {
    return ['tsconfig.host.json', 'tsconfig.client.json']
  }
  return projects
}

/** Test directories to hand vitest, plus the repository spec tree when a script changed. */
function testTargets(packages: string[], outside: string[]): string[] {
  const targets = packages
    .filter(dir => hasEntry(dir, 'tests'))
    .map(dir => join(dir, 'tests'))
  const scripts = outside.filter(file => file.startsWith(`scripts${sep}`))
  if (scripts.length > 0 || targets.length === 0) targets.push('scripts')
  return targets
}

/** Documentation pairs touched by the change, named as the pairing check expects
 * them: repository-relative English paths. */
function touchedPairs(files: string[]): string[] {
  return files.filter(file => file.endsWith('.md') && !file.endsWith('.zh.md'))
}

/** CLI entry: parse the optional step names and run each requested step. */
function main(): void {
  const requested = process.argv.slice(2).filter((arg): arg is Step => arg === 'types' || arg === 'tests' || arg === 'docs')
  const steps: Step[] = requested.length > 0 ? requested : ['types', 'tests', 'docs']
  const files = changedFiles()
  if (files.length === 0) {
    console.log('check-changed: no changes against HEAD.')
    return
  }
  const { packages, outside } = groupByPackage(files)
  console.log(`check-changed: ${files.length} changed file(s) in ${packages.size} package(s)`)
  for (const [dir, owned] of [...packages].sort()) {
    console.log(`  ${dir} (${owned.length})`)
  }
  if (outside.length > 0) console.log(`  outside packages: ${outside.length} file(s)`)

  if (steps.includes('types')) {
    run('node_modules/.bin/tsc', ['-b', ...typecheckProjects([...packages.keys()], outside)], 'typecheck (scoped)')
  }
  if (steps.includes('tests')) {
    run('node_modules/.bin/vitest', ['run', ...testTargets([...packages.keys()], outside)], 'tests (scoped)')
  }
  if (steps.includes('docs')) {
    const pairs = touchedPairs(files)
    if (pairs.length === 0) console.log('\ncheck-changed: no documentation pair touched.')
    else run('node_modules/.bin/tsx', ['scripts/verify-translation-pairing.ts', ...pairs], 'translation pairing (scoped)')
  }
  console.log('\ncheck-changed: done.')
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  main()
}
