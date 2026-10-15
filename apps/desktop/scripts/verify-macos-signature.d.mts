import type { MacOSSigningEnvironment } from './desktop-release-environment.mjs'

/**
 * Reject signature metadata that does not name the company release authority and team.
 * @param details - Output from `codesign --display --verbose=4`.
 * @param expected - Public release identity.
 */
export function assertMacOSSignatureDetails(details: string, expected: MacOSSigningEnvironment): void

/**
 * Require the signature properties Apple validates for executable seed content.
 * @param details - Output from `codesign --display --verbose=4`.
 * @param expected - Public release identity.
 */
export function assertMacOSSeedSignatureDetails(details: string, expected: MacOSSigningEnvironment): void

/**
 * Sign one Mach-O file embedded in the seed store.
 * @param path - Writable standalone Mach-O file.
 * @param identifier - Stable code-signing identifier derived from the release app ID and CAS digest.
 * @param expected - Public release identity.
 * @param entitlements - Entitlements plist for code that needs one, such as JIT.
 * @returns Resolves after codesign exits successfully.
 */
export function signMacOSSeedCode(
  path: string,
  identifier: string,
  expected: MacOSSigningEnvironment,
  entitlements: string | undefined,
): Promise<void>

/**
 * Verify one Mach-O file embedded in the seed store.
 * @param path - Mach-O file to inspect.
 * @param expected - Public release identity.
 */
export function verifyMacOSSeedCode(path: string, expected: MacOSSigningEnvironment): void

/**
 * Verify the full application signature and its release owner.
 * @param appPath - Path to the packaged `.app` directory.
 * @param expected - Public release identity.
 */
export function verifyMacOSSignature(appPath: string, expected: MacOSSigningEnvironment): void

/**
 * Verify the release identity, stapled ticket, and Gatekeeper acceptance of one disk image.
 * @param diskImagePath - Path to the packaged `.dmg` file.
 * @param expected - Public release identity.
 */
export function verifyMacOSDiskImage(
  diskImagePath: string,
  expected: MacOSSigningEnvironment,
): Promise<void>
