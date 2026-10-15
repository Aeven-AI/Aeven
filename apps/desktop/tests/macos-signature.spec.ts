import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { resolve as resolvePath } from 'node:path'
import type { NotarizeOptions } from '@electron/notarize'
import {
  resolveDesktopAppId,
  resolveMacOSNotarizationEnvironment,
  resolveMacOSSigningEnvironment,
} from '../scripts/desktop-release-environment.mjs'
import { notarizeMacOSDiskImageArtifact } from '../scripts/notarize-macos-disk-images.mjs'
import { notarizeMacOSApplicationAfterSign } from '../scripts/notarize-macos-application.mjs'
import {
  isTransientNotaryTicketFailure,
  notarizeMacOSArtifact,
  stapleMacOSArtifact,
} from '../scripts/macos-notarization.mjs'
import {
  assertMacOSSeedSignatureDetails,
  assertMacOSSignatureDetails,
} from '../scripts/verify-macos-signature.mjs'

const RELEASE_ENVIRONMENT = {
  AVN_DESKTOP_APP_ID: 'com.example.desktop',
  AEVEN_API_URL: 'https://aeven.example/api',
  AVN_DESKTOP_TARGET_PLATFORM: 'darwin',
  AVN_DESKTOP_TARGET_ARCH: 'arm64',
  AVN_DESKTOP_MACOS_SIGNING_IDENTITY: 'Example Company (TEAMID1234)',
  AVN_DESKTOP_MACOS_TEAM_ID: 'TEAMID1234',
  APPLE_API_KEY: '/private/credentials/AuthKey_TEST123456.p8',
  APPLE_API_KEY_ID: 'TEST123456',
  APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
}

/** What Apple's ticket-delivery service reports when it drops a lookup, as the release logs carry it. */
const DROPPED_TICKET_DELIVERY = [
  'The staple and validate action failed! Error 68.',
  'error is Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."',
  'NSErrorFailingURLKey=https://api.apple-cloudkit.com/database/1/com.apple.gk.ticket-delivery/production/public/records/lookup',
  "CloudKit's response is inconsistent with expections: (null)",
].join('\n')

/** Type of the stapler command a retry test replaces. */
type StaplerCommand = (action: 'staple' | 'validate', path: string) => Promise<string>

function portablePath(value: string): string {
  return value.replaceAll('\\', '/')
}

