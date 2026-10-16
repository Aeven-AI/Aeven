/**
 * The bundle's computer-use rows: which desktop platforms mount the capability,
 * which driver path each one resolves, and which first-party batch provider each
 * platform adds beside it.
 *
 * These rows are the only place the Web and Electron compositions decide whether
 * computer use exists at all, and the Loader evaluates them per platform, so a
 * platform gated out here never reaches the provider.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { interpolate } from '@deepseek-ai/cordis-plugin-loader'
import { composeEntries, loadOverlayPatches } from '@aeven/app-boot'

const PATCH = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))

/** Every desktop platform these rows mount on. */
const DESKTOP_PLATFORMS = ['darwin', 'win32', 'linux'] as const

/** The Windows install location the driver row resolves, for one environment. */
const LOCALAPPDATA = 'C:\\Users\\aeven\\AppData\\Local'

/** One row after resolution: whether it mounts, and the driver it would spawn. */
interface ResolvedRow {
  disabled: boolean
  command?: unknown
}

let staged: string | undefined

afterEach(() => {
  if (staged !== undefined) rmSync(staged, { recursive: true, force: true })
  staged = undefined
})

/** Stage a driver executable the macOS semantic-batch row can find. */
function stagedDriver(): string {
  staged = mkdtempSync(join(tmpdir(), 'avn-cua-driver-'))
  const driver = join(staged, 'cua-driver')
  writeFileSync(driver, '')
  return driver
}

/**
 * Compose this bundle's computer-use rows and resolve them the way the Loader
 * does, against one platform and environment. The scope inherits the real
 * `process`, because these rows read `process.getBuiltinModule` beside
 * `process.platform` and `process.env`.
 * @param platform - the platform the `!!js` expressions read.
 * @param env - the environment those expressions read.
 * @returns the resolved rows by id.
 */
function rowsFor(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}): Map<string, ResolvedRow> {
  const scope = {
    // Defined as own properties: `process.platform` is a read-only accessor, so
    // assigning over it throws and the scope must shadow it instead.
    process: Object.create(process, {
      env: { value: { ...process.env, ...env }, enumerable: true },
      platform: { value: platform, enumerable: true },
    }) as NodeJS.Process,
  }
  const entries = composeEntries([loadOverlayPatches('computer-use rows', PATCH)])
  const rows = new Map<string, ResolvedRow>()
  for (const entry of entries) {
    if (entry.id === undefined || !entry.id.startsWith('computer-use')) continue
    // `entry.config` is the Loader's untyped patch config; only `command` is read.
    const config = (entry.config ?? {}) as { command?: unknown }
    const resolved = interpolate(scope, {
      disabled: entry.disabled ?? false,
      command: config.command,
    }) as { disabled: boolean; command?: unknown }
    const row: ResolvedRow = { disabled: resolved.disabled }
    if (resolved.command !== undefined) row.command = resolved.command
    rows.set(entry.id, row)
  }
  return rows
}

describe('web-app computer-use rows', () => {
  it.each(DESKTOP_PLATFORMS)('mounts the capability and its driver provider on %s', (platform) => {
    const rows = rowsFor(platform)
    expect(rows.get('computer-use')?.disabled).toBe(false)
    expect(rows.get('computer-use-cua-driver')?.disabled).toBe(false)
  })

  it('resolves the driver from each platform install location', () => {
    expect(rowsFor('darwin').get('computer-use-cua-driver')?.command)
      .toBe('/Applications/CuaDriver.app/Contents/MacOS/cua-driver')
    expect(rowsFor('win32', { LOCALAPPDATA }).get('computer-use-cua-driver')?.command)
      .toBe(`${LOCALAPPDATA}/Programs/Cua/cua-driver/bin/cua-driver.exe`)
    // Every arm is absolute, which is what keeps a missing driver on the
    // install-guidance path instead of a failed provider start.
    expect(rowsFor('linux').get('computer-use-cua-driver')?.command)
      .toBe(join(homedir(), '.local', 'bin', 'cua-driver'))
  })

  it.each(DESKTOP_PLATFORMS)('lets AVN_CUA_DRIVER override the driver path on %s', (platform) => {
    const override = '/opt/cua/bin/cua-driver'
    expect(rowsFor(platform, { AVN_CUA_DRIVER: override }).get('computer-use-cua-driver')?.command).toBe(override)
  })

  it('mounts the macOS semantic batches only on macOS with a driver present', () => {
    // The batches drive an installed driver directly, so they follow the driver,
    // and outside macOS they are off before that probe runs.
    // The driver path is named here, so a machine that happens to have CuaDriver
    // installed cannot decide the case the test asserts.
    const absent = join(tmpdir(), 'avn-cua-driver-absent', 'cua-driver')
    expect(rowsFor('linux', { AVN_CUA_DRIVER: absent }).get('computer-use-semantic-batches')?.disabled).toBe(true)
    expect(rowsFor('win32', { AVN_CUA_DRIVER: absent }).get('computer-use-semantic-batches')?.disabled).toBe(true)
    expect(rowsFor('darwin', { AVN_CUA_DRIVER: absent }).get('computer-use-semantic-batches')?.disabled).toBe(true)
    expect(rowsFor('darwin', { AVN_CUA_DRIVER: stagedDriver() }).get('computer-use-semantic-batches')?.disabled)
      .toBe(false)
  })

  it('mounts the Windows semantic batches on Windows alone', () => {
    // They drive UI Automation and COM directly, so they need no driver and hold
    // no registration.
    expect(rowsFor('win32').get('computer-use-windows-batches')?.disabled).toBe(false)
    expect(rowsFor('darwin').get('computer-use-windows-batches')?.disabled).toBe(true)
    expect(rowsFor('linux').get('computer-use-windows-batches')?.disabled).toBe(true)
  })
})
