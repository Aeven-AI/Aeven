import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bundleIdentifier,
  clearUpdateResidue,
  stagedVersion,
  updateCacheRoot,
  updaterCacheDir,
} from '../src/update-residue.ts'

const roots: string[] = []

/** One application's updater caches, laid out the way the updater and Squirrel leave them. */
async function bench(): Promise<{ root: string; cacheDir: string; shipItDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'avn-update-residue-'))
  roots.push(root)
  const cacheDir = join(root, 'desktop-updater')
  const shipItDir = join(root, 'com.example.app.ShipIt')
  await mkdir(cacheDir, { recursive: true })
  return { root, cacheDir, shipItDir }
}

/** Stage one downloaded release and its differential baseline, as electron-updater does. */
async function stage(cacheDir: string, fileName: string): Promise<void> {
  const pending = join(cacheDir, 'pending')
  await mkdir(pending, { recursive: true })
  await writeFile(join(pending, fileName), 'zip')
  await writeFile(join(pending, 'update-info.json'), JSON.stringify({ fileName, sha512: 'x' }))
  await writeFile(join(cacheDir, 'update.zip'), 'zip')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('desktop update residue', () => {
  it('clears the download and Squirrel state a completed install left behind', async () => {
    const { cacheDir, shipItDir } = await bench()
    await stage(cacheDir, 'aeven-0.3.6-alpha-mac-arm64.zip')
    await mkdir(shipItDir, { recursive: true })
    await writeFile(join(shipItDir, 'ShipItState.plist'), 'state')

    const removed = await clearUpdateResidue({ cacheDir, shipItDir, installedVersion: '0.3.6-alpha' })

    expect(existsSync(join(cacheDir, 'pending'))).toBe(false)
    expect(existsSync(join(cacheDir, 'update.zip'))).toBe(false)
    expect(existsSync(join(shipItDir, 'ShipItState.plist'))).toBe(false)
    expect(removed).toEqual([
      join(cacheDir, 'pending'),
      join(cacheDir, 'update.zip'),
      join(shipItDir, 'ShipItState.plist'),
    ])
  })

  it('keeps the baseline and Squirrel state while a newer release is still staged', async () => {
    const { cacheDir, shipItDir } = await bench()
    await stage(cacheDir, 'aeven-0.3.7-alpha-mac-arm64.zip')
    await mkdir(join(shipItDir, 'update.G43KcKW'), { recursive: true })
    await writeFile(join(shipItDir, 'ShipItState.plist'), 'state')

    await clearUpdateResidue({ cacheDir, shipItDir, installedVersion: '0.3.6-alpha' })

    // The staged download belongs to this session's check, not to a finished install.
    expect(existsSync(join(cacheDir, 'pending'))).toBe(false)
    expect(existsSync(join(cacheDir, 'update.zip'))).toBe(true)
    expect(existsSync(join(shipItDir, 'ShipItState.plist'))).toBe(true)
  })

  it('touches nothing when the application has no updater cache yet', async () => {
    const root = await mkdtemp(join(tmpdir(), 'avn-update-residue-'))
    roots.push(root)
    const cacheDir = join(root, 'never-downloaded')

    await expect(clearUpdateResidue({ cacheDir, installedVersion: '1.0.0' })).resolves.toEqual([])
    expect(existsSync(cacheDir)).toBe(false)
  })

  it('names the release an update artifact carries', async () => {
    expect(stagedVersion('aeven-0.3.6-alpha-mac-arm64.zip')).toBe('0.3.6-alpha')
    expect(stagedVersion('aeven-1.2.3-win-x64.exe')).toBe('1.2.3')
    expect(stagedVersion('aeven-1.2.3-linux-arm64.AppImage')).toBe('1.2.3')
    expect(stagedVersion('aeven-1.2.3-mac-arm64-unsigned.zip')).toBe('1.2.3')
    expect(stagedVersion('aeven-latest-mac-arm64.zip')).toBeUndefined()
    expect(stagedVersion('notes.txt')).toBeUndefined()
  })

  it('reads the updater cache directory the packaged configuration names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'avn-update-residue-'))
    roots.push(root)
    const resources = join(root, 'Aeven.app', 'Contents', 'Resources')
    await mkdir(resources, { recursive: true })
    await writeFile(join(resources, 'app-update.yml'), "provider: github\nupdaterCacheDirName: '@aevendesktop-updater'\n")

    expect(updaterCacheDir(resources, join(root, 'Caches'))).toBe(join(root, 'Caches', '@aevendesktop-updater'))
    expect(updaterCacheDir(join(root, 'missing'), join(root, 'Caches'))).toBeUndefined()
    await writeFile(join(resources, 'app-update.yml'), 'provider: github\n')
    expect(updaterCacheDir(resources, join(root, 'Caches'))).toBeUndefined()
  })

  it('reads the bundle identifier Squirrel names its cache after', async () => {
    const plist = '<plist><dict><key>CFBundleIdentifier</key><string>com.aeven.desktop</string></dict></plist>'
    expect(bundleIdentifier(plist)).toBe('com.aeven.desktop')
    expect(bundleIdentifier('<plist><dict></dict></plist>')).toBeUndefined()
  })

  it('derives the cache root the updater uses on each platform', () => {
    expect(updateCacheRoot('darwin', {})).toMatch(/\/Library\/Caches$/u)
    expect(updateCacheRoot('win32', { LOCALAPPDATA: 'C:\\Local' })).toBe('C:\\Local')
    expect(updateCacheRoot('linux', { XDG_CACHE_HOME: '/var/cache/reader' })).toBe('/var/cache/reader')
    expect(updateCacheRoot('linux', {})).toMatch(/\/\.cache$/u)
  })

  it('leaves Squirrel state alone when its staged bundle is still there', async () => {
    const { cacheDir, shipItDir } = await bench()
    await mkdir(join(shipItDir, 'update.G43KcKW', 'Aeven.app'), { recursive: true })
    await writeFile(join(shipItDir, 'ShipItState.plist'), 'state')

    await expect(clearUpdateResidue({ cacheDir, shipItDir, installedVersion: '1.0.0' })).resolves.toEqual([])
    expect(await readdir(shipItDir)).toContain('ShipItState.plist')
  })

  it('survives a staged descriptor it cannot read', async () => {
    const { cacheDir } = await bench()
    await mkdir(join(cacheDir, 'pending'), { recursive: true })
    await writeFile(join(cacheDir, 'pending', 'update-info.json'), 'not json')
    await writeFile(join(cacheDir, 'update.zip'), 'zip')

    const removed = await clearUpdateResidue({ cacheDir, installedVersion: '1.0.0' })

    expect(removed).toEqual([join(cacheDir, 'pending')])
    expect(await readFile(join(cacheDir, 'update.zip'), 'utf8')).toBe('zip')
  })
})
