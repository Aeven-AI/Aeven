import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { bundleSeedEsmPackage } from '../scripts/bundle-seed-dependencies.ts'

const execute = promisify(execFile)

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'seed-esm-dependency-'))
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, 'node_modules', 'sample', path, '..'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'sample', path), content)
  }
  return root
}

const SAMPLE = {
  'package.json': JSON.stringify({ name: 'sample', type: 'module', exports: { '.': './build/index.mjs' } }),
  'build/errors.mjs': 'export class SampleError extends Error {}\nexport const label = (value) => `sample:${value}`\n',
  'build/check.mjs': 'import { SampleError, label } from "./errors.mjs"\nexport function check(value) { if (value === undefined) throw new SampleError(label("missing")); return value }\n',
  'build/value.mjs': 'import { check } from "./check.mjs"\nexport function value(input) { return check(input) }\n',
  'build/index.mjs': 'export * from "./errors.mjs"\nexport * from "./check.mjs"\nexport * from "./value.mjs"\n',
}

/** Import the fixture entry, reporting how many modules Node loaded for it and what it does. */
function probe(path: string): Promise<{ loads: number; className: string; value: unknown }> {
  return execute(process.execPath, ['--input-type=module', '-e', `
let loads = 0
const { registerHooks } = await import('node:module')
registerHooks({ load(url, context, nextLoad) { loads += 1; return nextLoad(url, context) } })
const root = await import(${JSON.stringify(path)})
console.log(JSON.stringify({ loads, className: root.SampleError.name, value: root.value('input') }))
`], { timeout: 30_000 }).then(result => JSON.parse(result.stdout) as { loads: number; className: string; value: unknown })
}

it('consolidates an ES module barrel into a shared chunk behind every original path', async () => {
  const root = await fixture(SAMPLE)
  try {
    const base = join(root, 'node_modules', 'sample')
    const entry = `file:///${join(base, 'build', 'index.mjs').replaceAll('\\', '/')}`
    const before = await probe(entry)
    expect(before).toEqual({ loads: 4, className: 'SampleError', value: 'input' })
    await expect(bundleSeedEsmPackage(base, ['build'], join(root, 'scratch'))).resolves.toBe(4)
    const after = await probe(entry)
    expect(after).toEqual({ loads: 2, className: 'SampleError', value: 'input' })
    // A deep import still resolves and shares the one chunk, so class identity survives.
    expect(await readFile(join(base, 'build', 'errors.mjs'), 'utf8')).toContain('export')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects an ES module package that resolves paths relative to its own execution', async () => {
  const root = await fixture({ ...SAMPLE, 'build/loader.mjs': 'export const here = import.meta.url\n' })
  try {
    await expect(bundleSeedEsmPackage(join(root, 'node_modules', 'sample'), ['build'], join(root, 'scratch')))
      .rejects.toThrow(/package-relative execution/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects a review root that escapes the package', async () => {
  const root = await fixture(SAMPLE)
  try {
    await expect(bundleSeedEsmPackage(join(root, 'node_modules', 'sample'), ['../elsewhere'], join(root, 'scratch')))
      .rejects.toThrow(/invalid root/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
