import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { link, readFile } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { createSeedProfileLayout, installSeedProfileLayout, SEED_PROFILE_LAYOUT } from '../src/seed-profile.ts'
import { archivePnpmStore, extractPnpmStoreArchives } from '../src/seed-store.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, link: vi.fn(actual.link), readFile: vi.fn(actual.readFile) }
})

const roots: string[] = []

function fixture(): { seed: string; store: string; modules: string; staging: string; active: string } {
  const root = mkdtempSync(join(tmpdir(), 'avn-seed-profile-'))
  roots.push(root)
  const seed = join(root, 'seed')
  const store = join(root, 'store')
  const modules = join(root, 'build', 'node_modules')
  const staging = join(root, 'staging')
  const active = join(root, 'active')
  for (const directory of [seed, store, modules, staging]) mkdirSync(directory, { recursive: true })
  writeFileSync(join(modules, '.modules.yaml'), JSON.stringify({
    nodeLinker: 'hoisted', storeDir: join(store, 'v11'), virtualStoreDir: join(modules, '.pnpm'), pendingBuilds: [],
  }))
  writeFileSync(join(modules, '.pnpm-workspace-state-v1.json'), '{"projects":{"build-host":{}}}')
  for (const path of ['pkg/native.node', 'pkg/package.json', '.bin/pkg.cmd', 'nested/pkg/duplicate']) {
    mkdirSync(dirname(join(modules, path)), { recursive: true })
    writeFileSync(join(modules, path), path.endsWith('duplicate') ? 'pkg/native.node' : path)
  }
  return { seed, store, modules, staging, active }
}

afterEach(() => {
  vi.mocked(readFile).mockReset()
  vi.mocked(link).mockReset()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('links freshly extracted seed objects without reading and hashing them again', async () => {
  const { seed, store, modules, staging, active } = fixture()
  await createSeedProfileLayout(seed, store, modules, process.arch)
  archivePnpmStore(seed, store)
  const extracted = await extractPnpmStoreArchives(seed, store)
  vi.mocked(readFile).mockRejectedValue(new Error('unexpected second content read'))
  await installSeedProfileLayout(seed, store, staging, active, extracted)
  expect(readFileSync(join(staging, 'node_modules', 'pkg/native.node'), 'utf8')).toBe('pkg/native.node')
})

it('copies a store object the filesystem will not link again', async () => {
  const { seed, store, modules, staging, active } = fixture()
  await createSeedProfileLayout(seed, store, modules, process.arch)
  vi.mocked(link).mockRejectedValue(Object.assign(new Error('too many links'), { code: 'EMLINK' }))
  await installSeedProfileLayout(seed, store, staging, active)
  const installed = join(staging, 'node_modules', 'pkg/native.node')
  expect(readFileSync(installed, 'utf8')).toBe('pkg/native.node')
  expect(statSync(installed).nlink).toBe(1)
})

it('recreates the tested package layout with deduplicated hard links and relocated pnpm metadata', async () => {
  const { seed, store, modules, staging, active } = fixture()
  await createSeedProfileLayout(seed, store, modules, process.arch)
  await installSeedProfileLayout(seed, store, staging, active)
  const installed = join(staging, 'node_modules')
  expect(readFileSync(join(installed, 'pkg/native.node'), 'utf8')).toBe('pkg/native.node')
  expect(readFileSync(join(installed, '.bin/pkg.cmd'), 'utf8')).toBe('.bin/pkg.cmd')
  expect(statSync(join(installed, 'pkg/native.node')).ino).toBe(statSync(join(installed, 'nested/pkg/duplicate')).ino)
  expect(statSync(join(installed, 'pkg/native.node')).nlink).toBe(3)
  const metadata = JSON.parse(readFileSync(join(installed, '.modules.yaml'), 'utf8')) as Record<string, unknown>
  expect(metadata.storeDir).toBe(join(store, 'v11'))
  expect(metadata.virtualStoreDir).toBe(join(active, 'node_modules', '.pnpm'))
  expect(metadata.pendingBuilds).toEqual([])
  expect(existsSync(join(installed, '.pnpm-workspace-state-v1.json'))).toBe(false)
  expect(readFileSync(join(modules, '.modules.yaml'), 'utf8')).toContain('build')
  await expect(installSeedProfileLayout(seed, store, staging, active)).rejects.toThrow()
})

it.each(['../escape', 'C:/escape', 'pkg\\escape', 'pkg/..', 'pkg/file.'])('rejects an unsafe layout path %s before creating node_modules', async (path) => {
  const { seed, store, modules, staging, active } = fixture()
  await createSeedProfileLayout(seed, store, modules, process.arch)
  const descriptor = join(seed, SEED_PROFILE_LAYOUT)
  const layout = JSON.parse(readFileSync(descriptor, 'utf8')) as { files: { path: string }[] }
  layout.files[0]!.path = path
  writeFileSync(descriptor, JSON.stringify(layout))
  await expect(installSeedProfileLayout(seed, store, staging, active)).rejects.toThrow(/invalid file/u)
  expect(existsSync(join(staging, 'node_modules'))).toBe(false)
})

it('rejects an architecture mismatch before creating node_modules', async () => {
  const { seed, store, modules, staging, active } = fixture()
  await createSeedProfileLayout(seed, store, modules, process.arch === 'arm64' ? 'x64' : 'arm64')
  await expect(installSeedProfileLayout(seed, store, staging, active)).rejects.toThrow(/architecture/u)
  expect(existsSync(join(staging, 'node_modules'))).toBe(false)
})

it('refuses a package layout whose store content is missing', async () => {
  const { seed, store, modules, staging, active } = fixture()
  await createSeedProfileLayout(seed, store, modules, process.arch)
  rmSync(join(store, 'v11'), { recursive: true })
  await expect(installSeedProfileLayout(seed, store, staging, active)).rejects.toThrow()
  expect(existsSync(join(staging, 'node_modules', '.modules.yaml'))).toBe(false)
})

it('rejects same-size corrupted content reused from the writable store', async () => {
  const { seed, store, modules, staging, active } = fixture()
  await createSeedProfileLayout(seed, store, modules, process.arch)
  const layout = JSON.parse(readFileSync(join(seed, SEED_PROFILE_LAYOUT), 'utf8')) as { files: { content: string }[] }
  const content = join(store, layout.files[0]!.content)
  writeFileSync(content, Buffer.alloc(statSync(content).size, 0))
  await expect(installSeedProfileLayout(seed, store, staging, active)).rejects.toThrow(/corrupt store content/u)
  expect(existsSync(join(staging, 'node_modules', '.modules.yaml'))).toBe(false)
})
