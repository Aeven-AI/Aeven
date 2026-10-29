import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createSeedProfileLayout } from '../src/seed-profile.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDesktopPaths } from '../src/paths.ts'
import {
  createSeedMetadata,
  DESKTOP_DEPENDENCY_OVERRIDES,
  DesktopProjectManager,
  verifySeedIntegrity,
  type DesktopProjectHooks,
} from '../src/project-manager.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import { DESKTOP_PACKAGES_DIR, DESKTOP_PACKAGE_SET_FILE } from '../src/core-package-set.ts'
import type { DesktopRelease } from '../src/release.ts'
import { archivePnpmStore } from '../src/seed-store.ts'

const roots: string[] = []
const releaseWorkers: Array<() => Promise<void>> = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'avn-desktop-test-'))
  roots.push(root)
  return root
}

function writeIntegrity(seed: string): void {
  const paths: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.name !== 'integrity.json') paths.push(path)
    }
  }
  visit(seed)
  const files = paths.sort().map((path) => {
    const body = readFileSync(path)
    return {
      path: relative(seed, path).split(sep).join('/'),
      bytes: statSync(path).size,
      sha256: createHash('sha256').update(body).digest('hex'),
    }
  })
  writeFileSync(join(seed, 'integrity.json'), `${JSON.stringify({ schemaVersion: 2, files })}\n`)
}

function archiveStore(seed: string): void {
  const store = join(seed, 'store')
  mkdirSync(store, { recursive: true })
  if (readdirSync(store).length === 0) writeFileSync(join(store, 'test-entry'), 'content')
  archivePnpmStore(seed, store)
}

function writeCorePackageSet(seed: string, version: string): void {
  const packages = [
    { name: '@aeven/cli', file: `aeven-cli-${version}.tgz`, body: Buffer.from(`avn-${version}`) },
    {
      name: '@aeven/desktop-host',
      file: `aeven-desktop-host-${version}.tgz`,
      body: Buffer.from(`desktop-host-${version}`),
    },
  ]
  mkdirSync(join(seed, DESKTOP_PACKAGES_DIR), { recursive: true })
  for (const entry of packages) writeFileSync(join(seed, DESKTOP_PACKAGES_DIR, entry.file), entry.body)
  writeFileSync(join(seed, DESKTOP_PACKAGE_SET_FILE), `${JSON.stringify({
    schemaVersion: 1,
    packages: packages.map(({ name, file, body }) => ({
      name,
      version,
      file,
      bytes: body.byteLength,
      integrity: `sha512-${createHash('sha512').update(body).digest('base64')}`,
    })),
  })}\n`)
}

function createTestSeedMetadata(seed: string, desktopRelease: DesktopRelease): void {
  writeCorePackageSet(seed, desktopRelease.version)
  createSeedMetadata(seed, desktopRelease)
}

function writeFakePnpm(root: string): string {
  const path = join(root, 'pnpm.mjs')
  writeFileSync(path, String.raw`
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
const args = process.argv.slice(2)
const project = process.cwd()
const command = args.find(value => value === 'install' || value === 'add' || value === 'remove')
const manifestPath = join(project, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const packageName = spec => spec.startsWith('@')
  ? spec.slice(0, spec.indexOf('@', spec.indexOf('/') + 1) === -1 ? undefined : spec.indexOf('@', spec.indexOf('/') + 1))
  : spec.split('@')[0]
const packageVersion = spec => {
  const index = spec.startsWith('@') ? spec.indexOf('@', spec.indexOf('/') + 1) : spec.indexOf('@')
  return index === -1 ? '1.0.0' : spec.slice(index + 1)
}

if (command === 'add') {
  const spec = args[args.indexOf('add') + 1]
  manifest.dependencies[packageName(spec)] = packageVersion(spec)
}
if (command === 'remove') delete manifest.dependencies[args[args.indexOf('remove') + 1]]
writeFileSync(manifestPath, JSON.stringify(manifest))
rmSync(join(project, 'node_modules'), { recursive: true, force: true })
for (const [name, version] of Object.entries(manifest.dependencies)) {
  const packageRoot = join(project, 'node_modules', ...name.split('/'))
  mkdirSync(packageRoot, { recursive: true })
  const core = name === '@aeven/cli' || name === '@aeven/desktop-host'
  const plugin = !core
  const installedVersion = plugin
    ? version
    : JSON.parse(readFileSync(join(project, 'desktop-release.json'), 'utf8')).version
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name, version: installedVersion,
    ...(plugin ? { avn: { bundle: { patch: './bundle.yml' } } } : {}),
  }))
  if (plugin) writeFileSync(join(packageRoot, 'bundle.yml'), '[]\n')
  else if (name === '@aeven/desktop-host') {
    mkdirSync(join(packageRoot, 'lib'), { recursive: true })
    writeFileSync(join(packageRoot, 'lib', 'index.js'), '')
  }
}
writeFileSync(join(project, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
if (process.env.TEST_PNPM_LOG) writeFileSync(process.env.TEST_PNPM_LOG, JSON.stringify({ args, env: process.env }))
`)
  return path
}

