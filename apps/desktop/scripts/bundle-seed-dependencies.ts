/** Consolidate reviewed CommonJS dependencies without changing package paths or shared module identities. */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { init, parse } from 'cjs-module-lexer'
import { build } from 'tsdown'
import { renameRetryingWindowsLocks } from '../src/rename-retry.ts'

/** One dependency consolidation, with original module paths retained as CommonJS entry files. */
export interface SeedDependencyBundle {
  readonly name: string
  readonly modules: number
}

const PACKAGE_ROOTS: Readonly<Record<string, readonly string[]>> = {
  yaml: ['dist', 'util.js'],
  semver: ['index.js', 'classes', 'functions', 'internal', 'ranges'],
  '@mixmark-io/domino': ['lib'],
}

/** Reviewed ES module packages: pure JavaScript barrels whose deep paths must keep resolving. */
const ESM_PACKAGE_ROOTS: Readonly<Record<string, readonly string[]>> = {
  typebox: ['build'],
  '@sinclair/typebox': ['build/esm'],
}

/**
 * Decide whether one module id belongs to the package being consolidated.
 * @param id - module id the compiler reports.
 * @param roots - the package directory beside the path its symlinks resolve to.
 * @returns whether the module lives inside the package.
 */
function insidePackage(id: string, roots: readonly string[]): boolean {
  const path = id.replaceAll('\\', '/')
  return roots.some(root => path.startsWith(root.split(sep).join('/') + '/'))
}

/**
 * Consolidate one reviewed CommonJS package, preserving deep imports and Node's named-export detection.
 * The output replaces directory entries by rename, never writes through pnpm's hard links.
 * @param packageDir - package directory owned by the packaging transaction.
 * @param roots - reviewed CommonJS files or directories relative to the package.
 * @param scratchRoot - transaction-owned parent for temporary compiler output.
 * @returns the count of consolidated source modules.
 */
