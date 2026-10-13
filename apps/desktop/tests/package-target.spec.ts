import { describe, expect, it } from 'vitest'
import {
  desktopElectronBuilderArguments,
  parseDesktopPackageInvocation,
  resolveDesktopPackageTarget,
  withoutWindowsSigningEnvironment,
} from '../scripts/package-target.ts'

describe('desktop package target', () => {
  it('selects matching runtime and electron-builder architectures', () => {
    expect(resolveDesktopPackageTarget('mac-arm64', 'darwin', 'arm64')).toMatchObject({
      platform: 'darwin', arch: 'arm64', builderPlatform: '--mac', builderArch: '--arm64',
    })
    expect(resolveDesktopPackageTarget('win-x64', 'win32', 'x64')).toMatchObject({
      platform: 'win32', arch: 'x64', builderPlatform: '--win', builderArch: '--x64',
    })
    expect(resolveDesktopPackageTarget('win-arm64', 'win32', 'arm64')).toMatchObject({
      platform: 'win32', arch: 'arm64', builderPlatform: '--win', builderArch: '--arm64',
    })
    expect(resolveDesktopPackageTarget('linux-arm64', 'linux', 'arm64')).toMatchObject({
      platform: 'linux', arch: 'arm64', builderPlatform: '--linux', builderArch: '--arm64',
    })
  })

  it('builds macOS only for Apple Silicon', () => {
    expect(() => resolveDesktopPackageTarget('mac-x64', 'darwin', 'arm64')).toThrow(/unsupported target "mac-x64"/u)
    expect(() => parseDesktopPackageInvocation([], 'darwin', 'x64')).toThrow(/unsupported build host darwin-x64/u)
  })

  it('rejects unsupported targets and hosts before building', () => {
    expect(() => resolveDesktopPackageTarget('freebsd-x64', 'freebsd', 'x64')).toThrow(/unsupported target/u)
    expect(() => resolveDesktopPackageTarget('linux-arm64', 'darwin', 'arm64')).toThrow(/Linux arm64 build host/u)
    expect(() => resolveDesktopPackageTarget('linux-x64', 'linux', 'arm64')).toThrow(/Linux x64 build host/u)
    expect(() => resolveDesktopPackageTarget('win-x64', 'darwin', 'arm64')).toThrow(/Windows x64/u)
    expect(resolveDesktopPackageTarget('win-x64', 'win32', 'arm64')).toMatchObject({ arch: 'x64', builderArch: '--x64' })
    expect(() => resolveDesktopPackageTarget('win-arm64', 'win32', 'x64')).toThrow(/Windows arm64 build host running arm64 Node\.js/u)
    expect(() => resolveDesktopPackageTarget('mac-arm64', 'darwin', 'x64')).toThrow(/Apple Silicon/u)
    expect(() => resolveDesktopPackageTarget('mac-arm64', 'linux', 'arm64')).toThrow(/macOS/u)
  })

  it('parses installer and unpacked-directory invocations', () => {
    expect(parseDesktopPackageInvocation(['mac-arm64'], 'darwin', 'arm64').directory).toBe(false)
    expect(parseDesktopPackageInvocation(['mac-arm64', '--dir'], 'darwin', 'arm64').directory).toBe(true)
    expect(parseDesktopPackageInvocation([], 'darwin', 'arm64').target.name).toBe('mac-arm64')
    expect(parseDesktopPackageInvocation(['--prepare-only'], 'darwin', 'arm64').prepareOnly).toBe(true)
    expect(() => parseDesktopPackageInvocation(['mac-arm64', 'win-x64'], 'darwin', 'arm64'))
      .toThrow(/at most one target/u)
  })

  it('parses unsigned packaging for macOS and Windows targets', () => {
    expect(parseDesktopPackageInvocation(['mac-arm64'], 'darwin', 'arm64').unsigned).toBe(false)
    expect(parseDesktopPackageInvocation(['--unsigned'], 'darwin', 'arm64').unsigned).toBe(true)
    expect(parseDesktopPackageInvocation(['win-x64', '--unsigned'], 'win32', 'x64').unsigned).toBe(true)
    expect(parseDesktopPackageInvocation(['--unsigned'], 'win32', 'arm64').target.name).toBe('win-arm64')
  })

  it('keeps electron-builder publishing disabled for the separate validated upload', () => {
    const target = resolveDesktopPackageTarget('mac-arm64', 'darwin', 'arm64')
    expect(desktopElectronBuilderArguments(target, false)).toEqual([
      'exec',
      'electron-builder',
      '--config',
      'electron-builder.config.mjs',
      '--mac',
      '--arm64',
      '--publish',
      'never',
    ])
    expect(desktopElectronBuilderArguments(target, true)).toContain('--dir')
  })

  it('keeps Windows signing credentials out of build and seed preparation subprocesses', () => {
    expect(withoutWindowsSigningEnvironment({
      AZURE_TENANT_ID: 'tenant',
      AZURE_CLIENT_ID: 'client',
      AZURE_CLIENT_SECRET: 'secret',
      AZURE_TRUSTED_SIGNING_ENDPOINT: 'https://weu.codesigning.azure.net/',
      AZURE_TRUSTED_SIGNING_ACCOUNT_NAME: 'account',
      AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME: 'profile',
      AZURE_TRUSTED_SIGNING_PUBLISHER_NAME: 'Aeven',
      AVN_DESKTOP_APP_ID: 'com.example.desktop',
    })).toEqual({ AVN_DESKTOP_APP_ID: 'com.example.desktop' })
  })
})