function writeBlockingFakePnpm(root: string, ready: string, release: string): string {
  const path = join(root, 'blocking-pnpm.mjs')
  const delegate = writeFakePnpm(root)
  writeFileSync(path, `
import { existsSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
writeFileSync(${JSON.stringify(ready)}, String(process.pid))
while (!existsSync(${JSON.stringify(release)})) await sleep(10)
await import(${JSON.stringify(pathToFileURL(delegate).href)})
`)
  return path
}

function hooks(overrides: Partial<DesktopProjectHooks> = {}): DesktopProjectHooks {
  return {
    healthCheck: async () => {},
    beforeActivate: async () => {},
    afterActivate: async () => {},
    progress: () => {},
    ...overrides,
  }
}

function release(version = '1.0.0'): DesktopRelease {
  return {
    schemaVersion: 1,
    version,
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: '24.17.0',
    pnpmVersion: '11.7.0',
  }
}

afterEach(async () => {
  const cleanups = releaseWorkers.splice(0)
  const directories = roots.splice(0)
  const results = await Promise.allSettled(cleanups.map(cleanup => cleanup()))
  for (const root of directories) rmSync(root, { recursive: true, force: true })
  const failures: unknown[] = results.flatMap((result): unknown[] => result.status === 'rejected' ? [result.reason] : [])
  if (failures.length > 0) throw new AggregateError(failures, 'desktop worker cleanup failed')
})

