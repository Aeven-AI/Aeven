import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Packr } from 'msgpackr'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isUnloadedSeedFile,
  pruneSeedStore,
  type SeedStorePackageRule,
} from '../scripts/seed-store-prune.ts'

const temporaryRoots: string[] = []
const packr = new Packr({ moreTypes: true, useRecords: true })
const MAC_ARM64 = { platform: 'darwin', arch: 'arm64' } as const

interface FixtureFile {
  readonly path: string
  readonly body: string
  readonly executable?: boolean
}

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'avn-desktop-seed-prune-test-'))
  temporaryRoots.push(root)
  return root
}

function casPath(store: string, digest: string, executable: boolean): string {
  return join(store, 'v11', 'files', digest.slice(0, 2), `${digest.slice(2)}${executable ? '-exec' : ''}`)
}

function createStore(packages: Readonly<Record<string, readonly FixtureFile[]>>): string {
  const store = temporaryRoot()
  mkdirSync(join(store, 'v11', 'files'), { recursive: true })
  const database = new DatabaseSync(join(store, 'v11', 'index.db'))
  database.exec('CREATE TABLE package_index (key TEXT PRIMARY KEY, data BLOB NOT NULL) WITHOUT ROWID')
  const insert = database.prepare('INSERT INTO package_index (key, data) VALUES (?, ?)')
  for (const [id, files] of Object.entries(packages)) {
    const records = new Map<string, { checkedAt: number; digest: string; mode: number; size: number }>()
    for (const file of files) {
      const body = Buffer.from(file.body)
      const digest = createHash('sha512').update(body).digest('hex')
      const executable = file.executable === true
      const path = casPath(store, digest, executable)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, body)
      records.set(file.path, { checkedAt: 1, digest, mode: executable ? 0o755 : 0o644, size: body.length })
    }
    insert.run(`sha512-${id}\t${id}`, packr.pack({ algo: 'sha512', files: records }))
  }
  database.close()
  return store
}

function indexedPaths(store: string): Record<string, string[]> {
  const database = new DatabaseSync(join(store, 'v11', 'index.db'), { readOnly: true })
  const result: Record<string, string[]> = {}
  for (const row of database.prepare('SELECT key, data FROM package_index').iterate() as Iterable<{ key: string; data: Uint8Array }>) {
    const record = packr.unpack(row.data) as { files: Map<string, unknown> }
    result[row.key.split('\t')[1] as string] = [...record.files.keys()].sort()
  }
  database.close()
  return result
}

function objectCount(store: string): number {
  const root = join(store, 'v11', 'files')
  return readdirSync(root).reduce((count, directory) => count + readdirSync(join(root, directory)).length, 0)
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('desktop seed store pruning', () => {
  it('classifies files the Desktop runtime never loads', () => {
    for (const path of ['index.d.ts', 'lib/a.d.mts', 'src/a.ts', 'src/b.tsx', 'dist/a.js.map', 'README.md', 'docs/CHANGELOG.md', 'README.zh-CN.md', 'win/a.pdb', 'prebuilds/win32-x64/pty.node', 'prebuilds/darwin-x64/pty.node']) {
      expect(isUnloadedSeedFile(path, MAC_ARM64), path).toBe(true)
    }
    for (const path of ['package.json', 'LICENSE', 'LICENSE.md', 'index.js', 'lib/a.mjs', 'data.json', 'docs/guide.md', 'core.wasm', 'prebuilds/darwin-arm64/pty.node']) {
      expect(isUnloadedSeedFile(path, MAC_ARM64), path).toBe(false)
    }
  })

  it('rewrites third-party index records, keeps first-party packages, and deletes unreferenced content', () => {
    const shared = 'shared body'
    const store = createStore({
      'native@1.0.0': [
        { path: 'package.json', body: '{"name":"native"}' },
        { path: 'index.js', body: shared },
        { path: 'index.d.ts', body: 'declare const x: 1' },
        { path: 'index.js.map', body: shared },
        { path: 'prebuilds/darwin-arm64/pty.node', body: 'mac arm', executable: true },
        { path: 'prebuilds/win32-x64/pty.node', body: 'win x64' },
        { path: 'vendor/unused.js', body: 'unused' },
      ],
      'file:desktop-packages/first-party-1.0.0.tgz': [
        { path: 'package.json', body: '{"name":"first-party"}' },
        { path: 'README.md', body: 'first-party docs' },
        { path: 'lib/index.d.ts', body: 'first-party types' },
      ],
    })
    const rules: SeedStorePackageRule[] = [{
      name: 'native',
      version: '1.0.0',
      reason: 'test',
      remove: target => target.platform === 'win32' ? [] : ['vendor/'],
    }]

    const result = pruneSeedStore(store, MAC_ARM64, rules)

    expect(indexedPaths(store)).toEqual({
      'native@1.0.0': ['index.js', 'package.json', 'prebuilds/darwin-arm64/pty.node'],
      'file:desktop-packages/first-party-1.0.0.tgz': ['README.md', 'lib/index.d.ts', 'package.json'],
    })
    expect(result).toEqual({
      removedFiles: 4,
      removedBytes: 'declare const x: 1'.length + shared.length + 'win x64'.length + 'unused'.length,
      deletedObjects: 3,
      updatedIndexRows: 1,
    })
    expect(objectCount(store)).toBe(6)
    const sharedDigest = createHash('sha512').update(shared).digest('hex')
    expect(existsSync(casPath(store, sharedDigest, false))).toBe(true)
  })

  it('fails before changing the store when a pinned rule removes nothing', () => {
    const store = createStore({ 'native@2.0.0': [{ path: 'package.json', body: '{}' }, { path: 'index.d.ts', body: 'x' }] })
    const before = indexedPaths(store)

    expect(() => pruneSeedStore(store, MAC_ARM64, [{
      name: 'native',
      version: '1.0.0',
      reason: 'test',
      remove: () => ['vendor/'],
    }])).toThrow(/native@1\.0\.0; review them/u)
    expect(indexedPaths(store)).toEqual(before)
    expect(objectCount(store)).toBe(2)
  })
})
