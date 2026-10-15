import type { MacOSSigningEnvironment } from './desktop-release-environment.mjs'

/** Electron-builder fields required to locate a signed macOS application. */
export interface MacOSAfterSignContext {
  readonly electronPlatformName: string
  readonly appOutDir: string
  readonly packager: {
    readonly appInfo: {
      readonly productFilename: string
    }
  }
}

/** Notarization, ticket check, and signature verification implementations a test can replace. */
export interface MacOSApplicationQualification {
  readonly notarize?: (path: string, credentials: object, options: object) => Promise<void>
  readonly validate?: (path: string) => Promise<unknown>
  readonly verify?: (path: string, expected: MacOSSigningEnvironment) => void
}

/**
 * Submit the signed application to Apple, staple its ticket, and verify what the installers will carry.
 * @param context - electron-builder after-sign context.
 * @param env - Packaging environment.
 * @param expected - Public release identity.
 * @param options - Notarization, ticket check, and signature verification implementations.
 * @returns Resolves after the application carries its ticket and the release identity.
 */
export function notarizeMacOSApplicationAfterSign(
  context: MacOSAfterSignContext,
  env: NodeJS.ProcessEnv,
  expected: MacOSSigningEnvironment,
  options?: MacOSApplicationQualification,
): Promise<void>