describe('desktop package policy', () => {
  it('rejects any seed content changed after release inventory generation', async () => {
    const seed = join(temporaryRoot(), 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    writeIntegrity(seed)
    await expect(verifySeedIntegrity(seed)).resolves.toBeUndefined()
    writeFileSync(join(seed, 'package.json'), '{}\n')
    await expect(verifySeedIntegrity(seed)).rejects.toThrow(/integrity verification failed/u)
  })

  it('rewrites only dependency edges the workspace manifests declare', () => {
    const packagesRoot = join(import.meta.dirname, '..', '..', '..', 'packages')
    const manifest = (path: string): { dependencies?: Record<string, string> } =>
      JSON.parse(readFileSync(join(packagesRoot, path, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
    const workspaceParents: Record<string, string> = {
      '@aeven/client-ui-primitives': 'client/ui-primitives',
      '@aeven/client-ui-conversation': 'client/ui-conversation',
      '@aeven/client-ui-sidebar-terminal': 'client/ui-sidebar-terminal',
    }
    const removed = new Map<string, string[]>()
    for (const [selector, spec] of Object.entries(DESKTOP_DEPENDENCY_OVERRIDES)) {
      const [parent = '', child = ''] = selector.split('>')
      const path = workspaceParents[parent]
      if (path === undefined) continue
      expect(spec).toBe('-')
      expect(manifest(path).dependencies, selector).toHaveProperty([child])
      removed.set(parent, [...removed.get(parent) ?? [], child])
    }
    expect(removed.get('@aeven/client-ui-primitives')?.sort())
      .toEqual(Object.keys(manifest('client/ui-primitives').dependencies ?? {}).sort())
    expect(DESKTOP_DEPENDENCY_OVERRIDES['@huggingface/transformers>sharp'])
      .toBe(manifest('attachment/attachment-local').dependencies?.sharp)
    // Transformers.js pins onnxruntime-node to an exact release, so the override must name an exact release too;
    // 1.23.2 is the newest one that ships the darwin/x64 binding Intel macOS builds load.
    expect(DESKTOP_DEPENDENCY_OVERRIDES['@huggingface/transformers>onnxruntime-node']).toMatch(/^\d+\.\d+\.\d+$/u)
  })
})

describe('desktop project transactions', () => {
  it('undoes a first installation when the serving backend fails during activation', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.aeven'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    const failure = new Error('serving backend failed')
    await expect(manager.applyRelease(seed, '1.0.0', hooks({
      afterActivate: async () => {
        expect(manager.avnVersion()).toBe('1.0.0')
        throw failure
      },
    }))).rejects.toBe(failure)
    expect(existsSync(paths.profile)).toBe(false)
    expect(existsSync(paths.pending)).toBe(false)
    expect(existsSync(paths.rollback)).toBe(false)
  })

  it('activates a precomputed seed profile without launching pnpm', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    const modules = join(root, 'build', 'node_modules')
    mkdirSync(modules, { recursive: true })
    writeFileSync(join(modules, '.modules.yaml'), JSON.stringify({ nodeLinker: 'hoisted', storeDir: join(seed, 'store', 'v11') }))
    for (const name of ['cli', 'desktop-host']) {
      const directory = join(modules, '@aeven', name)
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: `@aeven/${name}`, version: '1.0.0' }))
    }
    await createSeedProfileLayout(seed, join(seed, 'store'), modules, process.arch)
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.aeven'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: join(root, 'must-not-run.mjs') })
    let checked = false
    await expect(manager.applyRelease(seed, '1.0.0', hooks({
      healthCheck: async (profile) => {
        expect(readFileSync(join(profile, 'node_modules', '@aeven', 'desktop-host', 'package.json'), 'utf8')).toContain('1.0.0')
        checked = true
      },
    }))).resolves.toBe(true)
    expect(checked).toBe(true)
    expect(manager.avnVersion()).toBe('1.0.0')
    await expect(manager.applyRelease(seed, '1.0.0', hooks())).resolves.toBe(false)
  })

  it('installs the offline seed and reconciles a mismatched private Host', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    const log = join(root, 'pnpm-log.json')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    mkdirSync(join(seed, 'store'), { recursive: true })
    writeFileSync(join(seed, 'store', 'seed-entry'), 'content')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.aeven'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    const previousLog = process.env.TEST_PNPM_LOG
    const previousRegistry = process.env.npm_config_registry
    process.env.TEST_PNPM_LOG = log
    process.env.npm_config_registry = 'https://user-registry.invalid'
    try {
      await expect(manager.applyRelease(seed, '2.0.0', hooks())).rejects.toThrow(/does not match Electron/u)
      await manager.applyRelease(seed, '1.0.0', hooks())
      writeFileSync(
        join(paths.profile, 'node_modules', '@aeven', 'desktop-host', 'package.json'),
        '{"name":"@aeven/desktop-host","version":"0.9.0"}\n',
      )
      await expect(manager.applyRelease(seed, '1.0.0', hooks())).resolves.toBe(true)
    } finally {
      if (previousLog === undefined) delete process.env.TEST_PNPM_LOG
      else process.env.TEST_PNPM_LOG = previousLog
      if (previousRegistry === undefined) delete process.env.npm_config_registry
      else process.env.npm_config_registry = previousRegistry
    }
    expect(manager.avnVersion()).toBe('1.0.0')
    expect(manager.releaseVersion()).toBe('1.0.0')
    expect(paths.profile).toBe(join(root, '.aeven', 'profiles', 'desktop'))
    expect(existsSync(join(paths.profile, 'node_modules', '@aeven', 'cli'))).toBe(true)
    const installedHost = JSON.parse(readFileSync(
      join(paths.profile, 'node_modules', '@aeven', 'desktop-host', 'package.json'),
      'utf8',
    )) as { version: string }
    expect(installedHost.version).toBe('1.0.0')
    expect(existsSync(join(paths.profile, 'desktop-plugins.json'))).toBe(false)
    expect(readFileSync(join(paths.pnpm.store, 'seed-entry'), 'utf8')).toBe('content')
    const invocation = JSON.parse(readFileSync(log, 'utf8')) as { args: string[]; env: Record<string, string> }
    expect(invocation.args).toContain('--offline')
    expect(invocation.args).toContain('--trust-lockfile')
    expect(invocation.args).toContain(`--config.store-dir=${paths.pnpm.store}`)
    expect(invocation.args).toContain('--config.enable-global-virtual-store=false')
    expect(invocation.args).toContain('--config.registry=https://registry.npmjs.org/')
    expect(invocation.env.NPM_CONFIG_REGISTRY).toBe('https://registry.npmjs.org/')
    expect(invocation.env.NPM_CONFIG_STORE_DIR).toBe(paths.pnpm.store)
    expect(invocation.env.NPM_CONFIG_USERCONFIG).toBe(join(paths.pnpm.config, 'npmrc'))
    expect(invocation.env.npm_config_registry).toBeUndefined()
  })

  it('keeps the active profile when the swap fails before moving it', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.aeven'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(seed, '1.0.0', hooks())
    const activeHost = join(paths.profile, 'node_modules', '@aeven', 'desktop-host', 'package.json')
    writeFileSync(activeHost, '{"name":"@aeven/desktop-host","version":"0.9.0"}\n')
    // A file where the rollback directory belongs fails the swap before the active profile moves.
    rmSync(join(paths.root, 'rollback'), { recursive: true, force: true })
    writeFileSync(join(paths.root, 'rollback'), 'blocks the rollback directory')

    await expect(manager.applyRelease(seed, '1.0.0', hooks())).rejects.toThrow()

    expect(readFileSync(activeHost, 'utf8')).toContain('"0.9.0"')
    expect(existsSync(paths.pending)).toBe(false)
  })

  it('records the live pnpm worker as transaction owner until it exits', async ({ task, signal }) => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    const ready = join(root, 'pnpm-ready')
    const releaseWorker = join(root, 'pnpm-release')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.aeven'))
    const runtime = { node: process.execPath, pnpm: writeBlockingFakePnpm(root, ready, releaseWorker) }
    const manager = new DesktopProjectManager(paths, runtime)
    const installing = manager.applyRelease(seed, '1.0.0', hooks())
    // Teardown observes failures even if the runner has abandoned the test body.
    const completed = installing.then(value => ({ value }), (error: unknown) => ({ error }))
    releaseWorkers.push(async () => {
      writeFileSync(releaseWorker, 'continue')
      const outcome = await completed
      if ('error' in outcome) throw outcome.error
    })
    // Child startup shares the test budget; an aborted poll must not resume ownership assertions.
    await expect.poll(() => {
      signal.throwIfAborted()
      return existsSync(ready)
    }, { timeout: task.timeout }).toBe(true)
    signal.throwIfAborted()
    const workerPid = Number.parseInt(readFileSync(ready, 'utf8'), 10)
    expect(readFileSync(paths.lock, 'utf8')).toBe(`${String(workerPid)}\n`)
    const competing = new DesktopProjectManager(paths, runtime)
    await expect(competing.applyRelease(seed, '1.0.0', hooks())).rejects.toThrow(/another package transaction is active/u)
    writeFileSync(releaseWorker, 'continue')
    await expect(installing).resolves.toBe(true)
    expect(existsSync(paths.lock)).toBe(false)
  })

  it('reconciles avn to the packaged release without removing desktop plugins', async () => {
    const root = temporaryRoot()
    const paths = resolveDesktopPaths(join(root, '.aeven'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    const firstSeed = join(root, 'seed-1')
    createTestSeedMetadata(firstSeed, release('1.0.0'))
    writeFileSync(join(firstSeed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    mkdirSync(join(firstSeed, 'store'), { recursive: true })
    writeFileSync(join(firstSeed, 'store', 'release-1'), 'one')
    archiveStore(firstSeed)
    writeIntegrity(firstSeed)
    await manager.applyRelease(firstSeed, '1.0.0', hooks())
    // An installed plugin is the profile manifest entry, the installed package
    // with its bundle patch, and the profile bundle list; seeding all three
    // stands in for the install itself, which no Desktop surface performs.
    const installed = JSON.parse(readFileSync(join(paths.profile, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      avn: { profile: { bundles: string[] } }
    }
    installed.dependencies['@scope/plugin'] = '2.0.0'
    installed.avn.profile.bundles = [...installed.avn.profile.bundles, '@scope/plugin']
    writeFileSync(join(paths.profile, 'package.json'), `${JSON.stringify(installed, undefined, 2)}\n`)
    mkdirSync(join(paths.profile, 'node_modules', '@scope', 'plugin'), { recursive: true })
    writeFileSync(
      join(paths.profile, 'node_modules', '@scope', 'plugin', 'package.json'),
      '{"name":"@scope/plugin","version":"2.0.0","avn":{"bundle":{"patch":"./bundle.yml"}}}\n',
    )
    writeFileSync(join(paths.profile, 'node_modules', '@scope', 'plugin', 'bundle.yml'), '[]\n')

    const nextSeed = join(root, 'seed-2')
    createTestSeedMetadata(nextSeed, release('1.1.0'))
    writeFileSync(join(nextSeed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    mkdirSync(join(nextSeed, 'store'), { recursive: true })
    writeFileSync(join(nextSeed, 'store', 'release-2'), 'two')
    archiveStore(nextSeed)
    writeIntegrity(nextSeed)

    await expect(manager.applyRelease(nextSeed, '1.1.0', hooks())).resolves.toBe(true)
    expect(manager.releaseVersion()).toBe('1.1.0')
    expect(manager.avnVersion()).toBe('1.1.0')
    const profile = JSON.parse(readFileSync(join(paths.profile, 'package.json'), 'utf8')) as {
      avn: { profile: { bundles: string[] } }
    }
    expect(profile.avn.profile.bundles).toEqual([
      '@aeven/base',
      '@aeven/web-app',
      '@scope/plugin',
    ])
    expect(readFileSync(join(paths.pnpm.store, 'release-1'), 'utf8')).toBe('one')
    expect(readFileSync(join(paths.pnpm.store, 'release-2'), 'utf8')).toBe('two')
    await expect(manager.applyRelease(nextSeed, '1.1.0', hooks())).resolves.toBe(false)
  })
})
