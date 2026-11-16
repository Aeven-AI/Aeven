import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Packr } from 'msgpackr'
import { afterEach, describe, expect, it } from 'vitest'
import { collectDesktopStore } from '../src/store-collect.ts'

const temporaryRoots: string[] = []
const packr = new Packr({ moreTypes: true, useRecords: true })

type FileRecord = { checkedAt: number; digest: string; mode: number; size: number }

interface FixturePackage {
  readonly integrity: string
  readonly id: string
  readonly files: Readonly<Record<string, string>>
  readonly sideEffect?: Readonly<Record<string, string>>
}

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'avn-desktop-store-collect-test-'))
  temporaryRoots.push(root)
  return root
}

function objectPath(store: string, body: string): string {
  const digest = createHash('sha512').update(body).digest('hex')
  return join(store, 'v11', 'files', digest.slice(0, 2), digest.slice(2))
}

function records(store: string, files: Readonly<Record<string, string>>): Map<string, FileRecord> {
  const result = new Map<string, FileRecord>()
  for (const [path, body] of Object.entries(files)) {
    const object = objectPath(store, body)
    mkdirSync(dirname(object), { recursive: true })
    writeFileSync(object, body)
    result.set(path, { checkedAt: 1, digest: createHash('sha512').update(body).digest('hex'), mode: 0o644, size: body.length })
  }
  return result
}

function createStore(packages: readonly FixturePackage[]): string {
  const store = temporaryRoot()
  mkdirSync(join(store, 'v11', 'files'), { recursive: true })
  const database = new DatabaseSync(join(store, 'v11', 'index.db'))
  database.exec('CREATE TABLE package_index (key TEXT PRIMARY KEY, data BLOB NOT NULL) WITHOUT ROWID')
  const insert = database.prepare('INSERT INTO package_index (key, data) VALUES (?, ?)')
  for (const fixture of packages) {
    const value = {
      algo: 'sha512',
      files: records(store, fixture.files),
      ...fixture.sideEffect === undefined ? {} : { sideEffects: new Map([['darwin-arm64', { added: records(store, fixture.sideEffect) }]]) },
    }
    insert.run(`${fixture.integrity}\t${fixture.id}`, packr.pack(value))
  }
  database.close()
  return store
}

function profileWithLockfile(lockfile: string | undefined): string {
  const profile = temporaryRoot()
  if (lockfile !== undefined) writeFileSync(join(profile, 'pnpm-lock.yaml'), lockfile)
  return profile
}

function indexedIds(store: string): string[] {
  const database = new DatabaseSync(join(store, 'v11', 'index.db'), { readOnly: true })
  const ids = (database.prepare('SELECT key FROM package_index').all() as { key: string }[]).map(row => row.key.split('\t')[1] as string)
  database.close()
  return ids.sort()
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('desktop store collection', () => {
  const packages: readonly FixturePackage[] = [
    { integrity: 'sha512-KeptA==', id: 'kept@1.0.0', files: { 'index.js': 'kept body', 'shared.js': 'shared body' }, sideEffect: { 'build/addon.node': 'built body' } },
    { integrity: 'sha512-Rollback/B+', id: 'file:desktop-packages/aeven-old-0.3.1-alpha.tgz', files: { 'index.js': 'rollback body' } },
    { integrity: 'sha512-Gone1', id: 'gone@2.0.0', files: { 'index.js': 'gone body', 'shared.js': 'shared body' } },
  ]

  it('keeps the packages a profile lockfile names with every file they use, and deletes the rest', async () => {
    const store = createStore(packages)
    const active = profileWithLockfile('packages:\n  kept@1.0.0:\n    resolution: {integrity: sha512-KeptA==}\n')
    const rollback = profileWithLockfile('packages:\n  aeven-old:\n    resolution:\n      integrity: sha512-Rollback/B+\n      tarball: file:desktop-packages/aeven-old-0.3.1-alpha.tgz\n')

    const result = await collectDesktopStore(store, [active, rollback, join(temporaryRoot(), 'prepared-missing')])

    expect(indexedIds(store)).toEqual(['file:desktop-packages/aeven-old-0.3.1-alpha.tgz', 'kept@1.0.0'])
    for (const body of ['kept body', 'shared body', 'built body', 'rollback body']) expect(existsSync(objectPath(store, body)), body).toBe(true)
    expect(existsSync(objectPath(store, 'gone body'))).toBe(false)
    expect(result).toEqual({ removedPackages: 1, deletedObjects: 1, freedBytes: 'gone body'.length })
  })

  it('changes nothing when an existing profile has no lockfile', async () => {
    const store = createStore(packages)
    const active = profileWithLockfile('packages:\n  kept@1.0.0:\n    resolution: {integrity: sha512-KeptA==}\n')

    const result = await collectDesktopStore(store, [active, profileWithLockfile(undefined)])

    expect(result).toBeUndefined()
    expect(indexedIds(store)).toHaveLength(3)
    expect(existsSync(objectPath(store, 'gone body'))).toBe(true)
  })
})