describe('desktop macOS release signature', () => {
  beforeAll(() => {
    for (const [name, value] of Object.entries(RELEASE_ENVIRONMENT)) vi.stubEnv(name, value)
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('loads release identifiers from the environment and requires code signing', async () => {
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    const config = createElectronBuilderConfig(RELEASE_ENVIRONMENT, 'darwin', 'arm64')
    expect(portablePath(config.directories.output)).toContain('/.desktop-build/targets/mac-arm64/artifacts')
    expect(config.extraResources).toHaveLength(2)
    expect(config.extraResources[0]?.to).toBe('runtime')
    expect(config.extraResources[1]?.to).toBe('seed')
    expect(portablePath(config.extraResources[0]?.from ?? '')).toContain('/.desktop-build/targets/mac-arm64/runtime')
    expect(portablePath(config.extraResources[1]?.from ?? '')).toContain('/.desktop-build/targets/mac-arm64/seed')
    expect(config).toMatchObject({
      appId: RELEASE_ENVIRONMENT.AVN_DESKTOP_APP_ID,
      mac: {
        identity: RELEASE_ENVIRONMENT.AVN_DESKTOP_MACOS_SIGNING_IDENTITY,
        forceCodeSigning: true,
        // electron-builder staples in one unretried call, so the after-sign hook notarizes the application.
        notarize: false,
      },
      dmg: {
        sign: true,
        writeUpdateInfo: false,
      },
      publish: [{ provider: 'github', owner: 'Aeven-AI', repo: 'Aeven' }],
    })
    expect(typeof config.afterSign).toBe('function')
    expect(typeof config.artifactBuildCompleted).toBe('function')
  })

  it('leaves the application unqualified in an unsigned macOS build', async () => {
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    const config = createElectronBuilderConfig({
      ...RELEASE_ENVIRONMENT,
      AVN_DESKTOP_UNSIGNED: '1',
    }, 'darwin', 'arm64')
    expect(config.afterSign({
      electronPlatformName: 'darwin',
      appOutDir: '/tmp/out',
      packager: { appInfo: { productFilename: 'Aeven' } },
    })).toBeUndefined()
  })

  it('ad-hoc signs an unsigned macOS build without release identity or notarization', async () => {
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    const config = createElectronBuilderConfig({
      AVN_DESKTOP_APP_ID: RELEASE_ENVIRONMENT.AVN_DESKTOP_APP_ID,
      AEVEN_API_URL: RELEASE_ENVIRONMENT.AEVEN_API_URL,
      AVN_DESKTOP_TARGET_PLATFORM: 'darwin',
      AVN_DESKTOP_TARGET_ARCH: 'arm64',
      AVN_DESKTOP_UNSIGNED: '1',
    }, 'darwin', 'arm64')
    expect(config).toMatchObject({
      mac: { identity: '-', forceCodeSigning: false, hardenedRuntime: false, notarize: false },
      dmg: { sign: false },
    })
    expect(config.artifactBuildCompleted({ file: 'aeven.dmg' })).toBeUndefined()
  })

  it('builds an unsigned Windows target without Azure signing', async () => {
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    const config = createElectronBuilderConfig({
      AVN_DESKTOP_APP_ID: RELEASE_ENVIRONMENT.AVN_DESKTOP_APP_ID,
      AEVEN_API_URL: RELEASE_ENVIRONMENT.AEVEN_API_URL,
      AVN_DESKTOP_TARGET_PLATFORM: 'win32',
      AVN_DESKTOP_TARGET_ARCH: 'x64',
      AVN_DESKTOP_UNSIGNED: '1',
    }, 'win32', 'x64')
    expect(config.win.forceCodeSigning).toBe(false)
    expect(config.win.azureSignOptions).toBeUndefined()
  })

  it('validates Windows signing without requiring macOS identifiers for a Windows target', async () => {
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    expect(() => createElectronBuilderConfig({
      AVN_DESKTOP_APP_ID: RELEASE_ENVIRONMENT.AVN_DESKTOP_APP_ID,
      AEVEN_API_URL: RELEASE_ENVIRONMENT.AEVEN_API_URL,
      AVN_DESKTOP_TARGET_PLATFORM: 'win32',
    }, 'win32')).toThrow(/AZURE_TRUSTED_SIGNING_ENDPOINT/u)
  })

  it('signs a Windows release through Azure Trusted Signing', async () => {
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    const config = createElectronBuilderConfig({
      AVN_DESKTOP_APP_ID: RELEASE_ENVIRONMENT.AVN_DESKTOP_APP_ID,
      AEVEN_API_URL: RELEASE_ENVIRONMENT.AEVEN_API_URL,
      AVN_DESKTOP_TARGET_PLATFORM: 'win32',
      AVN_DESKTOP_TARGET_ARCH: 'x64',
      AZURE_TENANT_ID: 'tenant',
      AZURE_CLIENT_ID: 'client',
      AZURE_CLIENT_SECRET: 'secret',
      AZURE_TRUSTED_SIGNING_ENDPOINT: 'https://weu.codesigning.azure.net/',
      AZURE_TRUSTED_SIGNING_ACCOUNT_NAME: 'account',
      AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME: 'profile',
      AZURE_TRUSTED_SIGNING_PUBLISHER_NAME: 'Aeven',
    }, 'win32', 'x64')
    expect(config.win).toMatchObject({
      forceCodeSigning: true,
      azureSignOptions: {
        endpoint: 'https://weu.codesigning.azure.net/',
        codeSigningAccountName: 'account',
        certificateProfileName: 'profile',
        publisherName: 'Aeven',
      },
    })
  })

  it('accepts the configured authority and team', () => {
    const expected = resolveMacOSSigningEnvironment(RELEASE_ENVIRONMENT)
    expect(() => {
      assertMacOSSignatureDetails([
        `Authority=Developer ID Application: ${expected.signingIdentity}`,
        `TeamIdentifier=${expected.teamId}`,
      ].join('\n'), expected)
    }).not.toThrow()
  })

  it('requires a secure timestamp and hardened runtime for seed code', () => {
    const expected = resolveMacOSSigningEnvironment(RELEASE_ENVIRONMENT)
    const details = [
      `Authority=Developer ID Application: ${expected.signingIdentity}`,
      `TeamIdentifier=${expected.teamId}`,
      'Timestamp=31 Aug 2026 at 20:00:00',
      'CodeDirectory v=20500 size=773 flags=0x10000(runtime) hashes=13+7 location=embedded',
    ].join('\n')
    expect(() => { assertMacOSSeedSignatureDetails(details, expected) }).not.toThrow()
    expect(() => {
      assertMacOSSeedSignatureDetails(details.replace(/^Timestamp=.*\n/um, ''), expected)
    }).toThrow(/secure timestamp/u)
    expect(() => {
      assertMacOSSeedSignatureDetails(details.replace('flags=0x10000(runtime)', 'flags=0x0(none)'), expected)
    }).toThrow(/hardened runtime/u)
  })

  it('rejects another developer identity', () => {
    const expected = resolveMacOSSigningEnvironment(RELEASE_ENVIRONMENT)
    expect(() => {
      assertMacOSSignatureDetails([
        'Authority=Developer ID Application: Other Company (OTHERID123)',
        'TeamIdentifier=OTHERID123',
      ].join('\n'), expected)
    }).toThrow(/release identity/u)
  })

  it('rejects an unexpected team even when the authority is present', () => {
    const expected = resolveMacOSSigningEnvironment(RELEASE_ENVIRONMENT)
    expect(() => {
      assertMacOSSignatureDetails([
        `Authority=Developer ID Application: ${expected.signingIdentity}`,
        'TeamIdentifier=OTHERID123',
      ].join('\n'), expected)
    }).toThrow(`TeamIdentifier=${expected.teamId}`)
  })

  it('rejects missing and malformed release identifiers', () => {
    expect(() => resolveDesktopAppId({})).toThrow(/AVN_DESKTOP_APP_ID/u)
    expect(() => resolveDesktopAppId({ AVN_DESKTOP_APP_ID: 'not-a-bundle-id' })).toThrow(/reverse-DNS/u)
    expect(() => resolveMacOSSigningEnvironment({})).toThrow(/AVN_DESKTOP_MACOS_SIGNING_IDENTITY/u)
    expect(() => resolveMacOSSigningEnvironment({
      AVN_DESKTOP_MACOS_SIGNING_IDENTITY: 'Developer ID Application: Example Company (TEAMID1234)',
      AVN_DESKTOP_MACOS_TEAM_ID: 'TEAMID1234',
    })).toThrow(/must omit/u)
    expect(() => resolveMacOSSigningEnvironment({
      AVN_DESKTOP_MACOS_SIGNING_IDENTITY: 'Example Company (TEAMID1234)',
      AVN_DESKTOP_MACOS_TEAM_ID: 'short',
    })).toThrow(/10 uppercase/u)
  })

  it('requires one complete notarization credential strategy', () => {
    expect(resolveMacOSNotarizationEnvironment(RELEASE_ENVIRONMENT)).toEqual({
      appleApiKey: RELEASE_ENVIRONMENT.APPLE_API_KEY,
      appleApiKeyId: RELEASE_ENVIRONMENT.APPLE_API_KEY_ID,
      appleApiIssuer: RELEASE_ENVIRONMENT.APPLE_API_ISSUER,
    })
    expect(resolveMacOSNotarizationEnvironment({
      APPLE_KEYCHAIN_PROFILE: 'avn-notary',
    })).toEqual({ keychainProfile: 'avn-notary' })
    expect(() => resolveMacOSNotarizationEnvironment({})).toThrow(/macOS packaging requires/u)
    expect(() => resolveMacOSNotarizationEnvironment({ APPLE_API_KEY: '/tmp/key.p8' })).toThrow(/APPLE_API_KEY_ID/u)
  })

  it('notarizes and qualifies a DMG before electron-builder publishes it', async () => {
    const submitted: string[] = []
    const submit = vi.fn(async (options: NotarizeOptions) => { submitted.push(options.appPath) })
    const verified: string[] = []
    const verify = vi.fn((path: string) => { verified.push(path) })
    await notarizeMacOSDiskImageArtifact(
      { file: '/tmp/release.dmg' },
      RELEASE_ENVIRONMENT,
      resolveMacOSSigningEnvironment(RELEASE_ENVIRONMENT),
      submit,
      verify,
    )
    await notarizeMacOSDiskImageArtifact(
      { file: '/tmp/release.zip' },
      RELEASE_ENVIRONMENT,
      resolveMacOSSigningEnvironment(RELEASE_ENVIRONMENT),
      submit,
      verify,
    )
    expect(submitted).toEqual(['/tmp/release.dmg'])
    expect(verified).toEqual(['/tmp/release.dmg'])
  })
})

describe('desktop macOS notary ticket delivery', () => {
  const credentials = resolveMacOSNotarizationEnvironment(RELEASE_ENVIRONMENT)
  const expected = resolveMacOSSigningEnvironment(RELEASE_ENVIRONMENT)

  it('repeats only the ticket lookups Apple drops', () => {
    expect(isTransientNotaryTicketFailure(new Error(DROPPED_TICKET_DELIVERY))).toBe(true)
    expect(isTransientNotaryTicketFailure(new Error('desktop macOS signing: stapler validate exited with 68: Record not found'))).toBe(false)
    expect(isTransientNotaryTicketFailure(new Error('Invalid: The signature of the binary is invalid'))).toBe(false)
  })

  it('staples an accepted submission again when Apple did not deliver the ticket', async () => {
    const submit = vi.fn(async () => { throw new Error(DROPPED_TICKET_DELIVERY) })
    const staple = vi.fn(async () => {})
    await notarizeMacOSArtifact('/tmp/release.dmg', credentials, { submit, staple })
    expect(submit).toHaveBeenCalledWith({ appPath: '/tmp/release.dmg', ...credentials })
    expect(staple).toHaveBeenCalledWith('/tmp/release.dmg')
  })

  it('leaves a submission alone when its ticket arrived', async () => {
    const submit = vi.fn(async () => {})
    const staple = vi.fn(async () => {})
    await notarizeMacOSArtifact('/tmp/release.dmg', credentials, { submit, staple })
    expect(staple).not.toHaveBeenCalled()
  })

  it('fails the release when the notary submission itself failed', async () => {
    const submit = vi.fn(async () => { throw new Error('Invalid: The signature of the binary is invalid') })
    const staple = vi.fn(async () => {})
    await expect(notarizeMacOSArtifact('/tmp/release.dmg', credentials, { submit, staple })).rejects.toThrow(/Invalid/u)
    expect(staple).not.toHaveBeenCalled()
  })

  it('reports the submission and the repeated staple when both fail', async () => {
    const submit = vi.fn(async () => { throw new Error(DROPPED_TICKET_DELIVERY) })
    const staple = vi.fn(async () => { throw new Error('desktop macOS signing: stapler staple exited with 68') })
    await expect(notarizeMacOSArtifact('/tmp/release.dmg', credentials, { submit, staple })).rejects.toBeInstanceOf(AggregateError)
  })

  it('repeats a stapler action that failed at ticket delivery', async () => {
    const run = vi.fn<StaplerCommand>()
      .mockRejectedValueOnce(new Error(DROPPED_TICKET_DELIVERY))
      .mockResolvedValueOnce('stapled')
    await expect(stapleMacOSArtifact('/tmp/release.dmg', { run, delayMs: 0 })).resolves.toBe('stapled')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('stops repeating a ticket lookup once the attempt budget is spent', async () => {
    const run = vi.fn<StaplerCommand>().mockRejectedValue(new Error(DROPPED_TICKET_DELIVERY))
    await expect(stapleMacOSArtifact('/tmp/release.dmg', { run, attempts: 2, delayMs: 0 })).rejects.toThrow(/Error 68/u)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('gives a dropped lookup three attempts by default', async () => {
    const run = vi.fn<StaplerCommand>().mockRejectedValue(new Error(DROPPED_TICKET_DELIVERY))
    await expect(stapleMacOSArtifact('/tmp/release.dmg', { run, delayMs: 0 })).rejects.toThrow(/Error 68/u)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('does not repeat a stapler failure that is not a ticket lookup', async () => {
    const run = vi.fn<StaplerCommand>().mockRejectedValue(new Error('desktop macOS signing: stapler validate exited with 68: Record not found'))
    await expect(stapleMacOSArtifact('/tmp/release.dmg', { run, delayMs: 0 })).rejects.toThrow(/Record not found/u)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('qualifies the application the after-sign hook names', async () => {
    const order: string[] = []
    const notarize = vi.fn(async (path: string) => { order.push(`notarize ${path}`) })
    const validate = vi.fn(async (path: string) => { order.push(`validate ${path}`) })
    const verify = vi.fn((path: string) => { order.push(`verify ${path}`) })
    await notarizeMacOSApplicationAfterSign(
      { electronPlatformName: 'darwin', appOutDir: '/tmp/out', packager: { appInfo: { productFilename: 'Aeven' } } },
      RELEASE_ENVIRONMENT,
      expected,
      { notarize, validate, verify },
    )
    const appPath = resolvePath('/tmp/out', 'Aeven.app')
    expect(order).toEqual([`notarize ${appPath}`, `validate ${appPath}`, `verify ${appPath}`])
  })

  it('leaves an application alone on a platform without Apple notarization', async () => {
    const notarize = vi.fn(async () => {})
    await notarizeMacOSApplicationAfterSign(
      { electronPlatformName: 'linux', appOutDir: '/tmp/out', packager: { appInfo: { productFilename: 'Aeven' } } },
      RELEASE_ENVIRONMENT,
      expected,
      { notarize },
    )
    expect(notarize).not.toHaveBeenCalled()
  })
})
