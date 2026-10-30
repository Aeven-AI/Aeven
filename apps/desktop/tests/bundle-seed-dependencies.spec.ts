import { execFile } from 'node:child_process'
import { cp, link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { bundleSeedDependencies, bundleSeedPackage } from '../scripts/bundle-seed-dependencies.ts'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const execute = promisify(execFile)

async function exercisePackage(ownerPath: string, name: string, roots: readonly string[], checks: string): Promise<void> {
  const owner = join(repo, ownerPath)
  const cache = join(owner, 'node_modules/.cache')
  await mkdir(cache, { recursive: true })
  const root = await mkdtemp(join(cache, 'seed-dependency-'))
  try {
    const require = createRequire(join(owner, 'package.json'))
    const original = dirname(require.resolve(`${name}/package.json`))
    const target = join(root, 'node_modules', name)
    await cp(original, target, { recursive: true, dereference: true })
    const script = join(root, 'check.mjs')
    await writeFile(script, `
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const library = require(${JSON.stringify(name)})
const namespace = await import(${JSON.stringify(name)})
${checks}
console.log(JSON.stringify({ names: Object.keys(namespace).sort(), modules: Object.keys(require.cache).filter(path => path.includes('seed-dependency-')).length }))
`)
    const run = async (): Promise<{ names: string[]; modules: number }> =>
      JSON.parse((await execute(process.execPath, [script], { timeout: 30_000 })).stdout) as { names: string[]; modules: number }
    const before = await run()
    const modules = await bundleSeedPackage(target, roots, join(root, 'scratch'))
    expect(modules).toBeGreaterThan(1)
    // A fresh Node process observes the artifact rather than a cached copy of the original modules.
    const after = await run()
    expect(after.names).toEqual(before.names)
    expect(after.modules).toBeLessThan(before.modules / 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

it('preserves YAML values, named exports, and class identity across deep imports', async () => {
  await exercisePackage('packages/settings/settings-file', 'yaml', ['dist', 'util.js'], `
assert.deepEqual(library.parse('enabled: true\\nitems: [one, two]'), { enabled: true, items: ['one', 'two'] })
assert.equal(namespace.parse, library.parse)
const { Document } = require(require.resolve('yaml').replace(/index\\.js$/, 'doc/Document.js'))
assert.equal(library.Document, Document)
assert.ok(library.parseDocument('a: 1') instanceof Document)
assert.throws(() => library.parse('items: ['), library.YAMLParseError)
const util = require('yaml/util')
assert.equal(util.mapTag.nodeClass, library.YAMLMap)
`)
})

it('preserves OTel log exports and keeps its external public APIs shared', async () => {
  await exercisePackage('packages/session/session-telemetry-otel', '@opentelemetry/sdk-logs', ['build/src'], `
assert.equal(namespace.LoggerProvider, library.LoggerProvider)
const exporter = new library.InMemoryLogRecordExporter()
const provider = new library.LoggerProvider({ processors: [new library.SimpleLogRecordProcessor({ exporter })] })
try {
  provider.getLogger('bundle-smoke').emit({ body: 'recorded', severityNumber: 9 })
  await provider.forceFlush()
  const records = exporter.getFinishedLogRecords()
  assert.equal(records.length, 1)
  assert.equal(records[0].body, 'recorded')
} finally { await provider.shutdown() }
`)
})

it('replaces hard-linked entries without changing their store objects', async () => {
  const cache = join(repo, 'node_modules/.cache')
  await mkdir(cache, { recursive: true })
  const root = await mkdtemp(join(cache, 'seed-hardlink-'))
  try {
    const dir = join(root, 'package')
    await mkdir(dir)
    await writeFile(join(dir, 'package.json'), '{"name":"fixture","type":"commonjs"}\n')
    const source = "exports.value = require('./value.js').value\n"
    const store = join(root, 'store-object')
    await writeFile(store, source)
    await link(store, join(dir, 'index.js'))
    await writeFile(join(dir, 'value.js'), 'exports.value = 42\n')
    expect(await bundleSeedPackage(dir, ['index.js', 'value.js'], join(root, 'scratch'))).toBe(2)
    expect(await readFile(store, 'utf8')).toBe(source)
    const script = join(root, 'check.cjs')
    await writeFile(script, "require('node:assert/strict').equal(require('./package/index.js').value, 42)\n")
    await execute(process.execPath, [script], { timeout: 30_000 })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects package-relative execution before replacing files', async () => {
  const cache = join(repo, 'node_modules/.cache')
  await mkdir(cache, { recursive: true })
  const root = await mkdtemp(join(cache, 'seed-relative-'))
  try {
    const source = 'exports.path = __dirname\n'
    await writeFile(join(root, 'index.js'), source)
    await expect(bundleSeedPackage(root, ['index.js'], join(root, 'scratch'))).rejects.toThrow('package-relative execution')
    expect(await readFile(join(root, 'index.js'), 'utf8')).toBe(source)
    await expect(bundleSeedPackage(root, ['../outside.js'], join(root, 'scratch'))).rejects.toThrow('invalid root')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('discovers reviewed dependencies without bundling unrelated packages', async () => {
  const cache = join(repo, 'node_modules/.cache')
  await mkdir(cache, { recursive: true })
  const root = await mkdtemp(join(cache, 'seed-discovery-'))
  try {
    const modules = join(root, 'node_modules')
    const yaml = join(modules, 'yaml')
    await mkdir(join(yaml, 'dist'), { recursive: true })
    await writeFile(join(yaml, 'package.json'), '{"name":"yaml","type":"commonjs"}\n')
    await writeFile(join(yaml, 'dist/index.js'), 'exports.value = 1\n')
    await writeFile(join(yaml, 'util.js'), "module.exports = require('./dist/index.js')\n")
    const other = join(modules, 'other')
    await mkdir(other)
    await writeFile(join(other, 'package.json'), '{"name":"other"}\n')
    const source = 'exports.path = __dirname\n'
    await writeFile(join(other, 'index.js'), source)
    expect(await bundleSeedDependencies(modules, join(root, 'scratch'))).toEqual([{ name: 'yaml', modules: 2 }])
    expect(await readFile(join(other, 'index.js'), 'utf8')).toBe(source)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
