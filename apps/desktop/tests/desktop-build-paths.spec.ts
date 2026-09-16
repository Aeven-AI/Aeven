import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  desktopTargetBuildPaths,
  resolveDesktopBuildTarget,
} from '../scripts/desktop-build-paths.mjs'

describe('desktop build paths', () => {
  it('isolates every mutable build directory by complete target', () => {
    const arm64 = desktopTargetBuildPaths('mac-arm64')
    const x64 = desktopTargetBuildPaths('mac-x64')
    const windows = desktopTargetBuildPaths('win-x64')
    const windowsArm64 = desktopTargetBuildPaths('win-arm64')
    const mutableKeys = [
      'root',
      'artifacts',
      'runtime',
      'packageSet',
      'seed',
      'seedPnpm',
      'nodeExtract',
      'packedDsh',
      'packedVendor',
      'packedLandlock',
    ] as const

    for (const key of mutableKeys) {
      expect(new Set([arm64[key], x64[key], windows[key], windowsArm64[key]]).size).toBe(4)
    }
    expect(arm64.artifacts).toContain(join('targets', 'mac-arm64', 'artifacts'))
    expect(x64.seed).toContain(join('targets', 'mac-x64', 'seed'))
    expect(windows.runtime).toContain(join('targets', 'win-x64', 'runtime'))
  })

  it('shares only the immutable upstream download cache', () => {
    const arm64 = desktopTargetBuildPaths('mac-arm64')
    const x64 = desktopTargetBuildPaths('mac-x64')
    expect(arm64.downloads).toBe(x64.downloads)
    expect(arm64.downloads).not.toContain(`${sep}targets${sep}`)
  })

  it('resolves environment overrides and rejects unsupported targets', () => {
    expect(resolveDesktopBuildTarget({
      AVN_DESKTOP_TARGET_PLATFORM: 'darwin',
      AVN_DESKTOP_TARGET_ARCH: 'x64',
    }, 'darwin', 'arm64')).toBe('mac-x64')
    expect(resolveDesktopBuildTarget({}, 'win32', 'x64')).toBe('win-x64')
    expect(resolveDesktopBuildTarget({}, 'win32', 'arm64')).toBe('win-arm64')
    expect(resolveDesktopBuildTarget({}, 'linux', 'arm64')).toBe('linux-arm64')
    expect(() => resolveDesktopBuildTarget({}, 'freebsd', 'x64')).toThrow(/unsupported target/u)
    expect(() => desktopTargetBuildPaths('freebsd-x64' as 'mac-x64')).toThrow(/unsupported target/u)
  })
})