export async function bundleSeedPackage(packageDir: string, roots: readonly string[], scratchRoot: string): Promise<number> {
  const base = resolve(packageDir)
  const rootsInside = [base, await realpath(base)]
  const files: string[] = []
  const collect = async (path: string): Promise<void> => {
    const identity = await lstat(path)
    if (identity.isDirectory()) {
      for (const item of await readdir(path)) await collect(join(path, item))
    } else if (identity.isFile() && extname(path) === '.js') files.push(path)
    else if (!identity.isFile()) throw new Error(`desktop dependency bundle: unsupported entry ${path}`)
  }
  for (const root of roots) {
    const path = resolve(base, root)
    if (isAbsolute(root) || !path.startsWith(base + sep)) throw new Error(`desktop dependency bundle: invalid root ${root}`)
    await collect(path)
  }
  await init()
  const names = new Map<string, { exports: string[]; reexports: string[] }>()
  for (const path of files) {
    const source = await readFile(path, 'utf8')
    if (/\b__dirname\b|\b__filename\b|require\.resolve\s*\(/u.test(source)) {
      throw new Error(`desktop dependency bundle: package-relative execution in ${path}`)
    }
    names.set(path, parse(source))
  }
  const exportedNames = (path: string, visiting = new Set<string>()): Set<string> => {
    if (visiting.has(path)) return new Set()
    visiting.add(path)
    const info = names.get(path)
    if (info === undefined) throw new Error(`desktop dependency bundle: unreviewed re-export ${path}`)
    const result = new Set(info.exports)
    const require = createRequire(path)
    for (const specifier of info.reexports) {
      for (const name of exportedNames(require.resolve(specifier), visiting)) result.add(name)
    }
    return result
  }
  const publicNames = new Map(files.map(path => [path, exportedNames(path)]))
  await mkdir(scratchRoot, { recursive: true })
  const scratch = await mkdtemp(join(scratchRoot, 'dependency-bundle-'))
  try {
    const entry: Record<string, string> = {}
    for (const [index, path] of files.entries()) {
      const wrapper = join(scratch, `${index}.mjs`)
      await writeFile(wrapper, `export { default } from ${JSON.stringify(path.split(sep).join('/'))}\n`)
      entry[relative(base, path).split(sep).join('/').slice(0, -3)] = wrapper
    }
    const manifest = JSON.parse(await readFile(join(base, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    const output = join(scratch, 'out')
    await build({
      config: false,
      cwd: base,
      entry,
      outDir: output,
      format: 'cjs',
      platform: 'node',
      target: 'es2024',
      fixedExtension: false,
      cjsDefault: false,
      dts: false,
      clean: false,
      logLevel: 'silent',
      deps: { neverBundle: Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies }) },
      outputOptions: {
        codeSplitting: { groups: [{ name: 'aeven-runtime', test: id => insidePackage(id, rootsInside) }] },
      },
    })
    for (const path of files) {
      const target = join(output, relative(base, path))
      const markers = [...publicNames.get(path)!].filter(name => name !== 'default' && name !== 'module.exports')
        .map(name => `exports[${JSON.stringify(name)}] = 0`).join(', ')
      // Node scans these assignments without executing them when an ESM consumer imports named CJS exports.
      await writeFile(target, `${await readFile(target, 'utf8')}\nmodule.exports = exports.default;\n${markers === '' ? '' : `0 && (${markers});\n`}`)
    }
    const publish = async (dir: string): Promise<void> => {
      for (const item of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, item.name)
        if (item.isDirectory()) await publish(path)
        else {
          const target = join(base, relative(output, path))
          await mkdir(dirname(target), { recursive: true })
          await renameRetryingWindowsLocks(path, target)
        }
      }
    }
    await publish(output)
    return files.length
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

/**
 * Consolidate one reviewed ES module package into shared chunks, keeping every original module path as the
 * re-export facade the bundler emits for that entry, so deep imports and one shared module identity survive.
 * @param packageDir - package directory owned by the packaging transaction.
 * @param roots - reviewed ES module files or directories relative to the package.
 * @param scratchRoot - transaction-owned parent for temporary compiler output.
 * @returns the count of consolidated source modules.
 */
export async function bundleSeedEsmPackage(packageDir: string, roots: readonly string[], scratchRoot: string): Promise<number> {
  const base = resolve(packageDir)
  const rootsInside = [base, await realpath(base)]
  const files: string[] = []
  const collect = async (path: string): Promise<void> => {
    const identity = await lstat(path)
    if (identity.isDirectory()) {
      for (const item of await readdir(path)) await collect(join(path, item))
    } else if (identity.isFile() && ['.mjs', '.js'].includes(extname(path))) files.push(path)
    else if (!identity.isFile()) throw new Error(`desktop dependency bundle: unsupported entry ${path}`)
  }
  for (const root of roots) {
    const path = resolve(base, root)
    if (isAbsolute(root) || !path.startsWith(base + sep)) throw new Error(`desktop dependency bundle: invalid root ${root}`)
    await collect(path)
  }
  for (const path of files) {
    const source = await readFile(path, 'utf8')
    if (/\bimport\.meta\b|\bcreateRequire\s*\(|\brequire\s*\(/u.test(source)) {
      throw new Error(`desktop dependency bundle: package-relative execution in ${path}`)
    }
  }
  await mkdir(scratchRoot, { recursive: true })
  const scratch = await mkdtemp(join(scratchRoot, 'dependency-bundle-'))
  try {
    const entry: Record<string, string> = {}
    for (const path of files) {
      entry[relative(base, path).split(sep).join('/').replace(/\.m?js$/u, '')] = path
    }
    const manifest = JSON.parse(await readFile(join(base, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    const output = join(scratch, 'out')
    await build({
      config: false,
      cwd: base,
      entry,
      outDir: output,
      format: 'esm',
      platform: 'node',
      target: 'es2024',
      fixedExtension: false,
      dts: false,
      clean: false,
      logLevel: 'silent',
      deps: { neverBundle: Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies }) },
      outputOptions: {
        codeSplitting: { groups: [{ name: 'aeven-runtime', test: id => insidePackage(id, rootsInside) }] },
      },
    })
    const renamed = new Map<string, string>()
    const publish = async (dir: string): Promise<void> => {
      for (const item of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, item.name)
        if (item.isDirectory()) await publish(path)
        else {
          // The compiler names every entry `.js`; a source module keeps its own extension.
          const emitted = join(base, relative(output, path))
          const module = emitted.replace(/\.js$/u, '.mjs')
          const target = existsSync(module) ? module : emitted
          await mkdir(dirname(target), { recursive: true })
          await renameRetryingWindowsLocks(path, target)
          renamed.set(emitted, target)
        }
      }
    }
    await publish(output)
    // A module published under its source extension leaves every facade naming the
    // emitted `.js` path, so those specifiers follow the rename within their directory.
    const republished = [...renamed].filter(([emitted, target]) => emitted !== target)
    for (const file of renamed.values()) {
      const ext = extname(file)
      if (ext !== '.js' && ext !== '.mjs') continue
      let source = await readFile(file, 'utf8')
      for (const [emitted, target] of republished) {
        if (dirname(emitted) !== dirname(file)) continue
        source = source.split(`./${relative(dirname(emitted), emitted)}`)
          .join(`./${relative(dirname(target), target)}`)
      }
      await writeFile(file, source)
    }
    return files.length
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

/**
 * Consolidate reviewed dependencies in a Windows hoisted seed before its layout is hashed.
 * @param modulesRoot - installed node_modules owned by seed preparation.
 * @param scratchRoot - transaction-owned compiler scratch parent.
 * @returns the package names and consolidated module counts.
 */
export async function bundleSeedDependencies(modulesRoot: string, scratchRoot: string): Promise<SeedDependencyBundle[]> {
  const result: SeedDependencyBundle[] = []
  const visit = async (modules: string): Promise<void> => {
    const packages: string[] = []
    for (const item of await readdir(modules, { withFileTypes: true })) {
      if (!item.isDirectory() || item.name.startsWith('.')) continue
      const dir = join(modules, item.name)
      if (item.name.startsWith('@')) {
        for (const child of await readdir(dir, { withFileTypes: true })) if (child.isDirectory()) packages.push(join(dir, child.name))
      } else packages.push(dir)
    }
    for (const dir of packages) {
      const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { name: string; main?: string; type?: string }
      const esmRoots = ESM_PACKAGE_ROOTS[manifest.name]
      const roots = PACKAGE_ROOTS[manifest.name]
        ?? (manifest.name.startsWith('@opentelemetry/') && manifest.name !== '@opentelemetry/resources'
          && manifest.main?.replace(/^\.\//u, '').startsWith('build/src/') ? ['build/src'] : undefined)
      if (esmRoots !== undefined && manifest.type === 'module') {
        result.push({ name: manifest.name, modules: await bundleSeedEsmPackage(dir, esmRoots, scratchRoot) })
      } else if (roots !== undefined && manifest.type !== 'module') {
        result.push({ name: manifest.name, modules: await bundleSeedPackage(dir, roots, scratchRoot) })
      }
      const nested = join(dir, 'node_modules')
      try {
        const identity = await lstat(nested)
        if (identity.isDirectory()) await visit(nested)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
  await visit(modulesRoot)
  return result
}
